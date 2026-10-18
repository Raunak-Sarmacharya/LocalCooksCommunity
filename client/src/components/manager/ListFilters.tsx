import { useTranslation } from 'react-i18next';
import { DateField } from '@/components/ui/date-field';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function ListFilters({ status, onStatus, statuses, from, to, onFrom, onTo }: {
  status: string; onStatus: (value: string) => void; statuses: Array<{ value: string; label: string }>;
  from: string; to: string; onFrom: (value: string) => void; onTo: (value: string) => void;
}) {
  const { t } = useTranslation('manager');
  return <div className="flex flex-wrap items-center gap-2">
    <Select value={status} onValueChange={onStatus}>
      <SelectTrigger className="w-48" aria-label={t('r2Status')}><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="all">{t('r2AllStatuses')}</SelectItem>
        {statuses.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
      </SelectContent>
    </Select>
    <div className="w-48"><DateField value={from} onChange={onFrom} minToday={false} placeholder={t('r2From')} aria-label={t('r2From')} /></div>
    <div className="w-48"><DateField value={to} onChange={onTo} minToday={false} placeholder={t('r2To')} aria-label={t('r2To')} /></div>
    {(from || to || status !== 'all') && <Button variant="ghost" onClick={() => { onFrom(''); onTo(''); onStatus('all'); }}>{t('r2ClearFilters')}</Button>}
  </div>;
}
