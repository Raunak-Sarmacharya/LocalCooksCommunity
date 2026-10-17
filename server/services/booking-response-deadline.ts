import { eq } from 'drizzle-orm';
import { kitchens, locations } from '@shared/schema';
import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';
import { responseDeadlineForBooking, bookingFirstStart } from '@shared/booking-response-deadline';
import { partialAcceptanceAllowed } from '@shared/partial-acceptance';
import { db } from '../db';
import { getLifecycleSettings } from './lifecycle-settings';

type Reader = Pick<typeof db, 'select'>;
type Booking = Parameters<typeof responseDeadlineForBooking>[0] & { kitchenId: number };
async function kitchenTimezone(kitchenId: number, reader: Reader) {
  const [row] = await reader.select({ timezone: locations.timezone }).from(kitchens)
    .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(kitchens.id, kitchenId)).limit(1);
  return row?.timezone || DEFAULT_TIMEZONE;
}

export async function getBookingResponseDeadline(booking: Booking, reader: Reader = db, timezone?: string | null) {
  const timing = await getLifecycleSettings(reader);
  return responseDeadlineForBooking(booking, timezone || await kitchenTimezone(booking.kitchenId, reader), timing.managerResponseBufferHours);
}

/**
 * The chef's answer window if the kitchen accepted without some equipment now: the request rule measured from now
 * (24 h, or an hour before the refund deadline if sooner), and whether it leaves the chef enough time (owner, Oct 17).
 */
export async function getPartialAcceptanceWindow(booking: Booking, now = new Date(), reader: Reader = db, timezone?: string | null) {
  const zone = timezone || await kitchenTimezone(booking.kitchenId, reader);
  const deadline = await getBookingResponseDeadline({ ...booking, createdAt: now }, reader, zone);
  return { deadline, allowed: partialAcceptanceAllowed(deadline, bookingFirstStart(booking, zone), now) };
}

export async function getBookingResponseDeadlineAt(booking: Booking, reader: Reader = db, timezone?: string | null) {
  return booking.status === 'pending' ? (await getBookingResponseDeadline(booking, reader, timezone)).toISOString() : null;
}
