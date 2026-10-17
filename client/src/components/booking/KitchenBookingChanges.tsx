import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Loader2 } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { formatVisitTime } from '@/lib/visit-time';
import { friendlyTimezoneName } from '@shared/timezone-utils';
import { formatTime } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { addHour } from '@shared/operating-hours';
import type { ChangeSchedule } from '@shared/kitchen-booking-change';
import { NowAttentionRow } from './BookingNowCard';

/** Chef changes a confirmed booking (owner, Oct 16): request → kitchen approves → difference charged or refunded. Server: WP-RS. */
type Money = { oldTotalCents: number; newTotalCents: number; payCents: number; refundCents: number; feeKeptCents: number; currency: string };
type Change = { id: string; state: string; revision: number; original: ChangeSchedule; destination: ChangeSchedule; money: Money;
  decisionBy: string; freeCancelAfter?: string; canDecide: boolean; canWithdraw: boolean; cardDeclined?: boolean;
  /** Kitchen view only: its payout change in cents (+ more, − less), before the card processing fee. */ kitchenPayoutChangeCents?: number };
type Changes = { original: ChangeSchedule; canRequest: { allowed: boolean; reason?: string; code?: string; values?: Record<string, unknown>; until?: string }; open?: Change; timezone: string | null;
  /** The kitchen's booking length limits (hours), same as new bookings. */ limits?: { minHours: number; maxHours: number };
  /** The current refund deadline, to say whether a change moves it. */ freeCancelUntil?: string };
type Preview = { destination: ChangeSchedule; money: Money; decisionBy: string; freeCancelAfter?: string; quoteHash: string };
type Slot = { time: string; available: number; isFullyBooked: boolean };

const SETTLING = ['capture_pending', 'refund_pending', 'release_pending'];

/** The API's stable error code, kept so the message can be shown in the reader's own language. */
class ChangeApiError extends Error { constructor(message: string, public code?: string, public values?: Record<string, unknown>) { super(message); } }
/** `code` → a `booking` i18n key: `chooseDifferentTime` becomes `chgErrChooseDifferentTime`. */
const errorKey = (code: string) => `chgErr${code.charAt(0).toUpperCase()}${code.slice(1)}`;
/** Coded errors use their translated copy; anything else falls back to the server's English message. */
function errorText(t: TFunction<'booking'>, cause: unknown): string {
  if (cause instanceof ChangeApiError && cause.code) return t(errorKey(cause.code), { ...cause.values, defaultValue: cause.message });
  return cause instanceof Error ? cause.message : t('chgError');
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new ChangeApiError(result.error || 'Something went wrong. Try again.', result.code, result.values);
  return result as T;
}

function useFormat(timezone?: string | null) {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || 'en-CA';
  const money = (cents: number, currency = 'CAD') => new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
  const day = (date: string) => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00Z`));
  const schedule = (value: ChangeSchedule) => `${day(value.date)} · ${formatTime(value.slots[0]?.startTime || '', locale)}–${formatTime(value.slots.at(-1)?.endTime || '', locale)}`;
  // Deadlines always name the kitchen's zone ("Oct 17, 2026, 12:10 p.m. Newfoundland Time").
  const when = (iso: string) => timezone ? `${formatVisitTime(iso, timezone, locale)} ${friendlyTimezoneName(timezone, locale)}` : new Date(iso).toLocaleString(locale);
  return { money, schedule, when, locale };
}

/** The open change on the booking page's Now card: one row for whoever has to act or is waiting. Nothing when there's none. */
export function KitchenBookingChanges({ bookingId, manager, onChanged, timezone, counterpart }: { bookingId: number; manager: boolean;
  onChanged: () => Promise<void>; timezone?: string | null; counterpart: string; variant?: 'now' | 'card' }) {
  const { t } = useTranslation('booking');
  const f = useFormat(timezone);
  const [data, setData] = useState<Changes | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [declining, setDeclining] = useState(false), [message, setMessage] = useState('');
  const load = () => api<Changes>(`/api/bookings/${bookingId}/changes`).then(setData).catch(() => {});
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 30_000); return () => clearInterval(timer); }, [bookingId]);
  const open = data?.open;
  if (!open) return null;
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await work(); await load(); await onChanged(); setDeclining(false); setMessage(''); }
    catch (cause) { setError(errorText(t, cause)); }
    finally { setBusy(false); }
  };
  const decide = (action: 'approve' | 'decline' | 'withdraw') => act(() => api(`/api/bookings/${bookingId}/changes/${open.id}/decision`,
    { action, revision: open.revision, ...(action === 'decline' && message.trim() ? { message: message.trim() } : {}) }));
  const payAnotherCard = () => act(async () => {
    const result = await api<{ url: string }>(`/api/bookings/${bookingId}/changes/${open.id}/checkout`, { returnPath: `/booking/${bookingId}` });
    window.location.assign(result.url);
  });
  const m = open.money, now = f.schedule(open.destination), was = f.schedule(open.original);
  const payout = manager && typeof open.kitchenPayoutChangeCents === 'number' && open.kitchenPayoutChangeCents !== 0
    ? t(open.kitchenPayoutChangeCents > 0 ? 'chgPayoutUpKitchen' : 'chgPayoutDownKitchen', { amount: f.money(Math.abs(open.kitchenPayoutChangeCents), m.currency) }) : '';
  const priceLine = m.payCents > 0 ? t(manager ? 'chgPriceUpKitchen' : 'chgHoldChef', { amount: f.money(m.payCents, m.currency) })
    : m.refundCents > 0 ? t(manager ? 'chgPriceDownKitchen' : 'chgRefundIfApproved', { amount: f.money(m.refundCents, m.currency) })
    : t('chgSamePrice');
  return <NowAttentionRow data-testid="booking-change-open" tone={manager && open.canDecide ? 'warning' : 'info'}>
    <p className="font-medium">{t(manager ? 'chgKitchenTitle' : 'chgChefTitle', { chef: counterpart, when: now })}</p>
    {SETTLING.includes(open.state) ? <p className="text-sm">{t('chgSettling')}</p>
      : open.state === 'recovery_required' ? <p className="text-sm">{t('chgRecovery', { when: was })}</p>
      : <>
        <p className="text-sm">{manager ? t('chgKitchenBody', { was, by: f.when(open.decisionBy) }) : t('chgChefBody', { kitchen: counterpart, by: f.when(open.decisionBy), was })}</p>
        <p className="text-sm">{priceLine}</p>
        {payout && <p className="text-sm" data-testid="change-kitchen-payout">{payout}</p>}
        {open.freeCancelAfter && <p className="text-sm text-muted-foreground">{t(data?.freeCancelUntil && Date.parse(data.freeCancelUntil) === Date.parse(open.freeCancelAfter)
          ? (manager ? 'chgDeadlineKitchenSame' : 'chgDeadlineChefSame') : (manager ? 'chgDeadlineKitchen' : 'chgDeadlineChef'), { when: f.when(open.freeCancelAfter) })}</p>}
      </>}
    {open.cardDeclined && !manager && <p className="text-sm font-medium">{t('chgCardDeclined')}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {manager && open.canDecide && (declining ? <div className="space-y-2">
      <label className="block text-sm" htmlFor={`decline-${open.id}`}>{t('chgDeclineNote', { chef: counterpart })}</label>
      <Textarea id={`decline-${open.id}`} maxLength={500} value={message} disabled={busy} onChange={event => setMessage(event.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void decide('decline')}>{t('chgDeclineConfirm')}</Button>
        <Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => setDeclining(false)}>{t('chgBack')}</Button>
      </div>
    </div> : <div className="flex flex-wrap gap-2">
      <Button className="min-h-11" disabled={busy} onClick={() => void decide('approve')}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{t('chgApprove')}</Button>
      <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => setDeclining(true)}>{t('chgDecline')}</Button>
    </div>)}
    {!manager && (open.cardDeclined || open.canWithdraw) && <div className="flex flex-wrap gap-2">
      {open.cardDeclined && <Button className="min-h-11" disabled={busy} onClick={() => void payAnotherCard()}>{t('chgPayAnotherCard', { amount: f.money(m.payCents, m.currency) })}</Button>}
      {open.canWithdraw && <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void decide('withdraw')}>{t('chgWithdraw')}</Button>}
    </div>}
  </NowAttentionRow>;
}

/** Chef's "Change date or time": pick a new day and hours, see the exact money first, then send it to the kitchen. */
export function ChangeBookingDialog({ bookingId, kitchenId, kitchenName, timezone, open, onOpenChange, onChanged }: { bookingId: number; kitchenId: number;
  kitchenName: string; timezone?: string | null; open: boolean; onOpenChange: (open: boolean) => void; onChanged: () => Promise<void> }) {
  const { t } = useTranslation('booking');
  const f = useFormat(timezone);
  const [data, setData] = useState<Changes | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [date, setDate] = useState(''), [start, setStart] = useState(''), [hours, setHours] = useState(1);
  const [slots, setSlots] = useState<Slot[] | null>(null), [preview, setPreview] = useState<Preview | null>(null);
  const [requestKey, setRequestKey] = useState('');
  useEffect(() => {
    if (!open) return;
    setData(null); setError(''); setPreview(null); setSlots(null); setRequestKey(crypto.randomUUID());
    api<Changes>(`/api/bookings/${bookingId}/changes`).then(result => {
      setData(result); setDate(result.original.date); setStart(result.original.slots[0]?.startTime || ''); setHours(result.original.slots.length || 1);
    }).catch(cause => setError(errorText(t, cause)));
  }, [open, bookingId]);
  useEffect(() => {
    if (!open || !date || !data?.canRequest.allowed) return;
    setSlots(null); setPreview(null);
    api<Slot[]>(`/api/chef/kitchens/${kitchenId}/slots?date=${date}&changing=${bookingId}`)
      .then(result => setSlots(Array.isArray(result) ? result : [])).catch(() => setSlots([]));
  }, [open, date, kitchenId, bookingId, data?.canRequest.allowed]);
  const free = useMemo(() => new Set((slots || []).filter(slot => !slot.isFullyBooked && slot.available > 0).map(slot => slot.time)), [slots]);
  // Longest run of free hours from the chosen start (consecutive hours only, like booking).
  const minHours = data?.limits?.minHours ?? 1, lengthCap = data?.limits?.maxHours ?? 12;
  // Free consecutive hours from the chosen start, never beyond the kitchen's longest booking.
  const maxHours = useMemo(() => { let n = 0, at = start; while (at && free.has(at) && n < lengthCap) { n++; at = addHour(at); } return n; }, [free, start, lengthCap]);
  const chosen = useMemo(() => { const out: ChangeSchedule['slots'] = []; let at = start;
    for (let i = 0; i < hours && at; i++) { const end = addHour(at); out.push({ startTime: at, endTime: end }); at = end; } return out; }, [start, hours]);
  const ready = !!data?.canRequest.allowed && !!date && chosen.length > 0 && hours <= maxHours && hours >= minHours;
  const unchanged = !!data && date === data.original.date && chosen.length === data.original.slots.length && chosen[0]?.startTime === data.original.slots[0]?.startTime;
  useEffect(() => {
    if (!open || !ready || unchanged) { setPreview(null); return; }
    let live = true; setError('');
    api<Preview>(`/api/bookings/${bookingId}/changes/preview`, { destination: { date, windowStart: chosen[0].startTime, slots: chosen } })
      .then(result => { if (live) setPreview(result); }).catch(cause => { if (live) { setPreview(null); setError(errorText(t, cause)); } });
    return () => { live = false; };
  }, [open, ready, unchanged, date, chosen, bookingId]);
  const send = async () => {
    if (!preview) return;
    setBusy(true); setError('');
    try {
      await api(`/api/bookings/${bookingId}/changes`, { destination: preview.destination, quoteHash: preview.quoteHash, requestKey });
      // Sent: close at once; the page refreshes behind it (waiting on every query kept the dialog open for seconds).
      onOpenChange(false); void onChanged();
    } catch (cause) { setError(errorText(t, cause)); }
    finally { setBusy(false); }
  };
  const m = preview?.money;
  const headline = m ? m.payCents > 0 ? t('chgYouPay', { amount: f.money(m.payCents, m.currency) }) : m.refundCents > 0 ? t('chgYouGetBack', { amount: f.money(m.refundCents, m.currency) }) : t('chgSamePrice') : '';
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>{t('chgDialogTitle')}</DialogTitle>
        <DialogDescription>{data ? t('chgCurrent', { kitchen: kitchenName, when: f.schedule(data.original) }) : t('chgLoading')}</DialogDescription></DialogHeader>
      {!data ? (error ? <p role="alert" className="text-sm text-destructive">{error}</p> : <Loader2 className="h-5 w-5 animate-spin" aria-label={t('chgLoading')} />)
        : !data.canRequest.allowed ? <div className="space-y-3">
          <p className="text-sm">{data.canRequest.code ? t(errorKey(data.canRequest.code), { ...data.canRequest.values, defaultValue: data.canRequest.reason || t('chgNotAllowed') }) : data.canRequest.reason || t('chgNotAllowed')}</p>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('chgClose')}</Button>
        </div>
        : <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <label className="text-sm font-medium">{t('chgDate')}
              <input type="date" className="mt-1 block min-h-11 w-full rounded-md border bg-background px-3" value={date} disabled={busy} onChange={event => setDate(event.target.value)} />
            </label>
            <label className="text-sm font-medium">{t('chgHours')}
              <select className="mt-1 block min-h-11 w-full rounded-md border bg-background px-3" value={hours} disabled={busy} onChange={event => setHours(Number(event.target.value))}>
                {Array.from({ length: lengthCap - minHours + 1 }, (_, i) => i + minHours).map(n => <option key={n} value={n} disabled={n > maxHours}>{t('chgHoursOption', { count: n })}</option>)}
              </select>
            </label>
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">{t('chgStart')}</legend>
            {slots === null ? <Loader2 className="h-4 w-4 animate-spin" aria-label={t('chgLoading')} />
              : !slots.some(slot => free.has(slot.time)) ? <p className="text-sm text-muted-foreground">{t('chgNoTimes')}</p>
              : <div className="flex flex-wrap gap-2">{slots.map(slot => <Button key={slot.time} type="button" size="sm" className="min-h-11"
                  variant={slot.time === start ? 'default' : 'outline'} disabled={busy || !free.has(slot.time)} aria-pressed={slot.time === start}
                  onClick={() => setStart(slot.time)}>{formatTime(slot.time, f.locale)}</Button>)}</div>}
          </fieldset>
          {unchanged && <p className="text-sm text-muted-foreground">{t('chgPickDifferent')}</p>}
          {start && slots !== null && maxHours > 0 && hours > maxHours && <p role="status" className="text-sm text-amber-800">{t('chgTooLong', { count: maxHours, time: formatTime(start, f.locale) })}</p>}
          {preview && m && <section className="space-y-2 rounded-xl border bg-muted/30 p-4 text-sm" aria-live="polite" data-testid="change-preview">
            <p>{t('chgNewTime', { when: f.schedule(preview.destination) })}</p>
            <p className="text-lg font-semibold">{headline}</p>
            <details><summary className="cursor-pointer font-medium underline-offset-4 hover:underline">{t('chgSeeBreakdown')}</summary>
              <dl className="mt-2 space-y-1">
                <div className="flex justify-between gap-3"><dt>{t('chgCurrentTotal')}</dt><dd className="tabular-nums">{f.money(m.oldTotalCents, m.currency)}</dd></div>
                <div className="flex justify-between gap-3"><dt>{t('chgNewTotal')}</dt><dd className="tabular-nums">{f.money(m.newTotalCents, m.currency)}</dd></div>
                {m.feeKeptCents > 0 && <div className="flex justify-between gap-3"><dt>{t('chgFeeKept')}</dt><dd className="tabular-nums">−{f.money(m.feeKeptCents, m.currency)}</dd></div>}
              </dl>
            </details>
            {preview.freeCancelAfter && <p>{t(data?.freeCancelUntil && Date.parse(data.freeCancelUntil) === Date.parse(preview.freeCancelAfter) ? 'chgDeadlineChefSame' : 'chgDeadlineChef', { when: f.when(preview.freeCancelAfter) })}</p>}
            <p className="text-muted-foreground">{t(m.payCents > 0 ? 'chgHowItWorksHold' : 'chgHowItWorks', { kitchen: kitchenName, by: f.when(preview.decisionBy) })}</p>
          </section>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => onOpenChange(false)}>{t('chgKeep')}</Button>
            <Button className="min-h-11" disabled={busy || !preview} onClick={() => void send()}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{t('chgSend')}</Button>
          </div>
        </div>}
    </DialogContent>
  </Dialog>;
}
