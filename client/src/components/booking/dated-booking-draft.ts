import { addHour, sortTimesInOperatingWindow } from '@shared/operating-hours';
import { validateKitchenSlotSelection } from '@shared/consecutive-booking-slots';
import { dateReasonKey } from './booking-calendar';

export type DayHours = { pricingMode: 'hourly' | 'daily'; times: string[] };
export type DatedSlot = { time: string; available: number; capacity: number; isFullyBooked: boolean };
export type DateStatus = { hourly: boolean; fullDay: boolean; reason: string | null; fullDayReason: string | null };
export type DayResources = { slots: DatedSlot[]; fullDay: boolean; equipmentIds: number[]; windowStartTime?: string };
export type DatedDay = { date: string; pricingMode: 'hourly' | 'daily'; slots: { startTime: string; endTime: string }[]; equipmentIds: number[] };

export function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Calendar dates, rather than elapsed hours: the span is unchanged across DST. */
export function dateSelectionReason(date: string, selected: string[], limit: number): 'count' | 'span' | null {
  if (selected.includes(date)) return null;
  if (selected.length >= limit) return 'count';
  const dates = [...selected, date].sort();
  return (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86_400_000 > 14 ? 'span' : null;
}

/** Booking-namespace key for why `date` can't join `selected` (null = pickable). Shared by the booking Date step and the kitchen page card. */
export function dateBlockReasonKey(date: string, selected: string[], status: DateStatus | undefined, maxDays: number, today: string, bookableThrough?: string | null) {
  if (selected.includes(date)) return null;
  if (date < today) return 'mdReasonPast';
  if (bookableThrough && date > bookableThrough) return 'mdReasonAdvance';
  if (!status?.hourly && !status?.fullDay) return dateReasonKey(status?.reason);
  const limit = dateSelectionReason(date, selected, maxDays);
  return limit === 'count' ? 'mdCountLimit' : limit === 'span' ? 'mdSpanLimit' : null;
}

/** Bookable, but not every hour is free (the orange dot). */
export const partlyFree = (status?: DateStatus) => !!status?.hourly && !status.fullDay;

export function buildDatedDays(dates: string[], template: DayHours, overrides: Record<string, DayHours>,
  equipmentIds: number[], excluded: Record<string, number[]>, resources: Record<string, DayResources>): DatedDay[] {
  return [...dates].sort().map(date => {
    const hours = overrides[date] ?? template;
    const available = resources[date];
    const times = hours.pricingMode === 'daily' ? available?.slots.map(slot => slot.time) ?? []
      : sortTimesInOperatingWindow(hours.times, available?.windowStartTime ?? available?.slots[0]?.time ?? hours.times[0]);
    return { date, pricingMode: hours.pricingMode, slots: times.map(startTime => ({ startTime, endTime: addHour(startTime) })),
      equipmentIds: equipmentIds.filter(id => available?.equipmentIds.includes(id) && !excluded[date]?.includes(id)) };
  });
}

export function datedDayError(day: DatedDay, resource: DayResources | undefined, minimum: number, maximum: number | null) {
  if (!resource) return 'loading';
  if (day.pricingMode === 'daily') return resource.fullDay && day.slots.length > 0 ? null : 'fullDay';
  return validateKitchenSlotSelection(day.slots.map(slot => slot.startTime), resource.slots, Math.max(1, minimum), maximum ?? Infinity);
}

export type DatedDraft = { version: 1; dates: string[]; template: DayHours; hours: Record<string, DayHours>;
  equipmentIds: number[]; excluded: Record<string, number[]>; notes: string };

export function readDatedDraft(kitchenId: number): DatedDraft | null {
  try {
    const draft = JSON.parse(sessionStorage.getItem(`kitchen_booking_days_${kitchenId}`) ?? 'null') as DatedDraft | null;
    const validHours = (hours: DayHours) => hours && ['hourly', 'daily'].includes(hours.pricingMode) && Array.isArray(hours.times)
      && hours.times.every(time => /^([01]\d|2[0-3]):00$/.test(time));
    if (!draft || draft.version !== 1 || !Array.isArray(draft.dates) || draft.dates.length < 2 || draft.dates.length > 14
      || new Set(draft.dates).size !== draft.dates.length || draft.dates.some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date)
      || !validHours(draft.template) || !draft.hours || !Object.values(draft.hours).every(validHours)
      || !Array.isArray(draft.equipmentIds) || !draft.equipmentIds.every(Number.isSafeInteger)
      || !draft.excluded || !Object.values(draft.excluded).every(ids => Array.isArray(ids) && ids.every(Number.isSafeInteger)) || typeof draft.notes !== 'string') return null;
    return draft;
  } catch { return null; }
}
