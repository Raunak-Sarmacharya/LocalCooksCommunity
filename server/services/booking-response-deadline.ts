import { eq } from 'drizzle-orm';
import { kitchens, locations } from '@shared/schema';
import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';
import { responseDeadlineForBooking } from '@shared/booking-response-deadline';
import { db } from '../db';
import { getLifecycleSettings } from './lifecycle-settings';

type Reader = Pick<typeof db, 'select'>;
type Booking = Parameters<typeof responseDeadlineForBooking>[0] & { kitchenId: number };
export async function getBookingResponseDeadline(booking: Booking, reader: Reader = db, timezone?: string | null) {
  const timing = await getLifecycleSettings(reader);
  if (!timezone) {
    const [row] = await reader.select({ timezone: locations.timezone }).from(kitchens)
      .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(kitchens.id, booking.kitchenId)).limit(1);
    timezone = row?.timezone || DEFAULT_TIMEZONE;
  }
  return responseDeadlineForBooking(booking, timezone, timing.managerResponseBufferHours);
}

export async function getBookingResponseDeadlineAt(booking: Booking, reader: Reader = db, timezone?: string | null) {
  return booking.status === 'pending' ? (await getBookingResponseDeadline(booking, reader, timezone)).toISOString() : null;
}
