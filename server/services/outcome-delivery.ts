import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { damageClaims, damageClaimHistory, emailLogs, users, storageOverstayRecords, storageOverstayHistory, storageBookings, storageListings, kitchens, locations, commitmentProblems } from '@shared/schema';
import { db } from '../db';
import { getAppBaseUrl } from '../config';
import { sendEmail } from '../email';
import { isE2eOutboundSuppressed } from '../e2e-outbound-guard';
import { notificationService } from './notification.service';
import { chefIssuesHref, managerDashboardView } from '@shared/notification-deep-links';
import { deliveryReserve, inRecurringWorker } from './worker-context';
import { problemDestination, problemStatusLabel } from '@shared/commitment-problems';
import { operationalEmailAllowed, operationalEmailAllowedForUser, adminEmailAllowedForUser } from './admin-email-preferences';
import { isPlatformEmailRecipientBlocked } from '../email-recipient-policy';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Existing email logs hold immediate outcome intent as well as SMTP attempts.
 * No deadline or financial evidence is changed by delivery or replay. */
export async function queueClaimOutcome(tx: Transaction, history: typeof damageClaimHistory.$inferSelect) {
  const [claim] = await tx.select().from(damageClaims).where(eq(damageClaims.id, history.damageClaimId)).limit(1);
  if (!claim) throw new Error('Claim delivery context missing');
  if (history.newStatus === 'draft' || history.newStatus !== claim.status || history.action === 'chef_evidence' || history.action === 'escalation_checkout_prepared') return;
  const { scheduleAdvanceReminders } = await import('./advance-reminders');
  await scheduleAdvanceReminders(tx, 'claim', claim.id);
  const people = await tx.select().from(users).where(or(eq(users.id, claim.chefId), eq(users.id, claim.managerId),
    ['under_review', 'escalated', 'charge_failed'].includes(history.newStatus) ? eq(users.role, 'admin') : undefined));
  const title = `Damage claim #${claim.id}: ${history.newStatus.replaceAll('_', ' ')}`;
  // Public evidence only. History notes may contain internal admin/provider information.
  const metadata = history.metadata as Record<string, unknown>;
  const financial = history.newStatus === 'charge_succeeded' ? `Recorded payment: CAD $${((claim.finalAmountCents || 0) / 100).toFixed(2)}. Payment reference: ${claim.stripePaymentIntentId}.`
    : history.action === 'refund' ? `Recorded refund request: CAD $${(Number(metadata.refundAmount || 0) / 100).toFixed(2)}. Reference: ${metadata.refundId}. Refund completion depends on the provider.`
    : `Claimed amount: CAD $${(claim.claimedAmountCents / 100).toFixed(2)}. Claim approval and payment are separate outcomes.`;
  const deadline = history.newStatus === 'submitted' && claim.chefResponseDeadline
    ? `Recorded response deadline: ${claim.chefResponseDeadline.toISOString()}.` : '';
  const message = `${title}. ${financial} ${deadline} ${history.newStatus === 'under_review' ? 'Local Cooks must review this claim; you can still provide your response.' : ''} Open the current claim for its current state and available actions.`;
  for (const person of people) {
    const chef = person.id === claim.chefId;
    const path = chef ? chefIssuesHref('damage-claims') : person.role === 'admin' ? '/admin?section=damage-claims' : managerDashboardView('damage-claims');
    await notificationService.create({ userId: person.id, target: chef ? 'chef' : 'manager',
      type: 'system_announcement', priority: ['under_review', 'escalated', 'charge_failed'].includes(history.newStatus) ? 'high' : 'normal',
      title, message, actionUrl: path, actionLabel: 'View current claim',
      metadata: { damageClaimId: claim.id, historyId: history.id } }, tx);
    if (!operationalEmailAllowed(person)) continue;
    const [intent] = await tx.insert(emailLogs).values({ recipientEmail: person.username || '', recipientUserId: person.id,
      recipientRole: chef ? 'chef' : person.role === 'admin' ? 'admin' : 'manager', subject: title,
      category: 'lifecycle_outcome', status: 'queued', trackingId: `claim-outcome:${claim.id}:${history.id}:${person.id}`,
      textBody: `${message}\n\n${getAppBaseUrl(chef ? 'chef' : person.role === 'admin' ? 'admin' : 'kitchen')}${path}`,
      previewText: message }).returning();
    if (!intent) throw new Error('Claim delivery intent missing');
  }
}

/** Row lock coordinates automatic and manual delivery. SMTP cannot be atomic with DB:
 * acceptance followed by a crash before durable evidence may duplicate on retry. */
export async function deliverOutcomeEmails(limit = 10, budgetMs = 20_000, onlyLogId?: number) {
  if (isE2eOutboundSuppressed()) return { completed: 0 };
  const deadline = Date.now() + budgetMs;
  let completed = 0;
  const attempted: number[] = [];
  while (attempted.length < limit && deadline - Date.now() >= deliveryReserve()) {
    const result = await db.transaction(async tx => {
      const [intent] = await tx.select().from(emailLogs).where(and(eq(emailLogs.category, 'lifecycle_outcome'),
        inArray(emailLogs.status, ['queued', 'failed']), onlyLogId ? eq(emailLogs.id, onlyLogId) : undefined,
        sql`(${emailLogs.trackingId} LIKE 'claim-outcome:%' OR ${emailLogs.trackingId} LIKE 'payment-outcome:%' OR ${emailLogs.trackingId} LIKE 'overstay-outcome:%' OR ${emailLogs.trackingId} LIKE 'storage-outcome:%' OR ${emailLogs.trackingId} LIKE 'problem-outcome:%')`,
        attempted.length ? sql`${emailLogs.id} NOT IN (${sql.join(attempted.map(id => sql`${id}`), sql`,`)})` : undefined,
        onlyLogId ? undefined : sql`(${emailLogs.retriedAt} IS NULL OR ${emailLogs.retriedAt} < CURRENT_TIMESTAMP - interval '1 minute')`))
        .orderBy(sql`${emailLogs.retriedAt} ASC NULLS FIRST`, asc(emailLogs.id)).limit(1).for('update', { skipLocked: true });
      if (!intent) return null;
      if (isPlatformEmailRecipientBlocked(intent.recipientEmail)) {
        // Expand pending legacy support copies once. A stable per-admin key prevents
        // duplicate delivery if a replacement was already queued or accepted.
        if (!intent.recipientUserId && /^problem-outcome:\d+:\d+:support$/.test(intent.trackingId || '')) {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${intent.trackingId}, 0))`);
          const admins = await tx.select().from(users).where(and(eq(users.role, 'admin'), eq(users.adminEmailNotifications, true)));
          for (const admin of admins) {
            if (!operationalEmailAllowed(admin) || isPlatformEmailRecipientBlocked(admin.username)) continue;
            const trackingId = intent.trackingId!.replace(/:support$/, `:${admin.id}`);
            const [existing] = await tx.select({ id: emailLogs.id }).from(emailLogs)
              .where(and(eq(emailLogs.trackingId, trackingId), eq(emailLogs.recipientEmail, admin.username))).limit(1);
            if (!existing) await tx.insert(emailLogs).values({ recipientEmail: admin.username, recipientUserId: admin.id,
              recipientRole: 'admin', subject: intent.subject, category: 'lifecycle_outcome', status: 'queued', trackingId,
              previewText: intent.previewText, textBody: intent.textBody, htmlBody: intent.htmlBody });
          }
        }
        await tx.update(emailLogs).set({ status: 'skipped_policy',
          errorMessage: 'Support contact inbox excluded; eligible legacy alerts routed to opted-in admins.' }).where(eq(emailLogs.id, intent.id));
        return { id: intent.id, sent: false };
      }
      if (intent.recipientUserId && !await (intent.recipientRole === 'admin' ? adminEmailAllowedForUser : operationalEmailAllowedForUser)(intent.recipientUserId, tx)) {
        await tx.update(emailLogs).set({ status: 'skipped_preference',
          errorMessage: 'Admin operational email is disabled for this recipient.' }).where(eq(emailLogs.id, intent.id));
        return { id: intent.id, sent: false };
      }
      const [accepted] = await tx.select({ id: emailLogs.id }).from(emailLogs).where(and(
        eq(emailLogs.trackingId, intent.trackingId!), eq(emailLogs.recipientEmail, intent.recipientEmail), eq(emailLogs.status, 'sent'))).limit(1);
      let sent = !!accepted;
      if (!sent) {
        try {
          const [kind, identity] = intent.trackingId!.split(':');
          const id = Number(identity);
          let currentState = 'unavailable; contact Local Cooks';
          let problemText: string | undefined;
          if (kind === 'problem-outcome') {
            const [current] = await tx.select().from(commitmentProblems).where(eq(commitmentProblems.id, id)).limit(1);
            if (!current) throw Error('Problem source missing; Local Cooks must review delivery');
            const { problemContext } = await import('./commitment-problems');
            const context = await problemContext(tx, current.bookingId ? 'booking' : 'tour', current.bookingId || current.viewingId!);
            if (!context) throw Error('Problem commitment missing');
            if (intent.recipientUserId) {
              const [recipient] = await tx.select().from(users).where(eq(users.id, intent.recipientUserId)).limit(1);
              if (!recipient || recipient.username !== intent.recipientEmail || !(intent.recipientRole === 'admin'
                ? recipient.role === 'admin' && recipient.adminEmailNotifications
                : [context.chefId, context.managerId].includes(recipient.id)))
                throw Error('Problem recipient changed; Local Cooks must verify contact before recovery');
            } else throw Error('Problem notices require an identified participant or opted-in admin');
            currentState = problemStatusLabel(current.status);
            const role = intent.recipientRole || 'chef';
            const lastResponse = (current.history as Array<{ action: string; note: string }>).filter(entry => !['report', 'claim', 'reassign'].includes(entry.action)).at(-1)?.note;
            const path = problemDestination(current.bookingId ? 'booking' : 'tour', current.bookingId || current.viewingId!, role);
            problemText = `Support request #${current.id}: ${currentState}.\n\n${current.description}${lastResponse ? `\n\nLatest update: ${lastResponse}` : ''}\n\n${getAppBaseUrl(role === 'admin' ? 'admin' : role === 'manager' ? 'kitchen' : 'chef')}${path}`;
          } else if (kind === 'claim-outcome') {
            const [current] = await tx.select({ status: damageClaims.status }).from(damageClaims).where(eq(damageClaims.id, id)).limit(1);
            if (current) currentState = current.status.replaceAll('_', ' ');
          } else if (kind === 'overstay-outcome') {
            const [current] = await tx.select({ status: storageOverstayRecords.status }).from(storageOverstayRecords).where(eq(storageOverstayRecords.id, id)).limit(1);
            if (current) currentState = current.status.replaceAll('_', ' ');
          } else if (kind === 'storage-outcome') {
            const [current] = await tx.select({ status: storageBookings.status }).from(storageBookings).where(eq(storageBookings.id, id)).limit(1);
            if (current) currentState = current.status;
          } else {
            const result = await tx.execute(sql`SELECT status FROM payment_transactions WHERE id = ${id}`);
            if (result.rows[0]) currentState = String(result.rows[0].status).replaceAll('_', ' ');
          }
          const note = `Recorded outcome notice from ${intent.createdAt.toISOString()}. Current state: ${currentState}. Historical money evidence below remains unchanged. Use the current page for available actions and current deadlines; older instructions may be obsolete.`;
          sent = await sendEmail({ to: intent.recipientEmail, subject: intent.subject,
            text: problemText || `${note}\n\n${intent.textBody || ''}` },
            { trackingId: intent.trackingId!, emailType: 'lifecycle_outcome_attempt', durableDelivery: true, retryOfId: intent.id });
        }
        catch { sent = false; }
      }
      if (!sent && intent.retryCount === 0) {
        // Existing admin bell and Email logs own recovery, including missed response opportunity.
        const owners = await tx.select({ id: users.id }).from(users).where(eq(users.role, 'admin'));
        if (!owners.length) throw new Error('No Local Cooks delivery recovery owner configured');
        for (const owner of owners) await notificationService.create({ userId: owner.id, target: 'manager', type: 'system_announcement',
          priority: 'high', title: 'Outcome notice needs delivery recovery',
          message: `Email intent #${intent.id} for ${intent.subject} was not accepted. Verify contact and current state, retry from Email logs, and review any missed response opportunity before making a liability decision.`,
          actionUrl: '/admin?section=email-log', actionLabel: 'Review delivery', metadata: { emailLogId: intent.id, recoveryOwnerId: owner.id } }, tx);
      }
      await tx.update(emailLogs).set({ status: sent ? 'sent' : 'failed', retryCount: intent.retryCount + 1, retriedAt: new Date(),
        errorMessage: sent ? null : 'Not accepted; Local Cooks must verify contact, retry and review missed response opportunity.' })
        .where(eq(emailLogs.id, intent.id));
      return { id: intent.id, sent };
    });
    if (!result) break;
    attempted.push(result.id);
    if (result.sent) completed++;
  }
  return { completed };
}

export async function queueStorageClearance(tx: Transaction, bookingId: number, automatic = false) {
  const [booking] = await tx.select().from(storageBookings).where(eq(storageBookings.id, bookingId)).limit(1);
  if (!booking || !booking.checkoutApprovedAt) throw new Error('Storage clearance context missing');
  if (!booking.chefId) throw new Error('Storage clearance needs an assigned recipient');
  const [chef] = await tx.select().from(users).where(eq(users.id, booking.chefId)).limit(1);
  if (!chef) throw new Error('Storage clearance recipient missing');
  const title = `Storage #${bookingId}: checkout review cleared`;
  const message = automatic ? 'The existing inspection response window elapsed with no issues reported. This is a review outcome, not evidence of physical removal. Contact the kitchen manager to confirm removal where needed.'
    : 'The kitchen manager confirmed storage clearance and removal.';
  const path = '/dashboard?view=bookings';
  await notificationService.create({ userId: chef.id, target: 'chef', type: 'storage_checkout_cleared', title, message,
    actionUrl: path, actionLabel: 'View current storage booking', metadata: { storageBookingId: bookingId, automatic } }, tx);
  await tx.insert(emailLogs).values({ recipientEmail: chef.username || '', recipientUserId: chef.id, recipientRole: 'chef',
    category: 'lifecycle_outcome', status: 'queued', subject: title, previewText: message,
    trackingId: `storage-outcome:${bookingId}:${booking.checkoutApprovedAt.getTime()}:${chef.id}`,
    textBody: `${message}\nRecorded at: ${booking.checkoutApprovedAt.toISOString()}. Open the current booking for current status and available actions.\n\n${getAppBaseUrl('chef')}${path}` });
}

/** Linked and legacy standalone storage use the same durable action contract. */
export async function queueStorageVisitAction(tx: Transaction, bookingId: number, action: 'arrival' | 'departure' | 'removal' | 'draft_claim', actorId: number, assistance?: { reason: string; actualAt: string }) {
  const [row] = await tx.select({ storage: storageBookings, managerId: locations.managerId }).from(storageBookings)
    .innerJoin(storageListings, eq(storageListings.id, storageBookings.storageListingId)).innerJoin(kitchens, eq(kitchens.id, storageListings.kitchenId))
    .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(storageBookings.id, bookingId)).limit(1);
  if (!row?.storage.chefId || !row.managerId) throw Error('Storage action needs an assigned chef and manager');
  const people = await tx.select().from(users).where(or(eq(users.id, row.storage.chefId), eq(users.id, row.managerId)));
  const title = `Storage #${bookingId}: ${assistance ? 'manager-assisted ' : ''}${action === 'draft_claim' ? 'draft claim handoff' : action} recorded`;
  const message = `${title}. ${assistance ? `Reported or evidenced time: ${assistance.actualAt}. Reason: ${assistance.reason}. Existing chef evidence is preserved.` : 'Open the current storage booking for evidence and actions.'} ${action === 'departure' ? 'The kitchen manager owns inspection and must confirm physical removal. Storage stays occupied until that confirmation; this is not clearance or a charge.' : action === 'removal' ? 'The manager confirmed physical removal. The previous inspection outcome and financial records are unchanged.' : action === 'draft_claim' ? 'Inspection was handed to a draft claim. Evidence and submission remain required; the chef response window has not started. This is not clearance, physical removal or a charge.' : 'Storage dates and removal duties are independent from the kitchen visit.'}`;
  for (const person of people) {
    const chef = person.id === row.storage.chefId;
    const path = chef ? '/dashboard?view=bookings' : managerDashboardView(action === 'departure' ? 'storage-checkouts' : 'storage-bookings');
    await notificationService.create({ userId: person.id, target: chef ? 'chef' : 'manager', type: 'system_announcement', title, message,
      actionUrl: path, actionLabel: 'View storage action', metadata: { storageBookingId: bookingId, actorId, assistance: !!assistance } }, tx);
    if (action === 'removal' || action === 'draft_claim' ? chef : !chef) await tx.insert(emailLogs).values({ recipientEmail: person.username || '', recipientUserId: person.id, recipientRole: chef ? 'chef' : 'manager',
      category: 'lifecycle_outcome', status: 'queued', subject: title, previewText: message,
      trackingId: `storage-outcome:${bookingId}:${action}-${row.storage.updatedAt.getTime()}:${person.id}`,
      textBody: `${message}\n\n${getAppBaseUrl(chef ? 'chef' : 'kitchen')}${path}` });
  }
  const { scheduleAdvanceReminders } = await import('./advance-reminders');
  await scheduleAdvanceReminders(tx, 'storage_arrival', bookingId);
  await scheduleAdvanceReminders(tx, 'storage_review', bookingId);
}

export async function attemptOutcomeDelivery() {
  try { await deliverOutcomeEmails(2); }
  catch { /* Committed intent remains queued; existing worker/admin replay recovers it. */ }
}

/** Called with payment history and the recorded provider result in their transaction. */
export async function queuePaymentOutcome(tx: Transaction, historyId: number, record: any) {
  const people = await tx.select().from(users).where(or(record.chef_id ? eq(users.id, record.chef_id) : undefined,
    record.manager_id ? eq(users.id, record.manager_id) : undefined, record.status === 'failed' || ['full_refund_requested', 'refund_recovery_required'].includes(record.deliveryKind) ? eq(users.role, 'admin') : undefined));
  const outcome = record.deliveryKind === 'full_refund_requested' ? 'refund request pending Local Cooks review'
    : record.deliveryKind === 'full_refund_rejected' ? 'refund request declined'
    : record.deliveryKind === 'refund_recovery_required' ? 'refund outcome needs Local Cooks reconciliation' : String(record.status).replaceAll('_', ' ');
  const title = `Payment #${record.id}: ${outcome}`;
  const message = `${title}. Recorded amount: ${record.currency} $${(Number(record.amount) / 100).toFixed(2)}. Recorded refund amount: ${record.currency} $${(Number(record.refund_amount || 0) / 100).toFixed(2)}. Provider payment reference: ${record.payment_intent_id || 'not recorded'}. Refund reference: ${record.refund_id || 'not recorded'}. ${record.deliveryKind === 'refund_recovery_required' ? 'The request was interrupted; this does not prove the provider refund failed. Local Cooks must inspect the original provider outcome before retrying any money movement.' : record.deliveryKind ? 'A request or decision is separate from a completed provider refund.' : 'This records the financial outcome.'} Open your current records for available actions.`;
  for (const person of people) {
    const chef = person.id === record.chef_id;
    const path = chef ? '/dashboard?view=transactions' : person.role === 'admin' ? '/admin?section=transactions' : '/manager/dashboard?view=revenue';
    await notificationService.create({ userId: person.id, target: chef ? 'chef' : 'manager', type: 'system_announcement',
      title, message, actionUrl: path, actionLabel: 'View financial records', metadata: { transactionId: record.id, paymentHistoryId: historyId } }, tx);
    if (!operationalEmailAllowed(person)) continue;
    await tx.insert(emailLogs).values({ recipientEmail: person.username || '', recipientUserId: person.id,
      recipientRole: chef ? 'chef' : person.role === 'admin' ? 'admin' : 'manager', category: 'lifecycle_outcome',
      status: 'queued', subject: title, previewText: message, trackingId: `payment-outcome:${record.id}:${historyId}:${person.id}`,
      textBody: `${message}\n\n${getAppBaseUrl(chef ? 'chef' : person.role === 'admin' ? 'admin' : 'kitchen')}${path}` });
  }
}

/** After the caller's transaction rolled back, preserve an owned uncertain refund task. */
export async function recordRefundRecovery(transactionId: number, attemptKey: string) {
  await db.transaction(async tx => {
    const result = await tx.execute(sql`SELECT * FROM payment_transactions WHERE id = ${transactionId} FOR UPDATE`);
    const record = result.rows[0] as any;
    if (!record) throw new Error('Refund recovery transaction missing');
    await tx.execute(sql`UPDATE payment_transactions SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ refundRecovery: { attemptKey, status: 'recovery_required', recordedAt: new Date().toISOString() } })}::jsonb WHERE id = ${transactionId}`);
    const prior = await tx.execute(sql`SELECT id FROM payment_history WHERE transaction_id = ${transactionId}
      AND event_type = 'refund_recovery_required' AND metadata->>'attemptKey' = ${attemptKey} LIMIT 1`);
    if (prior.rows.length) return;
    const { addPaymentHistory } = await import('./payment-transactions-service');
    await addPaymentHistory(transactionId, { previousStatus: record.status, newStatus: record.status,
      eventType: 'refund_recovery_required', eventSource: 'system',
      description: 'Refund request interrupted; reconcile original provider outcome before retrying money movement', metadata: { attemptKey } }, tx);
  });
}

export async function queueOverstayOutcome(tx: Transaction, history: typeof storageOverstayHistory.$inferSelect) {
  const detection = ['detected', 'grace_period', 'pending_review'].includes(history.newStatus);
  if (!(detection && inRecurringWorker()) && !['penalty_approved', 'penalty_waived', 'charge_pending', 'charge_failed', 'charge_succeeded', 'escalated', 'resolved'].includes(history.newStatus)) return;
  const [record] = await tx.select().from(storageOverstayRecords).where(eq(storageOverstayRecords.id, history.overstayRecordId)).limit(1);
  if (!record || history.newStatus !== record.status) return;
  const { scheduleAdvanceReminders } = await import('./advance-reminders');
  await scheduleAdvanceReminders(tx, 'penalty', record.id);
  const [context] = await tx.select({ chefId: storageBookings.chefId, managerId: locations.managerId, notificationEmail: locations.notificationEmail }).from(storageBookings)
    .innerJoin(storageListings, eq(storageListings.id, storageBookings.storageListingId))
    .innerJoin(kitchens, eq(kitchens.id, storageListings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
    .where(eq(storageBookings.id, record.storageBookingId)).limit(1);
  if (!context) throw new Error('Overstay delivery context missing');
  const people = await tx.select().from(users).where(or(context.chefId ? eq(users.id, context.chefId) : undefined,
    context.managerId ? eq(users.id, context.managerId) : undefined, ['escalated', 'charge_failed'].includes(history.newStatus) ? eq(users.role, 'admin') : undefined));
  const title = `Storage penalty #${record.id}: ${history.newStatus.replaceAll('_', ' ')}`;
  const metadata = history.metadata as Record<string, unknown>;
  const money = detection || history.eventSource === 'cron' && history.newStatus === 'escalated'
    ? `Storage is ${record.daysOverdue} days past its recorded end. Current estimate: CAD $${(Number(record.calculatedPenaltyCents || 0) / 100).toFixed(2)}. Grace boundary: ${record.gracePeriodEndsAt?.toISOString() || 'See current issue'}. This is not an approved charge. Confirm actual removal and review the agreed terms before deciding a penalty.`
    : history.eventType === 'refund' ? `Recorded refund request: CAD $${(Number(metadata.refundAmount || 0) / 100).toFixed(2)}; reference ${metadata.refundId}. Completion depends on the provider.`
    : `Recorded penalty amount: CAD $${(Number(record.finalPenaltyCents || 0) / 100).toFixed(2)}. Approval is separate from payment. ${history.newStatus === 'charge_succeeded' ? `Payment succeeded: ${record.stripePaymentIntentId}.` : ''}`;
  const message = `${title}. ${money} ${history.newStatus === 'penalty_approved' && record.chefDisputeDeadline ? `Recorded dispute deadline: ${record.chefDisputeDeadline.toISOString()}.` : ''} Open the current storage issue for its current state and available actions.`;
  for (const person of people) {
    const chef = person.id === context.chefId;
    const destination = (detection || history.eventSource === 'cron' && history.newStatus === 'escalated') && person.id === context.managerId ? context.notificationEmail || person.username : person.username;
    const path = chef ? chefIssuesHref('overstay-penalties') : person.role === 'admin' ? '/admin?section=escalated-penalties' : managerDashboardView('overstays');
    await notificationService.create({ userId: person.id, target: chef ? 'chef' : 'manager', type: 'system_announcement',
      title, message, actionUrl: path, actionLabel: 'View current storage issue', metadata: { overstayRecordId: record.id, historyId: history.id } }, tx);
    if (!operationalEmailAllowed(person)) continue;
    await tx.insert(emailLogs).values({ recipientEmail: destination || '', recipientUserId: person.id,
      recipientRole: chef ? 'chef' : person.role === 'admin' ? 'admin' : 'manager', category: 'lifecycle_outcome', status: 'queued',
      subject: title, previewText: message, trackingId: `overstay-outcome:${record.id}:${history.id}:${person.id}`,
      textBody: `${message}\n\n${getAppBaseUrl(chef ? 'chef' : person.role === 'admin' ? 'admin' : 'kitchen')}${path}` });
  }
  if (inRecurringWorker() && context.notificationEmail && !people.some(person => person.id === context.managerId)) {
    await tx.insert(emailLogs).values({ recipientEmail: context.notificationEmail, recipientRole: 'manager',
      category: 'lifecycle_outcome', status: 'queued', subject: title, previewText: message,
      trackingId: `overstay-outcome:${record.id}:${history.id}:location-notice`,
      textBody: `${message}\n\n${getAppBaseUrl('kitchen')}${managerDashboardView('overstays')}` });
  }
}
