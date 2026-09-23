import { calendarDateForOperatingTime, type OperatingSlot } from './operating-hours';

const formatters = new Map<string, Intl.DateTimeFormat>();

function localParts(instant: number, timezone: string): string {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    formatters.set(timezone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Return all real instants matching a kitchen-local wall time (zero, one, or two at DST). */
export function matchingLocalInstants(date: string, time: string, timezone: string): number[] {
  const target = `${date}T${time}`;
  const wallAsUtc = Date.parse(`${target}:00Z`);
  if (!Number.isFinite(wallAsUtc)) return [];
  const offsets = new Set<number>();
  for (const hours of [-24, -12, 0, 12, 24]) {
    const sample = wallAsUtc + hours * 3_600_000;
    const [sampleDate, sampleTime] = localParts(sample, timezone).split('T');
    offsets.add(Date.parse(`${sampleDate}T${sampleTime}:00Z`) - sample);
  }
  return Array.from(new Set(Array.from(offsets).map(offset => wallAsUtc - offset)))
    .filter(instant => localParts(instant, timezone) === target).sort((a, b) => a - b);
}

/** One bookable wall-clock hour must mean exactly one elapsed hour. */
export function isUnambiguousBookingSlot(
  operatingDate: string, slot: OperatingSlot, windowStartTime: string, timezone: string,
): boolean {
  const startDate = calendarDateForOperatingTime(operatingDate, slot.startTime, windowStartTime);
  const endDate = calendarDateForOperatingTime(operatingDate, slot.endTime, windowStartTime);
  const start = matchingLocalInstants(startDate, slot.startTime, timezone);
  const end = matchingLocalInstants(endDate, slot.endTime, timezone);
  // An ambiguous end is allowed only at its first occurrence, such as a
  // Saturday 00:00-01:00 slot before Newfoundland's autumn clock change.
  return start.length === 1 && end.length > 0 && end[0] - start[0] === 3_600_000;
}
