import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { Check, Loader2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SmartImage } from '@/components/ui/smart-image';
import Logo from '@/components/ui/logo';
import { getAuthHeaders } from '@/lib/api';
import { useFirebaseAuth } from '@/hooks/use-auth';
import { ContactLocalCooks } from '@/components/support/ContactLocalCooks';
import type { CheckoutOutcome } from '@shared/checkout-outcome';
import { StorageAddPrompt } from '@/components/storage/StorageRentCta';
import { currentBookingDays, type BookingDayVisit } from '@/components/booking/BookingDayList';
import { bookingResponseDeadline } from '@/lib/booking-response-deadline';
import { timeRange } from '@/lib/booking-header-state';
import { formatTime } from '@/lib/formatters';
import { getR2ProxyUrl } from '@/utils/r2-url-helper';
import { friendlyTimezoneName } from '@shared/timezone-utils';
import { cn } from '@/lib/utils';

type Translate = (key: string, options?: Record<string, unknown>) => string;
/** The slice of the chef booking details (same endpoint as the booking page) this screen shows. */
type BookingSummary = {
  status?: string; paymentStatus?: string; createdAt?: string; responseDeadlineAt?: string | null; paymentDecision?: { state?: string } | null;
  bookingDate: string; startTime: string; endTime: string; pricingMode?: string; scheduleRevision?: number; visits?: BookingDayVisit[];
  kitchen?: { name: string; photos?: string[] } | null; location?: { name: string; address?: string; timezone?: string } | null;
};

/** "Change request": how the earlier request ended, in plain words, with a way to both bookings when there are two. */
function ReplacementResult({ replacement, t }: { replacement: NonNullable<CheckoutOutcome['replacement']>; t: Translate }) {
  const values = { kitchen: replacement.kitchenName || t('checkoutTheKitchen'), oldRef: replacement.oldReference || '', newRef: replacement.newReference || '' };
  const key = { pending: 'crSuccessPending', withdrawn: 'crSuccessWithdrawn', releasing: 'crSuccessReleasing', two_bookings: 'crSuccessTwo', ended: 'crSuccessEnded', needs_support: 'crSuccessSupport' }[replacement.outcome];
  return <div className={replacement.outcome === 'two_bookings' ? 'space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4' : 'space-y-2'} data-testid="change-request-result">
    <p className="text-sm">{t(key, values)}</p>
    {replacement.outcome === 'two_bookings' && <p className="text-sm"><Link className="underline" href={`/booking/${replacement.oldBookingId}`}>{t('crViewEarlier')}</Link></p>}
  </div>;
}

export default function PaymentSuccessPage() {
  // The status call needs the restored sign-in; asking earlier gets a 401 and shows "Still verifying" to every chef.
  const { loading: authLoading } = useFirebaseAuth();
  const { t: translate, i18n } = useTranslation('booking');
  const t = translate as unknown as Translate;
  const lang = i18n.language;
  const sessionId = new URLSearchParams(window.location.search).get('session_id');
  const [outcome, setOutcome] = useState<CheckoutOutcome | null>(null);
  const [unavailable, setUnavailable] = useState(!sessionId);
  const [refresh, setRefresh] = useState(0);
  const [booking, setBooking] = useState<BookingSummary | null>(null);
  // The webhook usually lands within seconds; only a checkout still unverified after 20 s gets the "Still verifying" copy.
  const [slow, setSlow] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setSlow(true), 20_000); return () => clearTimeout(timer); }, []);
  useEffect(() => {
    if (!sessionId || authLoading) return;
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    setUnavailable(false);
    const load = async (attempt = 0) => {
      try {
        const response = await fetch(`/api/chef/bookings/by-session/${encodeURIComponent(sessionId)}`, {
          headers: await getAuthHeaders(), credentials: 'include', signal: controller.signal,
        });
        if (!response.ok) throw Error('Checkout could not be verified');
        const result = await response.json() as CheckoutOutcome;
        if (result.sessionId !== sessionId || !['request_created', 'verifying', 'slot_taken', 'needs_support'].includes(result.state)) throw Error('Checkout response mismatch');
        if (cancelled) return;
        setOutcome(result);
        // An invitation is confirmed right after its booking is created; keep checking until that lands.
        const replacementPending = result.state === 'request_created' && (['pending', 'releasing'].includes(result.replacement?.outcome || '') || !!result.invitation && !result.confirmed);
        if (!replacementPending && (result.state !== 'verifying' || attempt >= 15)) return;
      } catch {
        if (cancelled) return;
        if (attempt >= 15) { setUnavailable(true); return; }
      }
      timer = setTimeout(() => void load(attempt + 1), attempt >= 15 ? 10_000 : 2000);
    };
    void load();
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [sessionId, refresh, authLoading]);

  const state = unavailable ? 'needs_support' : outcome?.state || 'verifying';
  const confirmed = state === 'request_created' && !!outcome?.confirmed;
  // Kitchen, times and reply deadline come from the booking itself (display only; the outcome above decides the state).
  const bookingId = state === 'request_created' ? outcome?.bookingId : null;
  useEffect(() => {
    if (!bookingId) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/chef/bookings/${bookingId}/details`, { headers: await getAuthHeaders(), credentials: 'include', cache: 'no-store' });
        if (response.ok && !cancelled) setBooking(await response.json());
      } catch { /* the page still shows the outcome's own date and amount */ }
    })();
    return () => { cancelled = true; };
  }, [bookingId, confirmed]);

  const amount = outcome?.amountCents == null ? null : new Intl.NumberFormat(lang, { style: 'currency', currency: outcome.currency.toUpperCase() }).format(outcome.amountCents / 100);
  const money = outcome?.moneyStatus;
  const calm = state === 'verifying' && !slow;
  const description = confirmed ? t('checkoutConfirmedDetail') : state === 'request_created' ? t(outcome?.invitation ? 'checkoutConfirmingDetail' : 'checkoutRequestCreatedDetail')
    : calm ? t('checkoutSendingDetail')
    : state === 'verifying' ? t('checkoutVerifyingDetail')
    : state === 'slot_taken' && money === 'hold_released' ? t('checkoutHoldReleased')
    : state === 'slot_taken' && amount && money === 'refunded' ? t('checkoutRefundSent', { amount })
    : state === 'slot_taken' && amount && money === 'refund_pending' ? t('checkoutRefundPending', { amount })
    : t('checkoutNeedsSupportDetail');
  const heading = t(confirmed ? 'checkoutConfirmed' : state === 'request_created' ? 'checkoutRequestCreated' : state === 'slot_taken' ? 'checkoutSlotTaken'
    : calm ? 'checkoutSending' : state === 'verifying' ? 'checkoutVerifying' : 'checkoutNeedsSupport');
  const request = state === 'request_created' && !confirmed && !outcome?.invitation;

  const tz = booking?.location?.timezone;
  const kitchenName = booking?.kitchen?.name;
  const photo = booking?.kitchen?.photos?.find(Boolean);
  const day = (date: string, style: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) =>
    new Intl.DateTimeFormat(lang, { ...style, timeZone: 'UTC' }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`));
  const hours = (start: string, end: string, daily?: string | null) => daily === 'daily' ? t('sheetDailyRate') : timeRange(formatTime(start, lang), formatTime(end, lang));
  const days = booking ? (booking.scheduleRevision ? currentBookingDays(booking.visits ?? [], booking.scheduleRevision) : [])
    .map(visit => ({ key: visit.visitDate!, date: day(visit.visitDate!), time: hours(visit.startTime, visit.endTime, visit.pricingMode) })) : [];
  if (booking?.bookingDate && !days.length) days.push({ key: booking.bookingDate, date: day(booking.bookingDate), time: hours(booking.startTime, booking.endTime, booking.pricingMode) });
  const deadline = request && booking ? bookingResponseDeadline(booking) : null;
  const deadlineText = deadline && (() => {
    try { return new Intl.DateTimeFormat(lang, { timeZone: tz || 'America/St_Johns', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'longGeneric' }).format(deadline); }
    catch { return null; }
  })();
  // Until the booking loads (or if it can't), the outcome's own dates stand in.
  const outcomeDates = outcome?.operatingDate ? (outcome.dates && outcome.dates.length > 1
    ? t('checkoutDates', { count: outcome.dates.length, dates: outcome.dates.map(date => day(date, { dateStyle: 'medium' })).join(' · ') })
    : t('checkoutDate', { date: day(outcome.operatingDate, { dateStyle: 'medium' }) })) : null;

  return <div className="min-h-screen bg-background">
    <header className="border-b">
      <div className="mx-auto flex h-16 max-w-2xl items-center px-5 sm:px-6">
        <Link href="/dashboard" className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Logo variant="brand" className="h-8 w-auto shrink-0" />
          <span className="font-logo text-lg leading-none tracking-tight text-[#E10939]">LocalCooks</span>
        </Link>
      </div>
    </header>
    <main className="mx-auto max-w-2xl px-5 pb-16 pt-8 sm:px-6 sm:pt-12">
      <section className="space-y-6" aria-live="polite">
        <div className="space-y-2">
          {calm && <Loader2 className="mb-3 h-6 w-6 animate-spin text-muted-foreground" aria-hidden />}
          <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
          {deadlineText && kitchenName
            ? <p className="text-[15px] leading-[22px] font-medium" data-testid="reply-deadline">{t('checkoutReplyBy', { kitchen: kitchenName, deadline: deadlineText })}</p>
            : <p className="text-[15px] leading-[22px] text-foreground/90">{description}</p>}
        </div>

        {state === 'request_created' && outcome?.replacement && <ReplacementResult replacement={outcome.replacement} t={t} />}
        {state === 'request_created' ? <>
          <Card className="overflow-hidden rounded-2xl border-border/70 shadow-none" data-testid="request-summary">
            {photo && <SmartImage src={getR2ProxyUrl(photo) || photo} alt="" className="aspect-[16/9] max-h-48 w-full object-cover sm:hidden" />}
            <div className="space-y-4 p-4 sm:p-6">
              {booking && <div className="flex items-start gap-4">
                {photo && <SmartImage src={getR2ProxyUrl(photo) || photo} alt="" className="hidden aspect-[4/3] w-32 shrink-0 rounded-xl object-cover sm:block" />}
                <div className="min-w-0 space-y-1">
                  <h2 className="break-words text-lg font-semibold leading-6">{kitchenName}</h2>
                  {booking.location && <p className="flex items-start gap-1 text-[13px] leading-[18px] text-muted-foreground">
                    <MapPin className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="min-w-0 break-words">{[booking.location.name, booking.location.address].filter(part => part && part !== kitchenName).join(' · ')}</span>
                  </p>}
                </div>
              </div>}
              {booking ? <div>
                <ul className="space-y-1" data-testid="request-days">
                  {days.map(item => <li key={item.key} className="flex flex-wrap gap-x-2 text-[15px] font-medium leading-[22px] tabular-nums">
                    <span>{item.date}</span><span aria-hidden className="text-muted-foreground">·</span><span>{item.time}</span>
                  </li>)}
                </ul>
                {tz && <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">{friendlyTimezoneName(tz, lang)}</p>}
              </div> : outcomeDates && <p className="text-[15px] font-medium">{outcomeDates}</p>}
              <div className="space-y-1 border-t pt-4">
                {/* A request is a card hold until the kitchen accepts (Airbnb: "You won't be charged until the host accepts"). */}
                {amount && <p className="text-[15px] font-semibold tabular-nums">{request ? t('checkoutAmountHeld', { amount }) : amount}</p>}
                {deadlineText && <p className="text-sm text-muted-foreground">{description}</p>}
                {/* Payment-provider ids never show to chefs; "Contact Local Cooks" carries them to support. */}
                {outcome?.referenceCode && <p className="pt-1 text-[13px] text-muted-foreground">{t('checkoutBookingReference', { reference: outcome.referenceCode })}</p>}
              </div>
            </div>
          </Card>

          {request && <section className="space-y-3" aria-labelledby="next-steps">
            <h2 id="next-steps" className="text-base font-semibold">{t('checkoutNextTitle')}</h2>
            <ol className="space-y-3">
              {['rvStepSend', 'rvStepRespond', 'rvStepArrive'].map((key, index) => <li key={key} className="flex items-start gap-3 text-[15px] leading-[22px]">
                <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border', index === 0 ? 'border-foreground bg-foreground text-background' : 'border-border')} aria-hidden>
                  {index === 0 && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span className={index === 0 ? 'text-muted-foreground' : undefined}>{t(key)}</span>
              </li>)}
            </ol>
          </section>}

          <div className="flex flex-col gap-3 sm:flex-row">
            {outcome?.bookingId && <Button asChild className="min-h-11"><Link href={`/booking/${outcome.bookingId}`}>{t(confirmed ? 'checkoutViewBooking' : 'checkoutViewRequest')}</Link></Button>}
            <Button asChild variant="outline" className="min-h-11"><Link href="/dashboard">{t('checkoutDashboard')}</Link></Button>
          </div>
        </> : !calm && (amount || outcomeDates || state === 'slot_taken') && <div className="space-y-1 rounded-xl bg-muted/50 px-4 py-3 text-sm" data-testid="checkout-facts">
          {amount && <p className="font-medium tabular-nums">{amount}</p>}
          {outcomeDates && <p>{outcomeDates}</p>}
          {state === 'slot_taken' && <p className="text-muted-foreground">{t('checkoutOthersUnchanged')}</p>}
        </div>}

        {!calm && (state !== 'request_created' || outcome?.replacement && ['pending', 'releasing', 'needs_support'].includes(outcome.replacement.outcome)) && <div className="flex flex-wrap items-center gap-4">
          <Button variant="outline" className="min-h-11" onClick={() => setRefresh(value => value + 1)}>{t('checkoutCheckAgain')}</Button>
          <ContactLocalCooks role="chef" situation={description} checkoutReference={sessionId} paymentReference={outcome?.paymentIntentId} />
        </div>}
        {state !== 'request_created' && <p><Link className="text-sm underline underline-offset-4" href="/dashboard">{t('checkoutDashboard')}</Link></p>}
        {state === 'request_created' && outcome?.kitchenId && <div className="pt-4"><StorageAddPrompt kitchenId={outcome.kitchenId} /></div>}
      </section>
    </main>
  </div>;
}
