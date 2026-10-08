import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Label } from '@/components/ui/label';
import { tourFunnelRange, type TourFunnel as Funnel, type FunnelMetric } from '@shared/tour-funnel';

export function TourFunnel({ role, locationId }: { role: 'manager' | 'admin'; locationId?: number }) {
  const { t } = useTranslation('common');
  const [range, setRange] = useState(() => tourFunnelRange());
  const [draft, setDraft] = useState(range);
  const [rangeError, setRangeError] = useState(false);
  const report = useQuery<Funnel>({
    queryKey: ['/api/viewings/funnel', role, auth.currentUser?.uid, locationId, range.from, range.to],
    queryFn: async () => {
      const token = await auth.currentUser?.getIdToken();
      const params = new URLSearchParams(range);
      if (locationId !== undefined) params.set('locationId', String(locationId));
      const response = await fetch(`/api/viewings/funnel?${params}`, { credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw Error('Unable to load tour funnel');
      const body = await response.json();
      if (!body.stages || !body.outcomes || !body.diagnostics) throw Error('Unable to load tour funnel');
      return body;
    }, refetchInterval: 60_000,
  });
  const fraction = (metric: FunnelMetric) => metric.rate == null ? t('tourFunnelNoDenominator') : `${metric.count}/${metric.denominator} · ${Math.round(metric.rate * 100)}%`;
  const stages = role === 'manager'
    ? ['requested', 'confirmed', 'completed', 'applied', 'booked'] as const
    : ['requested', 'confirmed', 'feedback', 'completed', 'applied', 'booked'] as const;
  const coverage = role === 'admin' && report.data && [
    ['tourFunnelAbsent', fraction(report.data.outcomes.absent)], ['tourFunnelRecovered', fraction(report.data.outcomes.recovered)],
    ['tourFunnelResults', fraction(report.data.outcomes.resultCoverage)], ['tourFunnelExisting', report.data.diagnostics.existingApplications],
    ['tourFunnelUnattributed', report.data.diagnostics.unattributedApplications], ['tourFunnelInvalidated', report.data.diagnostics.attributionInvalidated],
    ['tourFunnelMissingChefFeedback', report.data.diagnostics.missingChefFeedback], ['tourFunnelMissingManagerFeedback', report.data.diagnostics.missingManagerFeedback],
    ['tourFunnelFeedbackConflicts', report.data.diagnostics.feedbackConflicts], ['tourFunnelUnverifiedClosed', report.data.diagnostics.unverifiedClosed],
    ['tourFunnelPendingApplicationReview', report.data.diagnostics.pendingApplicationReview], ['tourFunnelAwaitingResult', report.data.diagnostics.awaitingResult],
    ['tourFunnelReview', report.data.diagnostics.evidenceReview], ['tourFunnelRepeats', report.data.diagnostics.repeatJourneys],
    ['tourFunnelLaterComplete', report.data.diagnostics.laterCompleted],
  ] as const;
  return <section aria-label={t('tourFunnelTitle')} className="min-w-0 space-y-4 rounded-xl border bg-card p-4 [overflow-wrap:anywhere] sm:p-5">
    <div className="flex min-w-0 flex-col justify-between gap-3 xl:flex-row xl:items-start">
      <div className="min-w-0"><h2 className="font-semibold">{t('tourFunnelTitle')}</h2><p className="max-w-xl text-xs text-muted-foreground">{t('tourFunnelCohort')}</p></div>
      <form className="grid w-full min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end xl:w-[30rem] xl:shrink-0" onSubmit={event => { event.preventDefault(); try { setRange(tourFunnelRange(draft.from, draft.to)); setRangeError(false); } catch { setRangeError(true); } }}>
        {(['from', 'to'] as const).map(field => <div key={field} className="min-w-0 space-y-1">
          <Label htmlFor={`tour-funnel-${role}-${field}`} className="text-xs">{t(field === 'from' ? 'tourFunnelFrom' : 'tourFunnelTo')}</Label>
          <DateField id={`tour-funnel-${role}-${field}`} minToday={false} disabledDate={date => date > new Date(new Date().setHours(0, 0, 0, 0))} placeholder={t(field === 'from' ? 'tourFunnelFrom' : 'tourFunnelTo')} className="min-h-11" value={draft[field]} onChange={value => setDraft(previous => ({ ...previous, [field]: value }))} />
        </div>)}
        <Button type="submit" size="sm" variant="outline" className="min-h-11">{t('tourFunnelUpdate')}</Button>
      </form>
    </div>
    {rangeError && <p role="alert" className="text-sm text-destructive">{t('tourFunnelRangeError')}</p>}
    {report.isLoading ? <p role="status" className="text-sm text-muted-foreground">{t('tourFunnelLoading')}</p>
      : report.isError ? <div className="flex items-center gap-3"><p role="alert" className="text-sm">{t('tourFunnelError')}</p><Button variant="outline" size="sm" onClick={() => void report.refetch()}>{t('tourFunnelRetry')}</Button></div>
      : report.data && <>
        <dl className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${role === 'manager' ? 'xl:grid-cols-5' : 'xl:grid-cols-6'}`}>{stages.map(key => { const metric = report.data!.stages[key]; return <div key={key} className="rounded-lg bg-muted/30 p-3"><dt className="text-xs text-muted-foreground">{t(`tourFunnelStage_${key}`)}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{metric.count}</dd>{key !== 'requested' && <dd className="mt-1 text-xs text-muted-foreground">{fraction(metric)}</dd>}</div>; })}</dl>
        {role === 'admin' && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{t('tourFunnelCoverage')}</summary>
          <dl className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">{coverage && coverage.map(([key, value]) => <div key={key}><dt>{t(key)}</dt><dd>{value}</dd></div>)}</dl>
          {(['tourFunnelDefinition', 'tourFunnelRecoveryDefinition', 'tourFunnelBookingDefinition'] as const).map(key => <p key={key} className="mt-3">{t(key)}</p>)}
          <p className="mt-2">{t('tourFunnelAsOf')} {new Intl.DateTimeFormat(undefined, { timeZone: 'America/St_Johns', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(report.data.asOf))} · America/St_Johns</p>
        </details>}
      </>}
  </section>;
}
