import { matchingLocalInstants } from './booking-dst';
import { DEFAULT_TIMEZONE } from './timezone-utils';

/** A visitor's wall clock always means Newfoundland, including on another device timezone. */
export function tourVisitTime(date: unknown, time: unknown, occurrence?: unknown) {
  if (typeof date !== 'string' || typeof time !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: 'visit_time_required' as const, instants: [] as number[] };
  const day = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date)
    return { error: 'visit_date_invalid' as const, instants: [] as number[] };
  const instants = matchingLocalInstants(date, time, DEFAULT_TIMEZONE);
  if (!instants.length) return { error: 'visit_time_gap' as const, instants };
  if (occurrence != null && occurrence !== '' && !['earlier', 'later'].includes(String(occurrence)))
    return { error: 'visit_time_invalid' as const, instants };
  if (instants.length > 1 && !['earlier', 'later'].includes(String(occurrence)))
    return { error: 'visit_time_ambiguous' as const, instants };
  return { error: null, instants, actual: new Date(occurrence === 'later' ? instants.at(-1)! : instants[0]) };
}

export function validateTourVisitInput(input: Record<string, unknown>, now = new Date()) {
  if (!['arrival', 'departure'].includes(String(input.action))) throw Error('visit_action_invalid');
  if (typeof input.reason !== 'string' || input.reason.trim().length < 10 || input.reason.length > 2000)
    throw Error('visit_reason_required');
  let actual: Date;
  if (input.actualDate !== undefined || input.actualTime !== undefined) {
    const wall = tourVisitTime(input.actualDate, input.actualTime, input.actualOccurrence);
    if (wall.error || !wall.actual) throw Error(wall.error || 'visit_time_invalid');
    actual = wall.actual;
    if (input.actualAt !== undefined && Date.parse(String(input.actualAt)) !== actual.getTime()) throw Error('visit_time_invalid');
  } else {
    // Older app versions can still submit an explicit instant. Never accept an implicit device timezone.
    if (typeof input.actualAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(input.actualAt)) throw Error('visit_time_required');
    actual = new Date(input.actualAt);
    const date = input.actualAt.slice(0, 10), day = new Date(`${date}T12:00:00Z`);
    if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date || !Number.isFinite(actual.getTime())) throw Error('visit_time_invalid');
  }
  if (actual > now) throw Error('visit_time_future');
  return { actual, reason: input.reason.trim() };
}
