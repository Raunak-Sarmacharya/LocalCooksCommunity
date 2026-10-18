import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { formatTime } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Calendar as UICalendar } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { addHour } from '@shared/operating-hours';
import type { DatedChangeSchedule } from '@shared/kitchen-booking-change';
import { DatedCalendarContext, DatedCalendarDay } from './DatedCalendarDay';
import { BOOKING_CALENDAR_CLASS_NAMES, dateReasonKey } from './booking-calendar';
import { dateSelectionReason, localDateKey, type DateStatus } from './dated-booking-draft';

/** One day of the request: full day, or `hours` consecutive hours from `start`; equipment chosen for that day. */
type DayChoice = { pricingMode: 'hourly' | 'daily'; start: string; hours: number; equipmentIds: number[] };
type Slot = { time: string; available: number; isFullyBooked: boolean };
type Equipment = { id: number; equipmentType: string; brand?: string | null; archivedAt?: string | null };

async function get<T>(path: string): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!response.ok) throw new Error(String(response.status));
  return response.json() as Promise<T>;
}
const choiceOf = (day: DatedChangeSchedule['days'][number]): DayChoice =>
  ({ pricingMode: day.pricingMode, start: day.slots[0]?.startTime ?? '', hours: Math.max(1, day.slots.length), equipmentIds: day.equipmentIds });

/**
 * CP7: the chef's whole-booking change for a dated booking, with the CP8 day picker (same calendar, reasons and announcements).
 * Each chosen day is a full day or its own hours, with its own equipment. The server re-checks everything when it prices.
 */
export function DatedChangeEditor({ bookingId, kitchenId, original, disabled, onChange }: { bookingId: number; kitchenId: number;
  original: DatedChangeSchedule; disabled?: boolean; onChange: (destination: DatedChangeSchedule | null, unchanged: boolean) => void }) {
  const { t, i18n } = useTranslation('booking');
  const locale = i18n.resolvedLanguage || 'en-CA';
  const [choices, setChoices] = useState<Record<string, DayChoice>>(() => Object.fromEntries(original.days.map(day => [day.date, choiceOf(day)])));
  const dates = useMemo(() => Object.keys(choices).sort(), [choices]);
  const [month, setMonth] = useState(() => new Date(`${original.days[0]?.date ?? localDateKey(new Date())}T12:00:00`));
  const [statuses, setStatuses] = useState<Record<string, DateStatus>>({});
  const [slots, setSlots] = useState<Record<string, Slot[]>>({});
  const [equipment, setEquipment] = useState<Record<string, Equipment[]>>({});
  const [announcement, setAnnouncement] = useState('');

  // The booking's own days never block it (`changing`): the picker shows what the change could use.
  useEffect(() => {
    let live = true;
    void get<Record<string, DateStatus>>(`/api/chef/kitchens/${kitchenId}/date-status?year=${month.getFullYear()}&month=${month.getMonth()}&changing=${bookingId}`)
      .then(result => { if (live) setStatuses(current => ({ ...current, ...result })); }).catch(() => undefined);
    return () => { live = false; };
  }, [kitchenId, bookingId, month.getFullYear(), month.getMonth()]);
  useEffect(() => {
    for (const date of dates.filter(date => !slots[date])) {
      void Promise.all([get<Slot[]>(`/api/chef/kitchens/${kitchenId}/slots?date=${date}&changing=${bookingId}`).catch(() => []),
        get<{ included?: Equipment[]; rental?: Equipment[] }>(`/api/chef/kitchens/${kitchenId}/equipment-listings?date=${date}`).catch(() => ({}))])
        .then(([daySlots, items]) => {
          setSlots(current => ({ ...current, [date]: Array.isArray(daySlots) ? daySlots : [] }));
          setEquipment(current => ({ ...current, [date]: [...(items.included ?? []), ...(items.rental ?? [])].filter(item => !item.archivedAt) }));
        });
    }
  }, [dates.join(','), kitchenId, bookingId]);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const reason = (date: Date): string | null => {
    const key = localDateKey(date);
    if (choices[key]) return null;
    if (date < today) return t('mdReasonPast');
    const status = statuses[key];
    const limit = dateSelectionReason(key, dates, 14);
    if (status?.hourly || status?.fullDay) return limit ? t(limit === 'count' ? 'mdCountLimit' : 'mdSpanLimit', { count: 14 }) : null;
    return t(dateReasonKey(status?.reason));
  };
  const select = (picked: Date[] | undefined) => {
    const keys = (picked ?? []).map(localDateKey);
    // A new day starts like the first day of the booking; existing days keep their own choices.
    const template = choices[dates[0]] ?? choiceOf(original.days[0]);
    setChoices(Object.fromEntries(keys.map(key => [key, choices[key] ?? { ...template }])));
    setAnnouncement(t('mdSelectedDays', { count: keys.length }));
  };
  const update = (date: string, patch: Partial<DayChoice>) => setChoices(current => ({ ...current, [date]: { ...current[date], ...patch } }));

  const free = (date: string) => new Set((slots[date] ?? []).filter(slot => !slot.isFullyBooked && slot.available > 0).map(slot => slot.time));
  const run = (date: string, start: string) => { const open = free(date); let n = 0, at = start; while (at && open.has(at) && n < 24) { n++; at = addHour(at); } return n; };
  const destination = useMemo<DatedChangeSchedule | null>(() => {
    if (!dates.length) return null;
    const days = dates.map(date => {
      const choice = choices[date];
      const times = choice.pricingMode === 'daily' ? [] : Array.from({ length: choice.hours }).reduce<string[]>((list, _, i) => [...list, i ? addHour(list[i - 1]) : choice.start], []);
      return { date, pricingMode: choice.pricingMode, windowStart: times[0] ?? '00:00', slots: times.map(time => ({ startTime: time, endTime: addHour(time) })),
        equipmentIds: [...choice.equipmentIds].sort((a, b) => a - b) };
    });
    return days.some(day => day.pricingMode === 'hourly' && (!day.slots[0]?.startTime || run(day.date, day.slots[0].startTime) < day.slots.length)) ? null : { version: 'days-v1', days };
  }, [choices, slots]);
  const unchanged = !!destination && JSON.stringify(destination.days.map(day => [day.date, day.pricingMode, day.pricingMode === 'daily' ? [] : day.slots, day.equipmentIds]))
    === JSON.stringify(original.days.map(day => [day.date, day.pricingMode, day.pricingMode === 'daily' ? [] : day.slots, [...day.equipmentIds].sort((a, b) => a - b)]));
  useEffect(() => { onChange(destination, unchanged); }, [JSON.stringify(destination), unchanged]);
  const dayLabel = (date: string) => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00Z`));

  return <div className="space-y-4" data-testid="dated-change-editor">
    <DatedCalendarContext.Provider value={{ reason, announce: setAnnouncement, locale: i18n.language }}>
      <p className="text-sm text-muted-foreground">{t('chgDatedHelp')}</p>
      <UICalendar mode="multiple" selected={dates.map(date => new Date(`${date}T12:00:00`))} onSelect={select} month={month} onMonthChange={setMonth}
        disabled={date => disabled || !!reason(date)} components={{ Day: DatedCalendarDay }} className="w-full bg-transparent p-1"
        classNames={{ ...BOOKING_CALENDAR_CLASS_NAMES, day: `${BOOKING_CALENDAR_CLASS_NAMES.day} h-11 w-11 max-w-[44px]`, cell: 'relative h-11 p-0 text-center text-sm' }} />
      <p role="status" aria-live="polite" className="text-sm">{announcement || t('mdSelectedDays', { count: dates.length })}</p>
    </DatedCalendarContext.Provider>
    {dates.map(date => {
      const choice = choices[date], loaded = !!slots[date], open = free(date), longest = choice.start ? run(date, choice.start) : 0;
      return <fieldset key={date} className="space-y-2 rounded-xl border p-3" data-testid={`change-day-${date}`}>
        <legend className="px-1 text-sm font-medium">{dayLabel(date)}</legend>
        <div className="flex flex-wrap gap-2">
          {(['daily', 'hourly'] as const).map(mode => <Button key={mode} type="button" size="sm" className="min-h-11" disabled={disabled} aria-pressed={choice.pricingMode === mode}
            variant={choice.pricingMode === mode ? 'default' : 'outline'} onClick={() => update(date, { pricingMode: mode })}>{t(mode === 'daily' ? 'sheetDailyRate' : 'sheetHourlyRate')}</Button>)}
        </div>
        {choice.pricingMode === 'hourly' && (!loaded ? <Loader2 className="h-4 w-4 animate-spin" aria-label={t('chgLoading')} />
          : !open.size ? <p className="text-sm text-muted-foreground">{t('chgNoTimes')}</p>
          : <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-sm font-medium">{t('chgStart')}
              <Select value={choice.start} disabled={disabled} onValueChange={start => update(date, { start })}>
                <SelectTrigger className="mt-1 min-h-11"><SelectValue /></SelectTrigger>
                <SelectContent>{(slots[date] ?? []).map(slot => <SelectItem key={slot.time} value={slot.time} disabled={!open.has(slot.time)}>{formatTime(slot.time, locale)}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="text-sm font-medium">{t('chgHours')}
              <Select value={String(choice.hours)} disabled={disabled} onValueChange={value => update(date, { hours: Number(value) })}>
                <SelectTrigger className="mt-1 min-h-11"><SelectValue /></SelectTrigger>
                <SelectContent>{Array.from({ length: Math.max(longest, choice.hours, 1) }, (_, i) => i + 1).map(n =>
                  <SelectItem key={n} value={String(n)} disabled={n > longest}>{t('chgHoursOption', { count: n })}</SelectItem>)}</SelectContent>
              </Select>
            </label>
          </div>)}
        {!!equipment[date]?.length && <div className="space-y-1">
          <p className="text-sm font-medium">{t('chgDatedEquipment')}</p>
          {equipment[date].map(item => <label key={item.id} className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" disabled={disabled} checked={choice.equipmentIds.includes(item.id)}
              onChange={event => update(date, { equipmentIds: event.target.checked ? [...choice.equipmentIds, item.id] : choice.equipmentIds.filter(id => id !== item.id) })} />
            {item.equipmentType}{item.brand ? ` (${item.brand})` : ''}
          </label>)}
        </div>}
      </fieldset>;
    })}
  </div>;
}
