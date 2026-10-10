const kinds = ['requested', 'confirmed', 'cancelled', 'cancellation_requested', 'cancellation_declined',
  'cancellation_reviewed', 'refund_issued', 'payment_recovery_needed', 'item_withdrawn', 'item_cancellation_requested',
  'checkin_recorded', 'checkout_requested', 'checkout_cleared', 'checkout_claim_filed',
  'report_no_show', 'report_attended', 'withdraw_attendance', 'kitchen_change_requested', 'kitchen_change_applied',
  'kitchen_change_declined', 'kitchen_change_withdrawn', 'kitchen_change_expired'] as const;
export type BookingHistoryEvent = { key: string; kind: typeof kinds[number]; recordedAt: string; visitId?: number; itemKind?: 'storage' | 'equipment'; itemId?: number };
export type BookingHistoryResponse = { events: BookingHistoryEvent[]; complete: boolean };
type Facts = { createdAt?: unknown; cancellationRequestedAt?: unknown; cancellationRequestDeclinedAt?: unknown;
  checkedInAt?: unknown; checkoutRequestedAt?: unknown; checkoutApprovedAt?: unknown };
type RecordedEvent = { id: number; kind: string; createdAt: unknown; metadata?: unknown };
const instant = (value: unknown) => {
  if (!(value instanceof Date) && typeof value !== 'string') return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
};
const positiveId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;

/** Project recorded facts only. Delivery messages, payment identifiers and internal notes stay private. */
export function buildBookingHistory(booking: Facts, records: RecordedEvent[], visits: Array<Facts & { id: number }> = []): BookingHistoryResponse {
  const events: BookingHistoryEvent[] = [];
  for (const record of records) {
    const recordedAt = instant(record.createdAt);
    if (!recordedAt || !kinds.includes(record.kind as BookingHistoryEvent['kind'])) continue;
    const metadata = record.metadata && typeof record.metadata === 'object' ? record.metadata as Record<string, unknown> : {};
    const quote = metadata.quote && typeof metadata.quote === 'object' ? metadata.quote as Record<string, unknown> : {};
    const scope = quote.scope && typeof quote.scope === 'object' ? quote.scope as Record<string, unknown> : {};
    const itemKind = metadata.itemKind ?? scope.kind, itemId = metadata.itemId ?? scope.id;
    events.push({ key: 'event-' + record.id, kind: record.kind as BookingHistoryEvent['kind'], recordedAt,
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
  return { events: events.sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt) || a.key.localeCompare(b.key)), complete };
}
