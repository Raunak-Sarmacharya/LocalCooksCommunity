import { fetchManagerBookings } from './manager-bookings-query';
import { useQuery } from '@tanstack/react-query';
import { createBookingDateTime } from '@shared/timezone-utils';
import { bookingStartDateKey } from './calendar-date';

export type SettingImpact = { upcoming: number; inSession: number; pending: number };
export type ImpactBooking = {
  locationId?: number; locationName?: string; kitchenName?: string; kitchenId: number; status: string; bookingDate: string | Date; startTime: string;
  operatingWindowStartTime?: string | null; checkinStatus?: string | null; visits?: Array<{ checkinStatus?: string | null }>;
  timezone?: string | null; location?: { id?: number; timezone?: string | null };
  kitchen?: { locationId?: number; location?: { timezone?: string | null } };
};

export function settingImpact(bookings: ImpactBooking[], kitchenId?: number, now = new Date()): SettingImpact {
  const impact = { upcoming: 0, inSession: 0, pending: 0 };
  for (const booking of bookings) {
    if (kitchenId != null && booking.kitchenId !== kitchenId) continue;
    if (booking.status === 'pending') impact.pending++;
    const checkedIn = booking.checkinStatus === 'checked_in' || booking.visits?.some(visit => visit.checkinStatus === 'checked_in');
    if (checkedIn) impact.inSession++;
    const zone = booking.timezone || booking.location?.timezone || booking.kitchen?.location?.timezone;
    const day = bookingStartDateKey(booking);
    if (booking.status === 'confirmed' && zone && day && !checkedIn
      && createBookingDateTime(day, booking.startTime, zone) > now) impact.upcoming++;
  }
  return impact;
}

/** Share the manager list cache, fetching it when settings are opened first. */
export function useSettingImpact(kitchenId?: number, locationId?: number, names?: { location?: string; kitchen?: string }) {
  const { data, isFetching, isError } = useQuery<ImpactBooking[]>({ queryKey: ['managerBookings'], queryFn: fetchManagerBookings });
  const impact = data ? settingImpact(data.filter(row => (locationId == null || (row.locationId ?? row.location?.id ?? row.kitchen?.locationId) === locationId)
    && (!names?.location || row.locationName === names.location) && (!names?.kitchen || row.kitchenName === names.kitchen)), kitchenId) : undefined;
  return { impact, impactFetching: isFetching, impactError: isError };
}
