import { useTranslation } from 'react-i18next';
export function DamageCleaningPolicy() {
  const { t } = useTranslation('booking');
  return <section id="damage-and-cleaning" className="scroll-mt-24 space-y-3 my-6">
    <h2 className="text-xl font-semibold">{t('dcV2PolicyTitle')}</h2>
    <p>{t('dcV2PolicyFiling')}</p><p>{t('dcV2PolicyReview')}</p><p>{t('dcV2PolicyPayment')}</p><p>{t('dcV2PolicyHold')}</p>
  </section>;
}
