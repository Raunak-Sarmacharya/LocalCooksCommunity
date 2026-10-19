/**
 * Chef sidebar "Cancellation": ONE sentence for the moment + one "Cancel or change" text link (§1.1). Replaces the
 * old CancellationBookingCard and the inline section. The ⋯ menu keeps its entry; there is no filled button here.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiGet } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { collapseDoublePeriods } from '@shared/i18n/sentence';
import { friendlyDateTime } from '@/lib/friendly-date';
import type { CancellationPolicySnapshot } from '@shared/cancellation-policy';

type Quote = { quoteReady: boolean; chefRefundCents: number; alreadyRefundedCents?: number; feeRetainedCents: number; snapshot?: CancellationPolicySnapshot };

export function BookingCancellationCard({ bookingId, status, canCancel, onCancel, onChange, deadlineText, deadlinePassed, createdAt, multiDay, frozenPolicy }: {
  bookingId: number; status: string; canCancel: boolean; onCancel: () => void;
  /** Confirmed, not started: "Change date or time" sits next to "Cancel booking" (separate actions, like Airbnb). */
  onChange?: () => void;
  /** Fallback when the booking has no saved policy snapshot (older bookings). */
  deadlineText?: string; deadlinePassed?: boolean; createdAt?: string | Date | null;
  multiDay?: boolean; frozenPolicy?: CancellationPolicySnapshot | null;
}) {
  const { t: tbStrict, i18n } = useTranslation('booking');
  const tb = tbStrict as unknown as (key: string, options?: Record<string, unknown>) => string;
  const { t } = useTranslation('chef');
  const confirmed = status === 'confirmed';
  const { data } = useQuery<Quote>({ queryKey: ['chef-cancellation-quote', bookingId], queryFn: () => apiGet(`/bookings/${bookingId}/cancellation-quote`), staleTime: 0, enabled: confirmed });
  const snapshot = frozenPolicy ?? data?.snapshot;
  const sentence = status === 'pending' ? <p className="text-sm leading-relaxed">{tb('cpHold')}</p>
    : snapshot?.sessions[0] ? <p className="text-sm leading-relaxed">{(() => {
      // Same rule as CancellationPolicySummary, without repeating the zone (the when-line names it) or this year.
      const deadlineAt = Date.parse(snapshot.sessions[0].startAt) - snapshot.noticeHours * 3_600_000;
      const deadline = friendlyDateTime(new Date(deadlineAt), i18n.language, snapshot.timezone);
      const noRefund = snapshot.lateChargePercent === 100, charge = tb(snapshot.lateChargePercent === 50 ? 'cpHalf' : 'cpFull');
      const fee = new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'CAD' }).format((data?.feeRetainedCents ?? 0) / 100);
      const bookedInside = createdAt && new Date(createdAt).getTime() > deadlineAt;
      const key = bookedInside ? (noRefund ? 'cpBookedInsideNoRefund' : 'cpBookedInsideHalf') : Date.now() >= deadlineAt ? (noRefund ? 'cpDeadlinePastNoRefund' : 'cpDeadlinePast')
        : data?.quoteReady ? (noRefund ? 'cpDeadlineKnownNoRefund' : 'cpDeadlineKnown') : (noRefund ? 'cpDeadlineNoRefund' : 'cpDeadline');
      return collapseDoublePeriods(tb(multiDay && !bookedInside && Date.now() < deadlineAt ? 'mdCancellation' : key, { deadline, charge: multiDay && !bookedInside && Date.now() < deadlineAt ? `${snapshot.lateChargePercent}%` : charge, fee, hours: snapshot.noticeHours, late: String(snapshot.lateChargePercent) }));
    })()}</p>
    : <p className="text-sm leading-relaxed">{deadlineText && !deadlinePassed ? t('bdhCancelUntil', { time: deadlineText }) : t('bdhCancelPassed')}</p>;
  return <section aria-labelledby="booking-cancellation-title" data-testid="cancellation-card">
    <Card className="rounded-2xl border-border/70 p-4 shadow-none sm:p-6">
      <h2 id="booking-cancellation-title" className="mb-2 text-base font-semibold leading-6">{t('bdhCancellationTitle')}</h2>
      <div className="text-muted-foreground [&_p]:text-sm">{sentence}{confirmed && <p className="mt-1" data-testid="cancel-no-show">{tb('cpNoShow')}</p>}</div>
      {canCancel && status !== 'pending' && <div className="mt-1 flex flex-wrap gap-x-5">
        {onChange && <button type="button" className="min-h-11 text-[13px] font-medium underline underline-offset-4" onClick={onChange} data-testid="change-booking">{tb('chgDialogTitle')}</button>}
        <button type="button" className="min-h-11 text-[13px] font-medium underline underline-offset-4" onClick={onCancel}>{tb('chgCancelBooking')}</button>
      </div>}
    </Card>
  </section>;
}
