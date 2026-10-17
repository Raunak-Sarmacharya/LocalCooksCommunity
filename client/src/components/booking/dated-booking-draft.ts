import { addHour, sortTimesInOperatingWindow } from '@shared/operating-hours';
import { validateKitchenSlotSelection } from '@shared/consecutive-booking-slots';

export type DayHours = { pricingMode: 'hourly' | 'daily'; times: string[] };
export type DatedSlot = { time: string; available: number; capacity: number; isFullyBooked: boolean };
export type DateStatus = { hourly: boolean; fullDay: boolean; reason: string | null; fullDayReason: string | null };
export type DayResources = { slots: DatedSlot[]; fullDay: boolean; equipmentIds: number[] };
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

export function buildDatedDays(dates: string[], template: DayHours, overrides: Record<string, DayHours>,
  equipmentIds: number[], excluded: Record<string, number[]>, resources: Record<string, DayResources>): DatedDay[] {
  return [...dates].sort().map(date => {
    const hours = overrides[date] ?? template;
    const available = resources[date];
    const times = hours.pricingMode === 'daily' ? available?.slots.map(slot => slot.time) ?? []
      : sortTimesInOperatingWindow(hours.times, available?.slots[0]?.time ?? hours.times[0]);
    return { date, pricingMode: hours.pricingMode, slots: times.map(startTime => ({ startTime, endTime: addHour(startTime) })),
      equipmentIds: equipmentIds.filter(id => available?.equipmentIds.includes(id) && !excluded[date]?.includes(id)) };
  });
}

export function datedDayError(day: DatedDay, resource: DayResources | undefined, minimum: number, maximum: number | null) {
  if (!resource) return 'loading';
  if (day.pricingMode === 'daily') return resource.fullDay && day.slots.length > 0 ? null : 'fullDay';
  return validateKitchenSlotSelection(day.slots.map(slot => slot.startTime), resource.slots, Math.max(1, minimum), maximum ?? Infinity);
}
