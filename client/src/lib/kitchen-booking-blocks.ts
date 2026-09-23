import { bookingVisitBlocks } from '@shared/booking-visit-blocks';
import { addHour, sortTimesInOperatingWindow } from '@shared/operating-hours';

type Slot = string | { startTime: string; endTime: string };

export function kitchenBookingBlocks(booking: {
  startTime: string;
  endTime: string;
  operatingWindowStartTime?: string | null;
  selectedSlots?: Slot[] | null;
}) {
  const slots = booking.selectedSlots?.map(slot => typeof slot === 'string'
    ? { startTime: slot, endTime: addHour(slot) } : slot);
  if (!slots?.length) return [{ startTime: booking.startTime, endTime: booking.endTime }];
  const orderedStarts = sortTimesInOperatingWindow(slots.map(slot => slot.startTime),
    booking.operatingWindowStartTime || booking.startTime);
  return bookingVisitBlocks(orderedStarts.map(start => slots.find(slot => slot.startTime === start)!));
}
