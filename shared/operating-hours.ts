const MINUTES_PER_DAY = 24 * 60;

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 24 || minutes < 0 || minutes > 59 || (hours === 24 && minutes !== 0)) {
    throw new Error(`Invalid time: ${time}`);
  }
  return hours * 60 + minutes;
}

export function minutesInOperatingWindow(time: string, windowStart: string): number {
  const start = timeToMinutes(windowStart);
  const minutes = timeToMinutes(time);
  return minutes < start ? minutes + MINUTES_PER_DAY : minutes;
}

export function getHourlySlotStarts(startTime: string, endTime: string): string[] {
  const start = timeToMinutes(startTime);
  let end = timeToMinutes(endTime);
  if (end === start) return [];
  if (end < start) end += MINUTES_PER_DAY;

  const slots: string[] = [];
  for (let minutes = start; minutes < end; minutes += 60) {
    const normalized = minutes % MINUTES_PER_DAY;
    slots.push(`${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`);
  }
  return slots;
}

export function addHour(time: string): string {
  const normalized = (timeToMinutes(time) + 60) % MINUTES_PER_DAY;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

export function isRangeWithinOperatingWindow(
  startTime: string,
  endTime: string,
  windowStartTime: string,
  windowEndTime: string,
): boolean {
  const windowStart = timeToMinutes(windowStartTime);
  let windowEnd = timeToMinutes(windowEndTime);
  if (windowEnd <= windowStart) windowEnd += MINUTES_PER_DAY;

  const rangeStart = minutesInOperatingWindow(startTime, windowStartTime);
  let rangeEnd = minutesInOperatingWindow(endTime, windowStartTime);
  if (rangeEnd <= rangeStart) rangeEnd += MINUTES_PER_DAY;
  return rangeStart >= windowStart && rangeEnd <= windowEnd;
}

export function isSlotCoveredByRange(
  slotTime: string,
  rangeStartTime: string,
  rangeEndTime: string,
  windowStartTime: string,
): boolean {
  const slot = minutesInOperatingWindow(slotTime, windowStartTime);
  const rangeStart = minutesInOperatingWindow(rangeStartTime, windowStartTime);
  let rangeEnd = minutesInOperatingWindow(rangeEndTime, windowStartTime);
  if (rangeEnd <= rangeStart) rangeEnd += MINUTES_PER_DAY;
  return slot >= rangeStart && slot < rangeEnd;
}

/** Inclusive-start / exclusive-end style overlap on one operating-day timeline. */
export function intervalsOverlapOnOperatingDay(
  a: { startTime: string; endTime: string },
  b: { startTime: string; endTime: string },
  windowStartTime: string,
): boolean {
  const aStart = minutesInOperatingWindow(a.startTime, windowStartTime);
  let aEnd = minutesInOperatingWindow(a.endTime, windowStartTime);
  if (aEnd <= aStart) aEnd += MINUTES_PER_DAY;
  const bStart = minutesInOperatingWindow(b.startTime, windowStartTime);
  let bEnd = minutesInOperatingWindow(b.endTime, windowStartTime);
  if (bEnd <= bStart) bEnd += MINUTES_PER_DAY;
  return aStart < bEnd && aEnd > bStart;
}

export function sortTimesInOperatingWindow(times: string[], windowStartTime: string): string[] {
  return [...times].sort(
    (left, right) =>
      minutesInOperatingWindow(left, windowStartTime) - minutesInOperatingWindow(right, windowStartTime),
  );
}

export type OperatingSlot = { startTime: string; endTime: string };

/** Compare occupancy across operating days using Newfoundland wall-clock minutes. */
export function absoluteOperatingSlotInterval(
  operatingDate: string, slot: OperatingSlot, windowStartTime: string,
): { start: number; end: number } {
  const day = Date.parse(`${operatingDate}T00:00:00Z`) / 60_000;
  if (!Number.isFinite(day)) throw new Error('Invalid operating date');
  const start = day + minutesInOperatingWindow(slot.startTime, windowStartTime);
  let end = day + minutesInOperatingWindow(slot.endTime, windowStartTime);
  if (end <= start) end += MINUTES_PER_DAY;
  return { start, end };
}

export function operatingSlotsOverlapAcrossDates(
  firstDate: string, firstSlot: OperatingSlot, firstWindowStart: string,
  secondDate: string, secondSlot: OperatingSlot, secondWindowStart: string,
): boolean {
  const first = absoluteOperatingSlotInterval(firstDate, firstSlot, firstWindowStart);
  const second = absoluteOperatingSlotInterval(secondDate, secondSlot, secondWindowStart);
  return first.start < second.end && first.end > second.start;
}

/** The operating date is the date the window starts, including its after-midnight tail. */
export function normalizeBookingSlots(
  selectedSlots: unknown,
  startTime: string,
  endTime: string,
  windowStartTime: string,
  windowEndTime: string,
  fullDay: boolean,
): OperatingSlot[] {
  const available = getHourlySlotStarts(windowStartTime, windowEndTime);
  if (!available.length || available.some(start => !isRangeWithinOperatingWindow(start, addHour(start), windowStartTime, windowEndTime))) {
    throw new Error('Kitchen operating hours must contain whole hourly slots');
  }
  if (!Array.isArray(selectedSlots)) throw new Error('Selected slots must be an array');
  const requested = selectedSlots.length
    ? selectedSlots
    : getHourlySlotStarts(startTime, endTime).map(start => ({ startTime: start, endTime: addHour(start) }));
  if (!requested.length) throw new Error('Select at least one hourly slot');
  const availableSet = new Set(available);
  const seen = new Set<string>();
  for (const slot of requested) {
    if (!slot || typeof slot.startTime !== 'string' || typeof slot.endTime !== 'string'
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.startTime)
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.endTime)
      || slot.endTime !== addHour(slot.startTime)
      || !availableSet.has(slot.startTime)
      || seen.has(slot.startTime)) {
      throw new Error('Selected slots must be distinct one-hour periods within operating hours');
    }
    seen.add(slot.startTime);
  }
  if (fullDay && (seen.size !== available.length || available.some(slot => !seen.has(slot)))) {
    throw new Error('A daily booking must include the full operating day');
  }
  const ordered = sortTimesInOperatingWindow(Array.from(seen), windowStartTime);
  if (startTime !== ordered[0] || endTime !== addHour(ordered.at(-1)!)) {
    throw new Error('Booking start and end must match the selected slots');
  }
  return ordered.map(start => ({ startTime: start, endTime: addHour(start) }));
}

/** Old bookings without selected slots continue to reserve their complete envelope. */
export function occupiedIntervals(booking: { startTime: string; endTime: string; selectedSlots?: unknown }): OperatingSlot[] {
  if (Array.isArray(booking.selectedSlots) && booking.selectedSlots.length > 0) {
    const slots = booking.selectedSlots.filter((slot): slot is OperatingSlot =>
      !!slot && typeof slot.startTime === 'string' && typeof slot.endTime === 'string');
    if (slots.length === booking.selectedSlots.length) return slots;
  }
  return [{ startTime: booking.startTime, endTime: booking.endTime }];
}

export function calendarDateForOperatingTime(operatingDate: string, time: string, windowStartTime: string): string {
  const [year, month, day] = operatingDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + (timeToMinutes(time) < timeToMinutes(windowStartTime) ? 1 : 0), 12));
  return date.toISOString().slice(0, 10);
}

/** Resolve a saved booking's local calendar date; legacy rows lack a window snapshot. */
export function calendarDateForBookingTime(
  operatingDate: string, time: string, windowStartTime?: string | null, bookingStartTime?: string,
): string {
  if (windowStartTime) return calendarDateForOperatingTime(operatingDate, time, windowStartTime);
  if (bookingStartTime && time <= bookingStartTime) {
    return calendarDateForOperatingTime(operatingDate, '00:00', '23:00');
  }
  return operatingDate;
}

export function isValidOperatingWindow(startTime: unknown, endTime: unknown): boolean {
  if (typeof startTime !== 'string' || typeof endTime !== 'string'
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) return false;
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  const duration = (end - start + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return duration > 0 && duration % 60 === 0;
}

export function operatingWindowsOverlapAcrossDays(
  previous: { isAvailable: boolean; startTime: string; endTime: string },
  next: { isAvailable: boolean; startTime: string; endTime: string },
): boolean {
  return previous.isAvailable && next.isAvailable
    && timeToMinutes(previous.endTime) <= timeToMinutes(previous.startTime)
    && timeToMinutes(next.startTime) < timeToMinutes(previous.endTime);
}
