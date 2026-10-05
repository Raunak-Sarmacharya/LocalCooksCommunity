import { addHour, sortTimesInOperatingWindow, type OperatingSlot } from './operating-hours';

export const CONSECUTIVE_SLOTS_MESSAGE = 'Select consecutive hours for one continuous kitchen visit. Remove hours from either end or start a new selection.';

/** Fresh selections only. Historical occupancy and recorded checkout replay may contain gaps. */
export function assertConsecutiveBookingSlots(slots: OperatingSlot[], windowStart: string): void {
  const times = slots.map(slot => slot.startTime);
  if (!times.length || new Set(times).size !== times.length
    || slots.some(slot => !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.startTime)
      || slot.endTime !== addHour(slot.startTime))) throw new Error(CONSECUTIVE_SLOTS_MESSAGE);
  const ordered = sortTimesInOperatingWindow(times, windowStart);
  if (ordered.some((time, index) => index > 0 && time !== addHour(ordered[index - 1]))) {
    throw new Error(CONSECUTIVE_SLOTS_MESSAGE);
  }
}

/** Also used for restored drafts and the confirm-step time editor. Never fills intervening hours. */
export function validateKitchenSlotSelection(
  times: string[], available: { time: string; isFullyBooked: boolean }[], minimum = 1, maximum = Infinity,
): string | null {
  if (!times.length) return 'Select consecutive available hours to continue.';
  try {
    assertConsecutiveBookingSlots(times.map(startTime => ({ startTime, endTime: addHour(startTime) })), available[0]?.time || times[0]);
  } catch { return CONSECUTIVE_SLOTS_MESSAGE; }
  if (times.some(time => !available.some(slot => slot.time === time && !slot.isFullyBooked))) {
    return 'One or more selected hours are unavailable. Choose a new consecutive range.';
  }
  if (times.length < minimum) return `Select at least ${minimum} consecutive hours to continue.`;
  if (times.length > maximum) return `Select no more than ${maximum} consecutive hours.`;
  return null;
}
