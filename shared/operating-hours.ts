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
