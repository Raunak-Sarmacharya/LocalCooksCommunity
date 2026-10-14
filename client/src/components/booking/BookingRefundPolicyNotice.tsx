import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import { PRE_CONFIRMATION_REFUND_POLICY } from '@shared/kitchen-booking-policies';

export function BookingRefundPolicyNotice({ compact = false, single = false }: { compact?: boolean; single?: boolean }) {
  const { t } = useTranslation('booking');
  return <div className="flex items-start gap-2.5 rounded-xl border bg-muted/30 p-3 text-left">
    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
    {single ? <p className="text-sm font-medium">{t('preConfirmationRefundSingle', 'Free to cancel until the kitchen confirms. You will get a full refund of anything paid, including taxes and fees.')}</p> : <div>
      <p className="text-sm font-medium">{t('preConfirmationRefundTitle', 'Free to cancel until the kitchen confirms your request — your card is only on hold.')}</p>
      {!compact && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t('preConfirmationRefundPolicy', PRE_CONFIRMATION_REFUND_POLICY)}</p>}
    </div>}
  </div>;
}
