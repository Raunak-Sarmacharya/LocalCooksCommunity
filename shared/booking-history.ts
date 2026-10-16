const kinds = ['requested', 'confirmed', 'cancelled', 'cancellation_requested', 'cancellation_declined',
  'cancellation_reviewed', 'refund_issued', 'addon_removed', 'goodwill_refunded', 'payment_recovery_needed', 'item_withdrawn', 'item_cancellation_requested',
  'checkin_recorded', 'checkout_requested', 'checkout_cleared', 'checkout_claim_filed',
  'report_no_show', 'report_attended', 'withdraw_attendance', 'kitchen_change_requested', 'kitchen_change_applied',
  'kitchen_change_declined', 'kitchen_change_withdrawn', 'kitchen_change_expired',
  'ext_requested', 'ext_offered', 'ext_approved', 'ext_accepted', 'ext_paid', 'ext_declined', 'ext_expired', 'ext_withdrawn', 'ext_refunded',
  'replaced_by', 'replaces'] as const;
/** Same-instant events read in lifecycle order (requested before confirmed), then by key. */
export function compareHistoryEvents(a: { kind: string; recordedAt: string; key: string }, b: { kind: string; recordedAt: string; key: string }): number {
  const rank = (kind: string) => { const index = (kinds as readonly string[]).indexOf(kind); return index < 0 ? kinds.length : index; };
  return Date.parse(a.recordedAt) - Date.parse(b.recordedAt) || rank(a.kind) - rank(b.kind) || a.key.localeCompare(b.key);
}
export type BookingHistoryEvent = { key: string; kind: typeof kinds[number]; recordedAt: string; visitId?: number; itemKind?: 'storage' | 'equipment'; itemId?: number;
  /** `addon_removed` only: the add-on's name and what was refunded for it (0 when it wasn't charged or isn't refundable). */ itemName?: string; refundedCents?: number; refundState?: 'processing' | 'fee_pending' | 'sent';
  /** Cents; on `goodwill_refunded` (a Local Cooks-funded refund; the kitchen payout is unchanged) and extra-time money events. */ amountCents?: number;
  /** Extra-time events only: who started it (`ask` chef request, `offer` kitchen offer, `early` earlier start, `charge` kitchen charge) and the minutes involved. */
  extFlow?: ExtensionFlow; minutes?: number;
  /** `replaced_by` / `replaces` only: the booking reference on the other side of the link. */
  otherRef?: string;
  /** `replaced_by` / `replaces` only: the other booking's id, for a link (its own page still checks access). */
  otherBookingId?: number };
export type ExtensionFlow = 'ask' | 'offer' | 'early' | 'charge';
export type BookingHistoryResponse = { events: BookingHistoryEvent[]; complete: boolean };
type Facts = { createdAt?: unknown; cancellationRequestedAt?: unknown; cancellationRequestDeclinedAt?: unknown;
  checkedInAt?: unknown; checkoutRequestedAt?: unknown; checkoutApprovedAt?: unknown };
type RecordedEvent = { id: number; kind: string; createdAt: unknown; metadata?: unknown;
  /** Records from another table (payment history) pass their own key so ids never collide with lifecycle ids. */ key?: string };
const instant = (value: unknown) => {
  if (!(value instanceof Date) && typeof value !== 'string') return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
};
const positiveId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;

/** Project recorded facts only. Delivery messages, payment identifiers and internal notes stay private. */
export type ExtensionRow = { id: number; kind: string; status: string; minutes: number; amountCents: number; free?: boolean | null; autoApprove?: boolean | null;
  createdAt: unknown; updatedAt?: unknown; authorizedAt?: unknown; paidAt?: unknown; appliedAt?: unknown; refundedAt?: unknown; operation?: { decidedAt?: unknown } | null };

/** Extra-time rows (session extensions, offers and charges) as history events. No payment identifiers cross. */
export function extensionHistoryEvents(rows: ExtensionRow[]): BookingHistoryEvent[] {
  const events: BookingHistoryEvent[] = [];
  for (const row of rows) {
    const extFlow: ExtensionFlow | undefined = row.kind === 'request' ? 'ask' : row.kind === 'offer' ? 'offer' : row.kind === 'early_start' ? 'early' : row.kind === 'extra_time' ? 'charge' : undefined;
    if (!extFlow) continue;
    const base = { extFlow, ...(Number.isSafeInteger(row.minutes) && row.minutes > 0 ? { minutes: row.minutes } : {}) };
    const paid = row.amountCents > 0 && !row.free;
    const add = (kind: BookingHistoryEvent['kind'], value: unknown, extra: Partial<BookingHistoryEvent> = {}) => {
      const recordedAt = instant(value);
      if (recordedAt) events.push({ key: `ext-${row.id}-${kind}`, kind, recordedAt, ...base, ...extra });
    };
    add(extFlow === 'ask' || extFlow === 'charge' ? 'ext_requested' : 'ext_offered', row.createdAt, extFlow === 'charge' && paid ? { amountCents: row.amountCents } : {});
    const decidedAt = row.operation?.decidedAt ?? row.updatedAt;
    if (['approved', 'paid'].includes(row.status) && extFlow !== 'charge') {
      // An auto-approved request has no kitchen decision to show; the payment line says it all.
      if (!(extFlow === 'ask' && row.autoApprove)) add(extFlow === 'ask' ? 'ext_approved' : 'ext_accepted', row.authorizedAt ?? row.paidAt ?? row.appliedAt ?? decidedAt);
    }
    if (paid && (row.paidAt || (row.status === 'paid' || (row.status === 'approved' && row.appliedAt)))) add('ext_paid', row.paidAt ?? row.appliedAt ?? row.updatedAt, { amountCents: row.amountCents });
    if (row.status === 'declined') add('ext_declined', decidedAt);
    if (row.status === 'expired') add('ext_expired', decidedAt);
    if (row.status === 'cancelled') add('ext_withdrawn', decidedAt);
    if (row.refundedAt && paid) add('ext_refunded', row.refundedAt, { amountCents: row.amountCents });
  }
  return events;
}

export function buildBookingHistory(booking: Facts, records: RecordedEvent[], visits: Array<Facts & { id: number }> = [], extensions: ExtensionRow[] = []): BookingHistoryResponse {
  const events: BookingHistoryEvent[] = extensionHistoryEvents(extensions);
  for (const record of records) {
    const recordedAt = instant(record.createdAt);
    if (!recordedAt || !kinds.includes(record.kind as BookingHistoryEvent['kind'])) continue;
    const metadata = record.metadata && typeof record.metadata === 'object' ? record.metadata as Record<string, unknown> : {};
    const quote = metadata.quote && typeof metadata.quote === 'object' ? metadata.quote as Record<string, unknown> : {};
    const scope = quote.scope && typeof quote.scope === 'object' ? quote.scope as Record<string, unknown> : {};
    const itemKind = metadata.itemKind ?? scope.kind, itemId = metadata.itemId ?? scope.id;
    const addon = metadata.addonRemoval && typeof metadata.addonRemoval === 'object' ? metadata.addonRemoval as Record<string, unknown> : undefined;
    // Notices addressed only to Local Cooks are not part of the chef's or kitchen's booking history.
    if (metadata.recipientPolicy === 'admins') continue;
    // The refund line of an add-on removal is part of the removal row itself.
    if (record.kind === 'refund_issued' && addon) continue;
    if (record.kind === 'addon_removed' && typeof addon?.itemName !== 'string') continue;
    const amount = record.kind === 'goodwill_refunded' && Number.isSafeInteger(metadata.amountCents) && Number(metadata.amountCents) > 0 ? Number(metadata.amountCents) : undefined;
    // A goodwill refund without a known amount cannot say what was refunded, so it is left out.
    if (record.kind === 'goodwill_refunded' && !amount) continue;
    events.push({ key: record.key ?? 'event-' + record.id, kind: record.kind as BookingHistoryEvent['kind'], recordedAt,
      ...(amount ? { amountCents: amount } : {}),
      ...((record.kind === 'replaced_by' || record.kind === 'replaces') && typeof metadata.otherRef === 'string' && metadata.otherRef ? { otherRef: metadata.otherRef.slice(0, 40) } : {}),
      ...((record.kind === 'replaced_by' || record.kind === 'replaces') && positiveId(Number(metadata.otherBookingId)) ? { otherBookingId: Number(metadata.otherBookingId) } : {}),
      ...(record.kind === 'addon_removed' && typeof addon?.itemName === 'string' ? (() => {
        const completed = records.find(row => {
          const m = row.metadata as Record<string, any> | undefined;
          return row.kind === 'refund_issued' && m?.addonRemoval?.state === 'sent' &&
            (metadata.operationId && m.operationId === metadata.operationId || positiveId(itemId) && m.itemId === itemId && m.itemKind === itemKind);
        });
        const outcome = completed ? (completed.metadata as Record<string, any>).addonRemoval : addon;
        return { itemName: addon.itemName, refundState: outcome.state === 'fee_pending' ? 'fee_pending' as const : outcome.state === 'processing' ? 'processing' as const : 'sent' as const,
          refundedCents: Number.isSafeInteger(outcome.refundCents) && Number(outcome.refundCents) > 0 && !outcome.free ? Number(outcome.refundCents) : 0 };
      })() : {}),
      ...(positiveId(metadata.visitId) ? { visitId: metadata.visitId } : {}),
      ...((itemKind === 'storage' || itemKind === 'equipment') && positiveId(itemId)
        ? { itemKind, itemId } : {}) });
  }
  const complete = events.some(event => event.kind === 'requested');
  const fact = (kind: BookingHistoryEvent['kind'], value: unknown, visitId?: number) => {
    const recordedAt = instant(value);
    if (!recordedAt || events.some(event => event.kind === kind && (visitId === undefined || event.visitId === visitId || event.visitId === undefined))) return;
    events.push({ key: `fact-${kind}-${visitId || 'booking'}`, kind, recordedAt, ...(visitId ? { visitId } : {}) });
  };
  fact('requested', booking.createdAt);
  fact('cancellation_requested', booking.cancellationRequestedAt);
  fact('cancellation_declined', booking.cancellationRequestDeclinedAt);
  for (const visit of visits.length ? visits : [{ ...booking, id: undefined }]) {
    const visitId = visit.id;
    fact('checkin_recorded', visit.checkedInAt, visitId);
    fact('checkout_requested', visit.checkoutRequestedAt, visitId);
    fact('checkout_cleared', visit.checkoutApprovedAt, visitId);
  }
  return { events: events.sort(compareHistoryEvents), complete };
}
