import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DamageClaimSheet } from './DamageClaimSheet';
export function ManagerDamageClaimEntry({ bookingId, chefName, visits }: { bookingId: number; chefName: string; visits: Array<{ id: number }> }) {
  const { t } = useTranslation('booking');
  const [visitId, setVisitId] = useState(visits.at(-1)?.id);
  return <div className="flex flex-wrap items-center gap-3">
    {visits.length > 1 && <label className="text-sm">{t('dcV2AffectedVisit')} <select className="rounded border p-2 bg-background" value={visitId} onChange={event => setVisitId(Number(event.target.value))}>
      {visits.map((visit, index) => <option key={visit.id} value={visit.id}>{t('dcV2Visit', { number: index + 1 })}</option>)}</select></label>}
    <DamageClaimSheet bookingId={bookingId} visitId={visitId} chefName={chefName} />
  </div>;
}
