import { useTranslation } from 'react-i18next';
import { DamageCleaningPolicy } from '@/components/legal/DamageCleaningPolicy';
export function DamageClaimSettings() {
  const { t } = useTranslation('booking');
  return <section className="max-w-3xl space-y-3"><p>{t('dcV2FixedRules')}</p><DamageCleaningPolicy /></section>;
}
export default DamageClaimSettings;
