/**
 * Upcoming versus past for a booking list. A booking is past when it is finished (completed or
 * cancelled, an arrival was checked out) or its end instant, resolved in the kitchen zone by the
 * caller, has passed. Display only.
 */
export interface BookingListSplitInput {
  status: string;
  checkinStatus?: string | null;
  /** Visit end as a real instant (kitchen zone already applied); null when it cannot be resolved. */
  endAt?: Date | null;
  now?: number;
}

const FINISHED_STATUSES = ['completed', 'cancelled', 'rejected', 'expired', 'declined'];
const FINISHED_VISITS = ['checked_out', 'no_show', 'checkout_claim_filed'];

export function isBookingListPast(input: BookingListSplitInput): boolean {
  if (FINISHED_STATUSES.includes(input.status)) return true;
  if (FINISHED_VISITS.includes(input.checkinStatus || '')) return true;
  if (!input.endAt || Number.isNaN(input.endAt.getTime())) return false;
  return (input.now ?? Date.now()) >= input.endAt.getTime();
}
