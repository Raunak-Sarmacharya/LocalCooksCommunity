import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
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
  const coverage = report.data && [
    ['tourFunnelAbsent', fraction(report.data.outcomes.absent)], ['tourFunnelRecovered', fraction(report.data.outcomes.recovered)],
    ['tourFunnelResults', fraction(report.data.outcomes.resultCoverage)], ['tourFunnelExisting', report.data.diagnostics.existingApplications],
    ['tourFunnelUnattributed', report.data.diagnostics.unattributedApplications], ['tourFunnelInvalidated', report.data.diagnostics.attributionInvalidated],
    ['tourFunnelMissingChefFeedback', report.data.diagnostics.missingChefFeedback], ['tourFunnelMissingManagerFeedback', report.data.diagnostics.missingManagerFeedback],
    ['tourFunnelFeedbackConflicts', report.data.diagnostics.feedbackConflicts], ['tourFunnelUnverifiedClosed', report.data.diagnostics.unverifiedClosed],
    ['tourFunnelPendingApplicationReview', report.data.diagnostics.pendingApplicationReview], ['tourFunnelAwaitingResult', report.data.diagnostics.awaitingResult],
    ['tourFunnelReview', report.data.diagnostics.evidenceReview], ['tourFunnelRepeats', report.data.diagnostics.repeatJourneys],
    ['tourFunnelLaterComplete', report.data.diagnostics.laterCompleted],
  ] as const;
  return <section aria-label={t('tourFunnelTitle')} className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
    <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
      <div><h2 className="font-semibold">{t('tourFunnelTitle')}</h2><p className="max-w-xl text-xs text-muted-foreground">{t('tourFunnelCohort')}</p></div>
      <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); try { setRange(tourFunnelRange(draft.from, draft.to)); setRangeError(false); } catch { setRangeError(true); } }}>
        {(['from', 'to'] as const).map(field => <label key={field} className="space-y-1 text-xs">{t(field === 'from' ? 'tourFunnelFrom' : 'tourFunnelTo')}<input aria-label={t(field === 'from' ? 'tourFunnelFrom' : 'tourFunnelTo')} type="date" className="block rounded-md border bg-background px-2 py-1.5" value={draft[field]} onChange={event => setDraft({ ...draft, [field]: event.target.value })} required /></label>)}
        <Button type="submit" size="sm" variant="outline">{t('tourFunnelUpdate')}</Button>
      </form>
    </div>
    {rangeError && <p role="alert" className="text-sm text-destructive">{t('tourFunnelRangeError')}</p>}
    {report.isLoading ? <p role="status" className="text-sm text-muted-foreground">{t('tourFunnelLoading')}</p>
      : report.isError ? <div className="flex items-center gap-3"><p role="alert" className="text-sm">{t('tourFunnelError')}</p><Button variant="outline" size="sm" onClick={() => void report.refetch()}>{t('tourFunnelRetry')}</Button></div>
      : report.data && <>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">{(['requested', 'confirmed', 'feedback', 'completed', 'applied', 'booked'] as const).map(key => { const metric = report.data!.stages[key]; return <div key={key} className="rounded-lg bg-muted/30 p-3"><dt className="text-xs text-muted-foreground">{t(`tourFunnelStage_${key}`)}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{metric.count}</dd>{key !== 'requested' && <dd className="mt-1 text-xs text-muted-foreground">{fraction(metric)}</dd>}</div>; })}</dl>
        <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{t('tourFunnelCoverage')}</summary>
          <dl className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">{coverage?.map(([key, value]) => <div key={key}><dt>{t(key)}</dt><dd>{value}</dd></div>)}</dl>
          {(['tourFunnelDefinition', 'tourFunnelRecoveryDefinition', 'tourFunnelBookingDefinition'] as const).map(key => <p key={key} className="mt-3">{t(key)}</p>)}
          <p className="mt-2">{t('tourFunnelAsOf')} {new Intl.DateTimeFormat(undefined, { timeZone: 'America/St_Johns', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(report.data.asOf))} · America/St_Johns</p>
        </details>
      </>}
  </section>;
}
