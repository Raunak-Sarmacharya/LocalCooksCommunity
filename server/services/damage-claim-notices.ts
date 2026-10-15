import { eq, inArray } from 'drizzle-orm';
import { emailLogs, users, type damageClaimHistory } from '@shared/schema';
import { ensureServerI18n, tLocale } from '../i18n';
import { notificationService } from './notification.service';
import { operationalEmailAllowed } from './admin-email-preferences';
import { getAppBaseUrl } from '../config';
import { getUserDisplayName } from '../utils/user-display';
import { chefCanSeeClaim, kitchenOnlyClaimActions, type Claim, type ClaimTx } from './damage-claims-v2';

/** Participant copy and delivery are scoped to the recipient; admin review routing stays separate. */
export async function queueDamageClaimNotice(tx: ClaimTx, claim: Claim, history: typeof damageClaimHistory.$inferSelect) {
  await ensureServerI18n();
  const review = ['under_review', 'in_review'].includes(claim.status);
  const admins = review ? await tx.select().from(users).where(eq(users.role, 'admin')) : [];
  const parties = await tx.select().from(users).where(inArray(users.id, chefCanSeeClaim(claim) ? [claim.chefId, claim.managerId] : [claim.managerId]));
  const event = history.action === 'booking_hold_started' ? 'hold' : history.action === 'claim_release_hold' ? 'released'
    : claim.status === 'in_review' ? 'firstReview' : claim.status === 'awaiting_kitchen' ? 'askInfo'
    : history.action === 'claim_withdrawn' ? 'withdrawn' : history.action === 'kitchen_paid' ? 'kitchenPaid' : history.action === 'chef_paid' ? 'paid'
    : claim.status === 'under_review' ? 'review' : history.action === 'claim_compensate' ? 'compensate'
    : ['rejected', 'resolved'].includes(claim.status) ? 'closed' : ['approved', 'partially_approved'].includes(claim.status) ? 'upheld' : 'sent';
  const publicMessage = (history.metadata as { publicMessage?: string })?.publicMessage || '';
  const chefName = await getUserDisplayName(claim.chefId, 'chef', tx);
  for (const person of [...parties, ...admins.filter(admin => !parties.some(party => party.id === admin.id))]) {
    const locale = person.preferredLocale || 'en-CA', chef = person.id === claim.chefId;
    const participant = chef || person.id === claim.managerId;
    // The chef needs no first-review/transfer updates. The kitchen gets one payment notice,
    // after the transfer succeeds; failed transfers retain their existing recovery path.
    if (participant && (chef && (['firstReview', 'askInfo', 'kitchenPaid'].includes(event)
      || event === 'compensate' && claim.status !== 'resolved' || !chefCanSeeClaim(claim))
      || !chef && ['paid', 'compensate', 'hold', 'released'].includes(event))) continue;
    const t = (key: string, values?: Record<string, unknown>) => tLocale(locale, `dcV2${key}`, { ns: 'booking', ...values });
    const amount = new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD' }).format((claim.finalAmountCents ?? claim.claimedAmountCents) / 100);
    const kitchen = claim.visitEvidence?.kitchenName || t('Kitchen');
    const deadline = new Intl.DateTimeFormat(locale, { timeZone: claim.visitEvidence?.timezone || 'America/St_Johns',
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(claim.chefResponseDeadline);
    const title = t('NoticeTitle', { kitchen, amount });
    const debt = claim.fundedBy === 'local_cooks' ? t(claim.chefOwes ? 'ChefOwes' : 'WriteOff') : '';
    // First-review messages are for the kitchen; the chef only hears Local Cooks' final decisions.
    const shared = chef && kitchenOnlyClaimActions.includes(history.action) ? '' : publicMessage;
    const requested = new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD' }).format(claim.claimedAmountCents / 100);
    const roleEvent = chef && event === 'compensate' ? 'closed'
      : event === 'kitchenPaid' ? claim.fundedBy === 'local_cooks' ? 'localPaid' : 'paid' : event;
    const roleKey = `Notice${chef ? 'Chef' : 'Kitchen'}_${roleEvent}`;
    const reduction = claim.finalAmountCents != null && claim.finalAmountCents < claim.claimedAmountCents ? t('NoticeReduction', { claimed: requested }) : '';
    const message = participant
      ? `${t(roleKey, { kitchen, chef: chefName && chefName !== 'A chef' ? chefName : t('Chef'), amount, deadline, reduction, message: publicMessage }).replace(/\.\.$/, '.')}${!chef && ['sent', 'closed', 'upheld'].includes(event) && publicMessage ? ` ${publicMessage}` : ''}`
      : `${t(`Notice_${event}`, { kitchen, amount, deadline })} ${debt} ${shared}`.trim();
    const path = person.role === 'admin' ? `/admin?section=booking-support&booking=${claim.kitchenBookingId}`
      : chef ? `/booking/${claim.kitchenBookingId}` : `/manager/booking/${claim.kitchenBookingId}`;
    await notificationService.create({ userId: person.id, target: chef ? 'chef' : 'manager', type: 'system_announcement',
      priority: review ? 'high' : 'normal', title, message, actionUrl: path, actionLabel: t('View'),
      metadata: { damageClaimId: claim.id, historyId: history.id } }, tx);
    // Filing is the kitchen’s own action; admins retain both channels.
    if (person.id === claim.managerId && history.action === 'submitted' || !operationalEmailAllowed(person)) continue;
    await tx.insert(emailLogs).values({ recipientEmail: person.username, recipientUserId: person.id, recipientRole: chef ? 'chef' : person.role || 'manager',
      subject: title, previewText: message, category: 'lifecycle_outcome', status: 'queued',
      trackingId: `claim-outcome:${claim.id}:${history.id}:${person.id}`, textBody: `${message}\n\n${getAppBaseUrl(chef ? 'chef' : person.role === 'admin' ? 'admin' : 'kitchen')}${path}` });
  }
}
