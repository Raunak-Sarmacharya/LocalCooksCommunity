/**
 * Chef "running late" heads-up for a kitchen booking. Same spirit as shared/tour-late.ts:
 * it is coordination only. It never records attendance, moves the booking, or changes its end time.
 */
export const RUNNING_LATE_CHOICES = [15, 30, 60] as const;
export type RunningLateMinutes = typeof RUNNING_LATE_CHOICES[number];
/** The chef can update the kitchen this many times per booking. */
export const RUNNING_LATE_MAX_PER_BOOKING = 3;
/** The action opens this long before the booked start and closes at the booked end. */
export const RUNNING_LATE_OPENS_MINUTES_BEFORE = 30;
export const RUNNING_LATE_NOTE_MAX = 200;

export type RunningLateState = {
  minutes: RunningLateMinutes;
  reportedAt: string;
  /** reportedAt plus the chosen delay: when the chef said they would arrive. */
  expectedAt: string;
  note: string | null;
  visitId: number | null;
  /** How many heads-ups the chef has sent for this booking (limit: RUNNING_LATE_MAX_PER_BOOKING). */
  count: number;
};

export const isRunningLateMinutes = (value: unknown): value is RunningLateMinutes =>
  typeof value === 'number' && (RUNNING_LATE_CHOICES as readonly number[]).includes(value);

/** Trimmed, single-spaced, length-capped note; empty becomes null. */
export function cleanRunningLateNote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const note = value.replace(/\s+/g, ' ').trim().slice(0, RUNNING_LATE_NOTE_MAX).trim();
  return note || null;
}

export function runningLateExpectedAt(reportedAt: Date | string, minutes: number) {
  return new Date(new Date(reportedAt).getTime() + minutes * 60_000);
}

/** From 30 minutes before the booked start until the booked end, only while the chef has not checked in. */
export function canReportRunningLate(input: { status: string; checkedIn: boolean; start: Date | string; end: Date | string }, now = Date.now()) {
  const start = new Date(input.start).getTime(), end = new Date(input.end).getTime();
  return input.status === 'confirmed' && !input.checkedIn && Number.isFinite(start) && Number.isFinite(end)
    && now >= start - RUNNING_LATE_OPENS_MINUTES_BEFORE * 60_000 && now < end;
}
