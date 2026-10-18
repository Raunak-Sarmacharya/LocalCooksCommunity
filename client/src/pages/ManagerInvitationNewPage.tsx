import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearch } from 'wouter';
import { ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react';
import ManagerBookingLayout from '@/layouts/ManagerBookingLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { DateField } from '@/components/ui/date-field';
import { TimeSelect } from '@/components/ui/time-select';
import { Checkbox } from '@/components/ui/checkbox';
import { Calendar as UICalendar } from '@/components/ui/calendar';
import { DatedCalendarContext, DatedCalendarDay } from '@/components/booking/DatedCalendarDay';
import { BOOKING_CALENDAR_TWO_MONTH_CLASS_NAMES, dateReasonKey } from '@/components/booking/booking-calendar';
import { dateSelectionReason, localDateKey, type DateStatus } from '@/components/booking/dated-booking-draft';
import { formatTime } from '@/lib/formatters';
import { friendlyTimezoneName } from '@shared/timezone-utils';
import { getAuthHeaders } from '@/lib/api';
import { addHours, invitationOpen, invitationRequest, type Invitation, type InvitationDayDraft, type InvitationDraft, type InvitationPreview } from '@/lib/invitations';

const EMPTY = '__empty__';

type Kitchen = { id: number; name: string };
type Slot = { time: string; available: number; isFullyBooked: boolean };
type EquipmentOption = { id: number; name: string; cents: number; included: boolean };
type DayEdit = { pricingMode: 'hourly' | 'daily'; start: string; hours: number };
type KitchenRules = { allowMultiDayBookings: boolean; multidayCreationEnabled: boolean; maxBookingDays: number;
  minimumBookingWindowHours: number; timezone: string };
const EXPIRY = [24, 48, 168] as const;
const MAX_SPAN = 14;

/**
 * "Invite to book": the kitchen offers one or several days (optionally at a lower kitchen price) to one approved chef.
 * Nothing is reserved by sending; the chef reviews the full price and pays to confirm (Airbnb special offer / Peerspace
 * invite-to-book). A multi-day offer uses the same day picker, per-day hours and per-day equipment as a chef's own
 * multi-day booking, but the price is always a discount off the listed total with a $1 floor.
 */
export default function ManagerInvitationNewPage() {
  const { t, i18n } = useTranslation('booking');
  const search = new URLSearchParams(useSearch());
  const locationId = Number(search.get('location')) || 0;
  const queryClient = useQueryClient();
  const locale = i18n.resolvedLanguage || 'en-CA';
  const money = (cents: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD' }).format(cents / 100);
  const dayLabel = (date: string) => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
    .format(new Date(`${date}T12:00:00Z`));

  const [chefId, setChefId] = useState(Number(search.get('chefId')) || 0);
  const [kitchenId, setKitchenId] = useState(0);
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [dateStatuses, setDateStatuses] = useState<Record<string, DateStatus>>({});
  const [dateAnnouncement, setDateAnnouncement] = useState('');
  const [shared, setShared] = useState<DayEdit>({ pricingMode: 'hourly', start: '10:00', hours: 2 });
  const [dayEdits, setDayEdits] = useState<Record<string, DayEdit>>({});
  const [daySlots, setDaySlots] = useState<Record<string, Slot[]>>({});
  const [dayEquipmentOptions, setDayEquipmentOptions] = useState<Record<string, EquipmentOption[]>>({});
  const [dayEquipment, setDayEquipment] = useState<Record<string, number[]>>({});
  const [discountType, setDiscountType] = useState<'none' | 'amount' | 'percent'>('none'), [discountValue, setDiscountValue] = useState('');
  const [expires, setExpires] = useState<24 | 48 | 168>(48), [note, setNote] = useState('');
  const [preview, setPreview] = useState<InvitationPreview | null>(null), [previewError, setPreviewError] = useState('');
  const [sending, setSending] = useState(false), [sendError, setSendError] = useState(''), [sent, setSent] = useState<Invitation | null>(null);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());

  const chefs = useQuery({ queryKey: ['invitation-chefs', locationId], enabled: locationId > 0,
    queryFn: () => invitationRequest<{ chefs: Array<{ id: number; name: string }> }>(`/api/manager/invitations/eligible-chefs?locationId=${locationId}`) });
  const kitchens = useQuery({ queryKey: ['invitation-kitchens', locationId], enabled: locationId > 0, queryFn: async () => {
    const response = await fetch(`/api/manager/kitchens/${locationId}`, { headers: await getAuthHeaders(), credentials: 'include' });
    if (!response.ok) throw new Error(t('invLoadFailed'));
    return (await response.json()) as Kitchen[];
  } });
  useEffect(() => { if (!kitchenId && kitchens.data?.length) setKitchenId(kitchens.data[0].id); }, [kitchens.data, kitchenId]);
  const rules = useQuery({ queryKey: ['invitation-kitchen-rules', kitchenId], enabled: kitchenId > 0,
    queryFn: () => invitationRequest<KitchenRules>(`/api/manager/invitations/kitchen-rules?kitchenId=${kitchenId}`) });
  const multiAllowed = rules.data?.allowMultiDayBookings === true && rules.data?.multidayCreationEnabled === true;
  const maxDays = Math.min(rules.data?.maxBookingDays ?? 7, MAX_SPAN);

  // Each visible month's per-day status, so a closed, booked, notice-blocked or out-of-horizon day says why.
  useEffect(() => {
    if (!kitchenId || !multiAllowed) return;
    let stale = false;
    const months = [calendarMonth, new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1)];
    void Promise.all(months.map(month => invitationRequest<Record<string, DateStatus>>(
      `/api/public/kitchens/${kitchenId}/date-status?year=${month.getFullYear()}&month=${month.getMonth()}`)))
      .then(results => { if (!stale) setDateStatuses(current => ({ ...current, ...Object.assign({}, ...results) })); })
      .catch(() => undefined);
    return () => { stale = true; };
  }, [kitchenId, multiAllowed, calendarMonth.getFullYear(), calendarMonth.getMonth()]);

  // Each selected day keeps its own opening hours, free hours and equipment inventory. A legacy one-date
  // invitation only needs the hours; the day picker's per-day equipment is a multi-day concern.
  useEffect(() => {
    if (!kitchenId) return;
    let stale = false;
    const missing = selectedDates.filter(date => !daySlots[date]);
    if (!missing.length) return;
    void Promise.all(missing.map(async date => {
      const slots = await invitationRequest<Slot[]>(`/api/public/kitchens/${kitchenId}/slots?date=${date}`);
      if (!multiAllowed) return [date, { slots, equipment: null }] as const;
      const equipment = await invitationRequest<{ included: Array<{ id: number; equipmentType: string; brand?: string | null; sessionRate?: number }>;
        rental: Array<{ id: number; equipmentType: string; brand?: string | null; sessionRate?: number }> }>(
        `/api/public/kitchens/${kitchenId}/equipment-listings?date=${date}`);
      return [date, { slots, equipment }] as const;
    })).then(entries => {
      if (stale) return;
      setDaySlots(current => ({ ...current, ...Object.fromEntries(entries.map(([date, value]) => [date, value.slots])) }));
      const withEquipment = entries.filter(entry => entry[1].equipment);
      if (!withEquipment.length) return;
      setDayEquipmentOptions(current => ({ ...current, ...Object.fromEntries(withEquipment.map(([date, value]) => [date,
        [...value.equipment!.included.map(item => ({ id: item.id, included: true, cents: 0, name: [item.brand, item.equipmentType].filter(Boolean).join(' ') })),
          ...value.equipment!.rental.map(item => ({ id: item.id, included: false, cents: Math.round(Number(item.sessionRate ?? 0)),
            name: [item.brand, item.equipmentType].filter(Boolean).join(' ') }))]])) }));
      setDayEquipment(current => {
        const next = { ...current };
        for (const [date, value] of withEquipment) if (!next[date]) next[date] = value.equipment!.included.map(item => item.id);
        return next;
      });
    }).catch(() => { if (!stale) setPreviewError(t('mdLoadDays')); });
    return () => { stale = true; };
  }, [kitchenId, multiAllowed, selectedDates.join(','), daySlots]);

  // A newly selected day starts from the shared default; an edited day keeps its own hours.
  useEffect(() => {
    setDayEdits(current => {
      const next = { ...current };
      for (const date of selectedDates) if (!next[date]) next[date] = { ...shared };
      for (const date of Object.keys(next)) if (!selectedDates.includes(date)) delete next[date];
      return next;
    });
  }, [selectedDates.join(','), shared.pricingMode, shared.start, shared.hours]);

  // Once the day's hours load, a start the kitchen is not open for moves to its first free hour.
  useEffect(() => {
    setDayEdits(current => {
      let changed = false;
      const next = { ...current };
      for (const date of selectedDates) {
        const slots = daySlots[date];
        if (!slots?.length) continue;
        const edit = next[date] ?? shared;
        if (edit.pricingMode !== 'hourly' || slots.some(slot => slot.time === edit.start)) continue;
        next[date] = { ...edit, start: (slots.find(slot => !slot.isFullyBooked && slot.available > 0) ?? slots[0]).time };
        changed = true;
      }
      return changed ? next : current;
    });
  }, [daySlots, selectedDates.join(',')]);

  useEffect(() => { if (!multiAllowed) { setSelectedDates([]); setDaySlots({}); setDayEquipment({}); setDayEquipmentOptions({}); } },
    [multiAllowed, kitchenId]);

  const today = useMemo(() => { const value = new Date(); value.setHours(0, 0, 0, 0); return value; }, []);
  const blockedDateReason = (date: Date) => {
    const key = localDateKey(date);
    if (selectedDates.includes(key)) return null;
    if (date < today) return t('mdReasonPast');
    const limit = dateSelectionReason(key, selectedDates, maxDays);
    const status = dateStatuses[key];
    if (status?.hourly || status?.fullDay) return limit ? t(limit === 'count' ? 'mdCountLimit' : 'mdSpanLimit', { count: maxDays }) : null;
    return t(dateReasonKey(status?.reason));
  };
  const selectDates = (dates: Date[] | undefined) => {
    const keys = Array.from(new Set((dates ?? []).map(localDateKey))).sort();
    setSelectedDates(keys);
    setDateAnnouncement(t('mdSelectedDays', { count: keys.length }));
  };

  const slotsFor = (date: string) => daySlots[date] ?? [];
  const freeFrom = (date: string, start: string) => {
    const times = slotsFor(date).map(slot => slot.time);
    const at = times.indexOf(start);
    if (at < 0) return 0;
    const run = times.slice(at).findIndex(time => !slotsFor(date).find(slot => slot.time === time && !slot.isFullyBooked && slot.available > 0));
    return run === -1 ? times.length - at : run;
  };
  const editFor = (date: string) => dayEdits[date] ?? shared;
  const daySlotsFor = (date: string): Array<{ startTime: string; endTime: string }> => {
    const edit = editFor(date);
    if (edit.pricingMode === 'daily') return slotsFor(date).map(slot => ({ startTime: slot.time, endTime: addHours(slot.time, 1) }));
    const start = slotsFor(date).some(slot => slot.time === edit.start) ? edit.start : (slotsFor(date)[0]?.time ?? '');
    if (!start) return [];
    return Array.from({ length: edit.hours }, (_, index) => {
      const startTime = addHours(start, index);
      return { startTime, endTime: addHours(startTime, 1) };
    });
  };

  const days: InvitationDayDraft[] = useMemo(() => [...selectedDates].sort().map(date => ({
    date, pricingMode: editFor(date).pricingMode, slots: daySlotsFor(date),
    equipmentIds: dayEquipment[date] ?? [],
  })), [selectedDates.join(','), dayEdits, daySlots, dayEquipment]);

  const amount = Number(discountValue);
  const discount = discountType === 'none' || !(amount > 0) ? undefined
    : { type: discountType, value: discountType === 'amount' ? Math.round(amount * 100) : amount } as const;
  const common = { chefId, kitchenId, expiresInHours: expires, ...(discount ? { discount } : {}), ...(note.trim() ? { note: note.trim() } : {}) };
  const legacyDate = selectedDates[0] ?? '';
  const legacyStart = editFor(legacyDate).start;
  const draft: InvitationDraft | null = useMemo(() => {
    if (!chefId || !kitchenId || !selectedDates.length) return null;
    if (multiAllowed) {
      if (days.some(day => day.slots.length === 0)) return null;
      return { ...common, days } as InvitationDraft;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(legacyDate) || !slotsFor(legacyDate).some(slot => slot.time === legacyStart)) return null;
    return { ...common, date: legacyDate, startTime: legacyStart, endTime: addHours(legacyStart, editFor(legacyDate).hours) };
  }, [chefId, kitchenId, selectedDates.join(','), multiAllowed, days, legacyDate, legacyStart, dayEdits, daySlots,
    expires, discount?.type, discount?.value, note]);

  // Live preview: the exact price the chef will see, availability, and the kitchen's estimated payout.
  useEffect(() => {
    if (!draft) { setPreview(null); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      setPreviewError('');
      invitationRequest<InvitationPreview>('/api/manager/invitations/preview', draft)
        .then(result => { if (!cancelled) setPreview(result); })
        .catch(error => { if (!cancelled) { setPreview(null); setPreviewError(error.message); } });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [draft]);

  const chefName = chefs.data?.chefs.find(chef => chef.id === chefId)?.name || '';
  const kitchenName = kitchens.data?.find(kitchen => kitchen.id === kitchenId)?.name || '';
  const send = async () => {
    if (!draft || !preview?.available || !preview.pricing || sending) return;
    setSending(true); setSendError('');
    try {
      const invitation = await invitationRequest<Invitation>('/api/manager/invitations', { ...draft, requestKey });
      setSent(invitation); setRequestKey(crypto.randomUUID());
      void queryClient.invalidateQueries({ queryKey: ['invitations-sent'] });
    } catch (error) { setSendError(error instanceof Error ? error.message : t('invSendFailed')); }
    finally { setSending(false); }
  };
  const withdraw = async (invitation: Invitation) => {
    try { await invitationRequest(`/api/manager/invitations/${invitation.id}/withdraw`, { version: invitation.version }); }
    catch (error) { setSendError(error instanceof Error ? error.message : t('invSendFailed')); }
    void queryClient.invalidateQueries({ queryKey: ['invitations-sent'] });
  };
  const sentList = useQuery({ queryKey: ['invitations-sent', locationId, chefId], enabled: locationId > 0 && chefId > 0,
    queryFn: () => invitationRequest<{ invitations: Invitation[] }>(`/api/manager/invitations?locationId=${locationId}&chefId=${chefId}`) });

  const when = (invitation: Pick<Invitation, 'dayCount' | 'date' | 'startTime' | 'endTime' | 'timezone'>) =>
    invitation.dayCount > 1 ? t('invDaysFirst', { count: invitation.dayCount, date: dayLabel(invitation.date) })
      : t('invWhen', { day: dayLabel(invitation.date), start: formatTime(invitation.startTime, locale),
        end: formatTime(invitation.endTime, locale), zone: friendlyTimezoneName(invitation.timezone, locale) });
  const expiresText = (iso: string, timezone?: string) => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    ...(timezone ? { timeZone: timezone } : {}) }).format(new Date(iso));
  const backHref = chefId && locationId ? `/manager/customers/${chefId}?location=${locationId}` : '/manager/dashboard?view=bookings';

  const field = 'block space-y-1.5 text-sm font-medium';
  const box = 'mt-1 block min-h-11 w-full rounded-md border bg-background px-3 text-sm';
  const pricing = preview?.pricing ?? null;
  const dateSetError = multiAllowed && selectedDates.length > maxDays ? t('mdCountLimit', { count: maxDays })
    : multiAllowed && selectedDates.length > 1 && dateSelectionReason(selectedDates[selectedDates.length - 1], selectedDates.slice(0, -1), MAX_SPAN)
      ? t('mdSpanLimit') : null;

  const dayEditor = (date: string) => {
    const edit = editFor(date);
    const slots = slotsFor(date);
    const start = slots.some(slot => slot.time === edit.start) ? edit.start : (slots[0]?.time ?? '');
    const free = Math.max(1, freeFrom(date, start));
    const options = dayEquipmentOptions[date] ?? [];
    const chosen = dayEquipment[date] ?? [];
    return <div key={date} className="space-y-3 rounded-xl border bg-background p-3" data-testid={`invitation-day-${date}`}>
      <p className="text-sm font-medium">{dayLabel(date)}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={field}>{t('invDayMode', { day: dayLabel(date) })}
          <Select value={edit.pricingMode} onValueChange={value => setDayEdits(current => ({ ...current,
            [date]: { ...editFor(date), pricingMode: value as 'hourly' | 'daily' } }))}>
            <SelectTrigger className={box}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="hourly">{t('invHoursMode')}</SelectItem>
              <SelectItem value="daily" disabled={!slots.length}>{t('invFullDay')}</SelectItem>
            </SelectContent>
          </Select></label>
        {edit.pricingMode === 'hourly' && <>
          <label className={field}>{t('invStart')}
            <TimeSelect value={start} onChange={value => { if (value) setDayEdits(current => ({ ...current, [date]: { ...editFor(date), start: value } })); }}
              min={slots[0]?.time} aria-label={t('invStartFor', { day: dayLabel(date) })} className="mt-1" /></label>
          <label className={field}>{t('invLength')}
            <Select value={String(Math.min(edit.hours, free))} onValueChange={value => { if (!value) return; setDayEdits(current => ({ ...current,
              [date]: { ...editFor(date), hours: Number(value) } })); }}>
              <SelectTrigger className={box}><SelectValue /></SelectTrigger>
              <SelectContent>{Array.from({ length: free }, (_, i) => i + 1).map(n =>
                <SelectItem key={n} value={String(n)}>{t('chgHoursOption', { count: n })}</SelectItem>)}</SelectContent>
            </Select></label>
        </>}
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('invPerDayEquipment')}</legend>
        {options.length ? options.map(item => <label key={item.id} className="flex min-h-11 items-center gap-3 text-sm">
          <Checkbox checked={chosen.includes(item.id)} onCheckedChange={on => setDayEquipment(current => ({ ...current,
            [date]: on ? [...chosen, item.id] : chosen.filter(id => id !== item.id) }))} />
          {item.included ? t('invEquipmentIncluded', { name: item.name }) : t('invEquipmentLine', { name: item.name, price: money(item.cents) })}
        </label>) : <p className="text-sm text-muted-foreground">{t('invNoEquipmentDay')}</p>}
      </fieldset>
    </div>;
  };

  return <ManagerBookingLayout bookingLocationId={locationId || undefined} breadcrumbs={[
    { label: t('invCustomers'), href: '/manager/dashboard?view=customers' }, ...(chefName ? [{ label: chefName, href: backHref }] : []), { label: t('invTitle') }]}>
    <div className="mx-auto max-w-5xl space-y-6">
      <Link className="inline-flex items-center gap-2 text-sm font-medium hover:underline" href={backHref}><ArrowLeft className="h-4 w-4" />{t('invBack')}</Link>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('invTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('invIntro')}</p>
      </div>
      {!locationId ? <p role="alert">{t('invNoLocation')}</p> : sent ? (
        <section className="space-y-4 rounded-2xl border bg-card p-6" data-testid="invitation-sent">
          <p className="flex items-center gap-2 text-lg font-semibold"><CheckCircle2 className="h-5 w-5 text-emerald-600" />{t('invSentTitle', { chef: chefName || t('invTheChef') })}</p>
          <p className="text-sm">{t('invSentBody', { kitchen: sent.kitchen.name, when: when(sent), total: money(sent.pricing.totalCents), expires: expiresText(sent.expiresAt, sent.timezone) })}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link href={backHref}>{t('invBackTo', { chef: chefName || t('invTheChef') })}</Link></Button>
            <Button onClick={() => { setSent(null); setPreview(null); }}>{t('invSendAnother')}</Button>
          </div>
        </section>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <form className="space-y-6" onSubmit={event => { event.preventDefault(); void send(); }}>
            <section className="space-y-4 rounded-2xl border bg-card p-5">
              <h2 className="font-semibold">{t('invWhoWhere')}</h2>
              <label className={field}>{t('invChef')}
                <Select value={chefId ? String(chefId) : EMPTY} required onValueChange={value => setChefId(value === EMPTY ? 0 : Number(value))}>
                  <SelectTrigger className={box}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={EMPTY} disabled>{chefs.isPending ? t('invLoading') : t('invChooseChef')}</SelectItem>
                    {chefs.data?.chefs.map(chef => <SelectItem key={chef.id} value={String(chef.id)}>{chef.name}</SelectItem>)}
                  </SelectContent>
                </Select></label>
              {chefs.data && !chefs.data.chefs.length && <p className="text-sm text-muted-foreground">{t('invNoChefs')}</p>}
              <label className={field}>{t('invKitchen')}
                <Select value={kitchenId ? String(kitchenId) : EMPTY} required onValueChange={value => { if (value !== EMPTY) setKitchenId(Number(value)); }}>
                  <SelectTrigger className={box}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {!kitchenId && <SelectItem value={EMPTY} disabled>{t('invLoading')}</SelectItem>}
                    {kitchens.data?.map(kitchen => <SelectItem key={kitchen.id} value={String(kitchen.id)}>{kitchen.name}</SelectItem>)}
                  </SelectContent>
                </Select></label>
            </section>
            <section className="space-y-4 rounded-2xl border bg-card p-5">
              <h2 className="font-semibold">{multiAllowed ? t('invDaysSection') : t('invWhen_title')}</h2>
              {multiAllowed ? <>
                <p className="text-sm text-muted-foreground">{t('mdSelectHelp', { count: maxDays })}</p>
                <DatedCalendarContext.Provider value={{ reason: blockedDateReason, announce: setDateAnnouncement, locale }}>
                  <UICalendar mode="multiple" numberOfMonths={2} pagedNavigation
                    selected={selectedDates.map(date => new Date(`${date}T12:00:00`))} onSelect={selectDates}
                    month={calendarMonth} onMonthChange={setCalendarMonth} disabled={date => !!blockedDateReason(date)}
                    components={{ Day: DatedCalendarDay }} className="w-full bg-transparent p-1"
                    classNames={{ ...BOOKING_CALENDAR_TWO_MONTH_CLASS_NAMES, day: 'mx-auto flex h-11 w-11 max-w-[44px] items-center justify-center rounded-full',
                      cell: 'relative h-11 p-0 text-center text-sm' }} />
                </DatedCalendarContext.Provider>
                <p role="status" aria-live="polite" className="text-sm">{dateAnnouncement || t('mdSelectedDays', { count: selectedDates.length })}</p>
                {dateSetError && <p role="alert" className="text-sm text-destructive">{dateSetError}</p>}
                {!!selectedDates.length && <div className="space-y-3">
                  <div className="grid gap-3 rounded-xl bg-muted/40 p-3 sm:grid-cols-3">
                    <label className={field}>{t('mdSameHours')}
                      <Select value={shared.pricingMode} onValueChange={value => setShared(current => ({ ...current, pricingMode: value as 'hourly' | 'daily' }))}>
                        <SelectTrigger className={box}><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="hourly">{t('invHoursMode')}</SelectItem><SelectItem value="daily">{t('invFullDay')}</SelectItem></SelectContent>
                      </Select></label>
                    {shared.pricingMode === 'hourly' && <>
                      <label className={field}>{t('invStart')}
                        <TimeSelect value={shared.start} onChange={value => { if (value) setShared(current => ({ ...current, start: value })); }} aria-label={t('invStart')} className="mt-1" /></label>
                      <label className={field}>{t('invLength')}
                        <Select value={String(shared.hours)} onValueChange={value => setShared(current => ({ ...current, hours: Number(value) }))}>
                          <SelectTrigger className={box}><SelectValue /></SelectTrigger>
                          <SelectContent>{Array.from({ length: 12 }, (_, i) => i + 1).map(n =>
                            <SelectItem key={n} value={String(n)}>{t('chgHoursOption', { count: n })}</SelectItem>)}</SelectContent>
                        </Select></label>
                    </>}
                  </div>
                  {[...selectedDates].sort().map(dayEditor)}
                </div>}
              </> : <div className="grid gap-4 sm:grid-cols-3">
                <div className={field}>{t('invDate')}
                  <DateField value={legacyDate} onChange={value => setSelectedDates(value ? [value] : [])}
                    placeholder={t('invChooseDateFirst')} aria-label={t('invDate')} className="mt-1 min-h-11" /></div>
                <label className={field}>{t('invStart')}
                  <Select value={legacyStart || EMPTY} disabled={!slotsFor(legacyDate).length}
                    onValueChange={value => { if (value) setDayEdits(current => ({ ...current, [legacyDate]: { ...editFor(legacyDate), start: value } })); }}>
                    <SelectTrigger className={box}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {!slotsFor(legacyDate).length && <SelectItem value={legacyStart || EMPTY}>{t(legacyDate && rules.isSuccess ? 'invClosedDay' : 'invChooseDateFirst')}</SelectItem>}
                      {slotsFor(legacyDate).map(slot => <SelectItem key={slot.time} value={slot.time} disabled={slot.isFullyBooked || slot.available <= 0}>
                        {slot.isFullyBooked || slot.available <= 0 ? t('invSlotTaken', { time: formatTime(slot.time, locale) }) : formatTime(slot.time, locale)}</SelectItem>)}
                    </SelectContent>
                  </Select></label>
                <label className={field}>{t('invLength')}
                  <Select value={String(editFor(legacyDate).hours)} onValueChange={value => { if (!value) return; setDayEdits(current => ({ ...current,
                    [legacyDate]: { ...editFor(legacyDate), hours: Number(value) } })); }}>
                    <SelectTrigger className={box}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: Math.max(1, Math.min(12, freeFrom(legacyDate, legacyStart) || 12)) }, (_, i) => i + 1).map(n =>
                        <SelectItem key={n} value={String(n)}>{t('chgHoursOption', { count: n })}</SelectItem>)}
                    </SelectContent>
                  </Select></label>
              </div>}
            </section>
            <section className="space-y-4 rounded-2xl border bg-card p-5">
              <h2 className="font-semibold">{t('invPrice')}</h2>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('invPrice')}>
                {(['none', 'amount', 'percent'] as const).map(kind => <Button key={kind} type="button" role="radio" aria-checked={discountType === kind}
                  variant={discountType === kind ? 'default' : 'outline'} className="min-h-11" onClick={() => setDiscountType(kind)}>{t(`invDiscount_${kind}`)}</Button>)}
              </div>
              {discountType !== 'none' && <label className={field}>{t(discountType === 'amount' ? 'invDiscountAmount' : 'invDiscountPercent')}
                <Input inputMode="decimal" className="mt-1 min-h-11 max-w-[10rem]" value={discountValue} onChange={event => setDiscountValue(event.target.value.replace(/[^\d.]/g, ''))} /></label>}
              <p className="text-xs text-muted-foreground">{t('invDiscountHelp')}</p>
              <p className="text-xs text-muted-foreground">{t('invDiscountEquipmentHelp')}</p>
              <p className="text-xs text-muted-foreground">{t('invOfferHelp')}</p>
              <label className={field}>{t('invNote')}
                <Textarea className="mt-1" maxLength={500} value={note} placeholder={t('invNotePlaceholder')} onChange={event => setNote(event.target.value)} /></label>
              <div className="space-y-1.5"><p className="text-sm font-medium">{t('invExpires')}</p>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('invExpires')}>
                  {EXPIRY.map(value => <Button key={value} type="button" role="radio" aria-checked={expires === value} variant={expires === value ? 'default' : 'outline'}
                    className="min-h-11" onClick={() => setExpires(value)}>{t(`invExpires_${value}`)}</Button>)}
                </div></div>
            </section>
          </form>
          <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            <section className="space-y-3 rounded-2xl border bg-card p-5" data-testid="invitation-preview" aria-live="polite">
              <h2 className="font-semibold">{t('invSummary')}</h2>
              {!draft ? <p className="text-sm text-muted-foreground">{t('invSummaryEmpty')}</p>
                : previewError ? <p role="alert" className="text-sm text-destructive">{previewError}</p>
                : !preview ? <Loader2 className="h-5 w-5 animate-spin" aria-label={t('invLoading')} />
                : <>
                  <p className="text-sm">{kitchenName} · {multiAllowed
                    ? t('mdSelectedDays', { count: selectedDates.length })
                    : `${dayLabel(legacyDate)}, ${formatTime(legacyStart, locale)}–${formatTime(addHours(legacyStart, editFor(legacyDate).hours), locale)}`}</p>
                  {multiAllowed && <ul className="space-y-0.5 text-sm text-muted-foreground">{days.map(day => <li key={day.date}>
                    {dayLabel(day.date)} · {day.pricingMode === 'daily' ? t('invFullDay')
                      : `${formatTime(day.slots[0]?.startTime ?? '', locale)}–${formatTime(day.slots.at(-1)?.endTime ?? '', locale)}`}</li>)}</ul>}
                  {pricing ? <dl className="space-y-1.5 text-sm">
                    <div className="flex justify-between gap-3"><dt>{t('invKitchenTime')}</dt><dd className="tabular-nums">
                      {pricing.offeredSubtotalCents < pricing.listSubtotalCents && <s className="mr-2 text-muted-foreground">{money(pricing.listSubtotalCents)}</s>}
                      {money(pricing.offeredSubtotalCents)}</dd></div>
                    <div className="flex justify-between gap-3"><dt>{t('invTax')}</dt><dd className="tabular-nums">{money(pricing.taxCents)}</dd></div>
                    {pricing.serviceFeeCents > 0 && <div className="flex justify-between gap-3"><dt>{t('invServiceFee')}</dt><dd className="tabular-nums">{money(pricing.serviceFeeCents)}</dd></div>}
                    <div className="flex justify-between gap-3 border-t pt-1.5 font-semibold"><dt>{t('invTheyPay', { chef: chefName || t('invTheChef') })}</dt><dd className="tabular-nums">{money(pricing.totalCents)}</dd></div>
                    {typeof pricing.managerEstimatedPayoutCents === 'number' && <div className="flex justify-between gap-3 text-muted-foreground"><dt>{t('invYouReceive')}</dt><dd className="tabular-nums">{money(pricing.managerEstimatedPayoutCents)}</dd></div>}
                  </dl> : preview.unavailableReason ? <p role="alert" className="text-sm text-destructive">{preview.unavailableReason}</p> : null}
                  {preview.expiresAt && <p className="text-xs text-muted-foreground">{t('invExpiresAt', { when: expiresText(preview.expiresAt) })}</p>}
                  {preview.warnings.map(warning => <p key={warning} className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{warning}</p>)}
                  {!preview.available && <p role="alert" className="text-sm text-destructive">{preview.unavailableReason || t('invUnavailable')}</p>}
                  {!!preview.dayErrors?.length && <ul className="space-y-0.5 text-xs text-destructive">{preview.dayErrors.map(day =>
                    <li key={day.date}>{dayLabel(day.date)}: {day.message}</li>)}</ul>}
                </>}
              {sendError && <p role="alert" className="text-sm text-destructive">{sendError}</p>}
              <Button className="min-h-11 w-full" disabled={!draft || !preview?.available || !pricing || sending} onClick={() => void send()}>
                {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t('invSend')}</Button>
              <p className="text-xs text-muted-foreground">{t('invHowItWorks')}</p>
            </section>
          </aside>
        </div>
      )}
      {chefId > 0 && !!sentList.data?.invitations.length && <section className="space-y-3" data-testid="invitations-sent-list">
        <h2 className="font-semibold">{t('invSentList', { chef: chefName || t('invTheChef') })}</h2>
        <ul className="divide-y rounded-2xl border bg-card">
          {sentList.data.invitations.map(invitation => <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <div className="min-w-0 space-y-0.5">
              <p className="font-medium">{invitation.kitchen.name} · {when(invitation)}</p>
              <p className="text-muted-foreground">{money(invitation.pricing.totalCents)} · {t(`invStatus_${invitation.status}`)}
                {invitationOpen(invitation) && ` · ${t('invExpiresAt', { when: expiresText(invitation.expiresAt, invitation.timezone) })}`}</p>
            </div>
            <div className="flex gap-2">
              {invitation.bookingId && <Button asChild variant="outline" size="sm"><Link href={`/manager/booking/${invitation.bookingId}`}>{t('invViewBooking')}</Link></Button>}
              {invitation.canWithdraw && <Button variant="ghost" size="sm" onClick={() => void withdraw(invitation)}>{t('invWithdraw')}</Button>}
            </div>
          </li>)}
        </ul>
      </section>}
    </div>
  </ManagerBookingLayout>;
}
