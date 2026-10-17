import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatVisitTime, friendlyTimezoneName } from '@/lib/visit-time';
import { formatTime } from '@/lib/formatters';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { matchingLocalInstants } from '@shared/booking-dst';
import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';

const EMPTY = '__empty__';

/** Kitchen wall time resolves on the owned server context; never default to click time. */
export function VisitAssistancePanel({ bookingId, updatedAt, visits = [], onSaved, storage = false, history = [], disabled = false, timezone, fixedAction, scheduledStart, chefName }: {
  fixedAction?: 'arrival' | 'departure'; scheduledStart?: string; chefName?: string;
  bookingId: number; updatedAt: string; visits?: Array<{ id: number; startTime: string; endTime: string; updatedAt: string }>;
  onSaved: () => Promise<void>;
  storage?: boolean;
  disabled?: boolean;
  timezone?: string | null;
  history?: Array<{ actorId: number; action: string; reason: string; actualAt?: string; recordedAt: string }>;
}) {
  const { t, i18n } = useTranslation('chef');
  const locale = i18n?.resolvedLanguage || 'en-CA';
  const chef = chefName || t('fixChef');
  const [visitId, setVisitId] = useState(''), [action, setAction] = useState<string>(fixedAction || 'departure');
  const [reason, setReason] = useState(''), [actualAt, setActualAt] = useState(() => {
    if (!scheduledStart || !timezone) return '';
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(scheduledStart));
    const part = (type: string) => parts.find(value => value.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
  });
  const [occurrence, setOccurrence] = useState('');
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const selected = visits.find(visit => String(visit.id) === visitId) || (visits.length === 1 ? visits[0] : undefined);
  const displayedZone = storage ? DEFAULT_TIMEZONE : timezone || DEFAULT_TIMEZONE;
  const zoneName = friendlyTimezoneName(displayedZone, locale);
  const [actualDate, actualTime] = actualAt.split('T');
  const instants = actualDate && actualTime ? matchingLocalInstants(actualDate, actualTime, displayedZone) : [];
  const submit = async () => {
    if (disabled || saving) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      if (!instants.length || instants.length > 1 && occurrence === '') throw Error(t('assistTimeError', { zone: zoneName }));
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/manager/${storage ? 'storage-bookings' : 'bookings'}/${bookingId}/assist-visit`, { method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason, actualAt: storage || instants.length > 1 ? new Date(instants[Number(occurrence || 0)]).toISOString() : actualAt, visitId: selected?.id,
          expectedUpdatedAt: selected?.updatedAt || updatedAt, expectedBookingUpdatedAt: updatedAt }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || t('assistSaveError'));
      await onSaved(); setSaved(true); setReason(''); setActualAt('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('assistSaveError')); }
    finally { setSaving(false); }
  };
  const prefix = `assistance-${bookingId}`;
  return <section className="rounded-2xl border bg-card p-5 space-y-3" aria-label={t('assistTitle')}>
    <h2 className="font-semibold">{t(fixedAction === 'arrival' ? 'assistArrivalTitle' : fixedAction === 'departure' ? 'assistDepartureTitle' : 'assistTitle')}</h2>
    <p className="text-sm text-muted-foreground">{t('assistIntro')}</p>
    {storage && <p className="text-sm">{t('assistStorage')}</p>}
    {history.length > 0 && <div className="text-sm space-y-2" aria-label={t('fixHistory')}>{history.map((entry, index) => <p key={index}>
      {t('assistHistory', { action: t(entry.action === 'arrival' ? 'assistArrivalTitle' : entry.action === 'departure' ? 'assistDepartureTitle' : 'assistRemoval'), time: entry.actualAt ? formatVisitTime(entry.actualAt, displayedZone, locale) : t('fixTimeUnavailable'), updated: formatVisitTime(entry.recordedAt, displayedZone, locale) })} {entry.reason}
    </p>)}</div>}
    {visits.length > 1 && <label className="block text-sm">{t('bookingAttendanceVisit')} <Select value={visitId === '' ? EMPTY : visitId} onValueChange={value => setVisitId(value === EMPTY ? '' : value)} disabled={saving}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={EMPTY}>{t('bookingAttendanceChooseVisit')}</SelectItem>
        {visits.map(visit => <SelectItem key={visit.id} value={String(visit.id)}>{formatTime(visit.startTime, locale)}–{formatTime(visit.endTime, locale)}</SelectItem>)}
      </SelectContent>
    </Select></label>}
    {!fixedAction && <label className="block text-sm">{t('assistAction')} <Select value={action} onValueChange={setAction} disabled={saving}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="arrival">{t('assistArrivalTitle')}</SelectItem><SelectItem value="departure">{t('assistDepartureTitle')}</SelectItem>
        {storage && <SelectItem value="confirm_removal">{t('assistRemoval')}</SelectItem>}
      </SelectContent>
    </Select></label>}
    <label className="block text-sm" htmlFor={`${prefix}-time`}>{t(action === 'arrival' ? 'assistArrivalTime' : 'assistDepartureTime', { zone: zoneName })}</label>
    <input id={`${prefix}-time`} type="datetime-local" className="w-full rounded border bg-background p-2" value={actualAt} required onChange={event => { setActualAt(event.target.value); setOccurrence(''); }} disabled={saving} />
    {instants.length > 1 && <label className="block text-sm">{t('assistRepeated')} <Select value={occurrence === '' ? EMPTY : occurrence} onValueChange={value => setOccurrence(value === EMPTY ? '' : value)}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={EMPTY}>{t('assistChooseOccurrence')}</SelectItem>
        {instants.map((instant, index) => <SelectItem key={instant} value={String(index)}>{t(index === 0 ? 'assistFirst' : 'assistSecond')} ({formatVisitTime(new Date(instant).toISOString(), displayedZone, locale)})</SelectItem>)}
      </SelectContent>
    </Select></label>}
    <label className="block text-sm" htmlFor={`${prefix}-reason`}>{t('assistNote', { chef })}</label>
    <Textarea id={`${prefix}-reason`} value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} disabled={saving} />
    {error && <p role="alert" className="text-sm text-destructive">{error} {t('assistRetained')}</p>}
    {saved && <p role="status">{t('assistSaved')}</p>}
    <p className="text-xs text-muted-foreground">{disabled ? t('assistBlocked') : t('assistRequired')}</p>
    <Button disabled={disabled || saving || reason.trim().length < 10 || !instants.length || instants.length > 1 && occurrence === '' || visits.length > 0 && !selected} onClick={() => void submit()}>{t(saving ? 'fixSaving' : action === 'arrival' ? 'assistArrivalButton' : action === 'departure' ? 'assistDepartureButton' : 'assistRemoval')}</Button>
  </section>;
}
