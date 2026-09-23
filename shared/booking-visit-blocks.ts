import type { OperatingSlot } from './operating-hours';

export type BookingVisitBlock = { startTime: string; endTime: string };

/** A gap starts a new visit; the booking and payment still cover all slots. */
export function bookingVisitBlocks(slots: OperatingSlot[]): BookingVisitBlock[] {
  const blocks: BookingVisitBlock[] = [];
  for (const slot of slots) {
    const last = blocks[blocks.length - 1];
    if (last?.endTime === slot.startTime) last.endTime = slot.endTime;
    else blocks.push({ startTime: slot.startTime, endTime: slot.endTime });
  }
  return blocks;
}
