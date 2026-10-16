/**
 * "Change request": a chef changes a PENDING request by sending a new one first. The booking flow opens pre-filled from
 * the old request (`replaces=<bookingId>`); the old request stays until the new one is sent. Pure helpers shared by the
 * booking page (entry link) and the flow (reading the link).
 */
export interface ChangeRequestSource {
  id: number;
  kitchenId: number;
  locationId?: number | null;
  bookingDate: string;
  startTime: string;
  endTime: string;
  pricingMode?: 'hourly' | 'daily' | null;
  selectedSlots?: Array<{ startTime: string; endTime: string }> | null;
  specialNotes?: string | null;
  equipmentBookings?: Array<{ equipmentListingId: number; status: string }> | null;
  storageBookings?: Array<{ storageListingId: number; startDate: string; endDate: string; status: string }> | null;
}

const clock = (value: string) => value.slice(0, 5);

/** The booked hours as "HH:MM" start times, in the order the kitchen's day runs. */
export function changeRequestSlots(source: Pick<ChangeRequestSource, 'startTime' | 'endTime' | 'selectedSlots' | 'pricingMode'>): string[] {
  if (source.pricingMode === 'daily') return [];
  if (source.selectedSlots?.length) return source.selectedSlots.map(slot => clock(slot.startTime));
  const hours: string[] = [];
  const start = Number(clock(source.startTime).slice(0, 2));
  let end = Number(clock(source.endTime).slice(0, 2));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return hours;
  if (end <= start) end += 24;
  for (let hour = start; hour < end; hour++) hours.push(`${String(hour % 24).padStart(2, '0')}:00`);
  return hours;
}

/** Where "Change request" goes, or null when the booking has no location to book at. */
export function changeRequestHref(source: ChangeRequestSource): string | null {
  if (!source.locationId) return null;
  const params = new URLSearchParams({ kitchenId: String(source.kitchenId), replaces: String(source.id) });
  const date = source.bookingDate.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) params.set('date', date);
  const slots = changeRequestSlots(source);
  if (slots.length) params.set('slots', slots.join(','));
  if (source.specialNotes?.trim()) params.set('notes', source.specialNotes);
  const equipment = (source.equipmentBookings || []).filter(item => item.status !== 'cancelled').map(item => item.equipmentListingId);
  if (equipment.length) params.set('equipment', equipment.join(','));
  const storage = (source.storageBookings || []).filter(item => item.status !== 'cancelled')
    .map(item => ({ storageListingId: item.storageListingId, startDate: item.startDate, endDate: item.endDate }));
  if (storage.length) params.set('storage', encodeURIComponent(JSON.stringify(storage)));
  return `/book/${source.locationId}?${params.toString()}`;
}

/** The earlier request id the flow is replacing, from the page's query string. */
export function replacesFromSearch(search: string): number | undefined {
  const value = Number(new URLSearchParams(search).get('replaces'));
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
