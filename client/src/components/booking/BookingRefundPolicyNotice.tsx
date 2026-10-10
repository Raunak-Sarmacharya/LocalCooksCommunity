import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import { PRE_CONFIRMATION_REFUND_POLICY } from '@shared/kitchen-booking-policies';

export function BookingRefundPolicyNotice({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation('booking');
  return <div className="flex items-start gap-2.5 rounded-xl border bg-muted/30 p-3 text-left">
    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
    <div>
      <p className="text-sm font-medium">{t('preConfirmationRefundTitle', '100% refund before confirmation')}</p>
      {!compact && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t('preConfirmationRefundPolicy', PRE_CONFIRMATION_REFUND_POLICY)}</p>}
    </div>
  </div>;
}
