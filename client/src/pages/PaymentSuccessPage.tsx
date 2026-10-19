import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { getAuthHeaders } from '@/lib/api';
import { useFirebaseAuth } from '@/hooks/use-auth';
import { ContactLocalCooks } from '@/components/support/ContactLocalCooks';
import type { CheckoutOutcome } from '@shared/checkout-outcome';
import { StorageAddPrompt } from '@/components/storage/StorageRentCta';

/** "Change request": how the earlier request ended, in plain words, with a way to both bookings when there are two. */
function ReplacementResult({ replacement, t }: { replacement: NonNullable<CheckoutOutcome['replacement']>; t: (key: string, options?: Record<string, unknown>) => string }) {
  const values = { kitchen: replacement.kitchenName || t('checkoutTheKitchen'), oldRef: replacement.oldReference || '', newRef: replacement.newReference || '' };
  const key = { pending: 'crSuccessPending', withdrawn: 'crSuccessWithdrawn', releasing: 'crSuccessReleasing', two_bookings: 'crSuccessTwo', ended: 'crSuccessEnded', needs_support: 'crSuccessSupport' }[replacement.outcome];
  return <div className={replacement.outcome === 'two_bookings' ? 'space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3' : 'space-y-2'} data-testid="change-request-result">
    <p className="text-sm">{t(key, values)}</p>
    {replacement.outcome === 'two_bookings' && <p className="text-sm"><Link className="underline" href={`/booking/${replacement.oldBookingId}`}>{t('crViewEarlier')}</Link></p>}
  </div>;
}

export default function PaymentSuccessPage() {
  useFirebaseAuth();
  const { t: translate, i18n } = useTranslation('booking');
  const t = translate as unknown as (key: string, options?: Record<string, unknown>) => string;
  const sessionId = new URLSearchParams(window.location.search).get('session_id');
  const [outcome, setOutcome] = useState<CheckoutOutcome | null>(null);
  const [unavailable, setUnavailable] = useState(!sessionId);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!sessionId) return;
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
  }, [sessionId, refresh]);

  const state = unavailable ? 'needs_support' : outcome?.state || 'verifying';
  const amount = outcome?.amountCents == null ? null : new Intl.NumberFormat(i18n.language, { style: 'currency', currency: outcome.currency.toUpperCase() }).format(outcome.amountCents / 100);
  const money = outcome?.moneyStatus;
  const confirmed = state === 'request_created' && !!outcome?.confirmed;
  const description = confirmed ? t('checkoutConfirmedDetail') : state === 'request_created' ? t(outcome?.invitation ? 'checkoutConfirmingDetail' : 'checkoutRequestCreatedDetail')
    : state === 'verifying' ? t('checkoutVerifyingDetail')
    : state === 'slot_taken' && money === 'hold_released' ? t('checkoutHoldReleased')
    : state === 'slot_taken' && amount && money === 'refunded' ? t('checkoutRefundSent', { amount })
    : state === 'slot_taken' && amount && money === 'refund_pending' ? t('checkoutRefundPending', { amount })
    : t('checkoutNeedsSupportDetail');
  return <main className="min-h-screen flex items-center justify-center bg-background px-6 py-12">
    <section className="w-full max-w-md space-y-5" aria-live="polite">
      <h1 className="text-xl font-semibold">{t(confirmed ? 'checkoutConfirmed' : state === 'request_created' ? 'checkoutRequestCreated' : state === 'slot_taken' ? 'checkoutSlotTaken' : state === 'verifying' ? 'checkoutVerifying' : 'checkoutNeedsSupport')}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
      {/* A request is a card hold until the kitchen accepts (Airbnb: "You won't be charged until the host accepts"). */}
      {amount && <p className="text-sm font-medium">{state === 'request_created' && !confirmed && !outcome?.invitation ? t('checkoutAmountHeld', { amount }) : amount}</p>}
      {outcome?.operatingDate && (() => {
        const day = (date: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
        return outcome.dates && outcome.dates.length > 1
          ? <p className="text-sm">{t('checkoutDates', { count: outcome.dates.length, dates: outcome.dates.map(day).join(' · ') })}</p>
          : <p className="text-sm">{t('checkoutDate', { date: day(outcome.operatingDate) })}</p>;
      })()}
      {state === 'request_created' && outcome?.replacement && <ReplacementResult replacement={outcome.replacement} t={t} />}
      {state === 'slot_taken' && <p className="text-sm">{t('checkoutOthersUnchanged')}</p>}
      {/* Payment-provider ids never show to chefs; "Contact Local Cooks" carries them to support. */}
      {outcome?.referenceCode && <p className="text-sm">{t('checkoutBookingReference', { reference: outcome.referenceCode })}</p>}
      {state === 'request_created' && outcome?.bookingId && <Button asChild><Link href={`/booking/${outcome.bookingId}`}>{t(confirmed ? 'checkoutViewBooking' : 'checkoutViewRequest')}</Link></Button>}
      {(state !== 'request_created' || outcome?.replacement && ['pending', 'releasing', 'needs_support'].includes(outcome.replacement.outcome)) && <div className="flex flex-wrap items-center gap-4">
        <Button variant="outline" onClick={() => setRefresh(value => value + 1)}>{t('checkoutCheckAgain')}</Button>
        <ContactLocalCooks role="chef" situation={description} checkoutReference={sessionId} paymentReference={outcome?.paymentIntentId} />
      </div>}
      {state === 'request_created' && outcome?.kitchenId && <StorageAddPrompt kitchenId={outcome.kitchenId} />}
      <p><Link className="text-sm underline" href="/dashboard">{t('checkoutDashboard')}</Link></p>
    </section>
  </main>;
}
