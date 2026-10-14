import { useTranslation } from 'react-i18next';
import type { BookingCloseout, VisitCloseout } from '@shared/clock-closeout';

export function ClockCloseoutSummary({ closeout, visit, manager = false, hideFinished = false, hideInspectionDeadline = false, embedded = false }: {
  closeout?: BookingCloseout; visit?: VisitCloseout; manager?: boolean;
  /** The chef in-session panel already says the booked time ended while check-out is still open. */
  hideFinished?: boolean;
  /** The booking page header's next-step line already states the inspection deadline. */
  hideInspectionDeadline?: boolean;
  /** Inside another card: no border of its own. */
  embedded?: boolean;
}) {
  const { t, i18n } = useTranslation(manager ? 'manager' : 'chef');
  if (!closeout) return null;
  const visits = visit ? [visit] : closeout.visits;
  const time = (value: string) => new Intl.DateTimeFormat(i18n.language, {
    timeZone: closeout.timezone, dateStyle: 'medium', timeStyle: 'short', hour12: true,
  }).format(new Date(value));
  // Visits on different dates may share the same hours, so the local date identifies each one.
  const day = (value: string) => new Intl.DateTimeFormat(i18n.language, { timeZone: closeout.timezone, dateStyle: 'medium' }).format(new Date(value));
  const lines = visits.filter(row => visits.length > 1 || (!hideFinished && ['booked_time_ended', 'ended'].includes(row.phase)) || !row.arrivalRecorded
    || (row.inspection.canRespond && !hideInspectionDeadline) || ['auto_closed_uninspected', 'manager_cleared', 'issue_filed'].includes(row.inspection.outcome));
  if (embedded && !lines.length) return null;
  return <section aria-label={t('clockCloseoutSummary')} className={embedded ? 'space-y-2' : 'rounded-xl border bg-card p-4 space-y-3'}>
    {visits.map(row => <div key={row.key} className="space-y-1 text-sm">
      {visits.length > 1 && <p className="font-medium">{day(row.scheduledStartAt)}</p>}
      {!hideFinished && ['booked_time_ended', 'ended'].includes(row.phase) && <p className="font-medium">{t('clockVisitFinished')}</p>}
      {!row.arrivalRecorded && <p>{t('clockArrivalNotRecorded')}</p>}
      {row.inspection.canRespond && !hideInspectionDeadline && <p>{t('clockInspectionDue', { time: time(row.inspection.deadline) })}</p>}
      {row.inspection.outcome === 'auto_closed_uninspected' && <p>{t('clockNoInspection')}</p>}
      {row.inspection.outcome === 'manager_cleared' && <p>{t('clockManagerInspected')}</p>}
      {row.inspection.outcome === 'issue_filed' && <p>{t('clockIssueOpen')}</p>}
    </div>)}
  </section>;
}
