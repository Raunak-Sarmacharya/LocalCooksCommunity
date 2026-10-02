/** Stored cents and checkout snapshots are evidence; current listing rates are not. */
export function bookingItemPriceCents(id: number, storedCents: unknown, snapshots?: unknown) {
  const item = Array.isArray(snapshots) ? snapshots.find(entry => (entry.storageBookingId ?? entry.equipmentBookingId ?? entry.id) === id) : undefined;
  const value = item?.totalPrice ?? storedCents;
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') throw new Error('The recorded item amount needs Local Cooks review');
  const cents = Number(value);
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('The recorded item amount needs Local Cooks review');
  return cents;
}
