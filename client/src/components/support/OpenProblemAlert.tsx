import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { NowAttentionRow } from '@/components/booking/BookingNowCard';
import { useCommitmentProblems } from './CommitmentProblems';

/**
 * An urgent live report ("can't get in", safety) belongs at the top of the booking while the visit is on, not only in the
 * support list at the bottom. Kitchens see who reported it and can message them; the chef sees that both sides were told.
 */
export function OpenProblemAlert({ bookingId, role, chefName, kitchenName, timezone, active, messageButton, onViewReport }: {
  bookingId: number; role: 'chef' | 'manager'; chefName: string; kitchenName: string; timezone: string;
  /** The visit hasn't ended: after it, the report lives on in the support list only. */
  active: boolean; messageButton: ReactNode; onViewReport: () => void;
}) {
  const { t, i18n } = useTranslation('chef');
  const query = useCommitmentProblems('booking', bookingId, role);
  if (!active) return null;
  const open = query.data?.problems.find(problem => problem.status !== 'resolved' && problem.kind === 'live'
    && (problem.category === 'access' || problem.category === 'safety'));
  const report = open?.history.find(entry => entry.action === 'report');
  if (!open || !report || report.actorRole !== 'chef') return null;
  const time = new Intl.DateTimeFormat(i18n.resolvedLanguage || 'en-CA', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(report.at));
  const safety = open.category === 'safety';
  const title = role === 'manager'
    ? t(safety ? 'opaKitchenSafetyTitle' : 'opaKitchenAccessTitle', { chef: chefName })
    : t(safety ? 'opaChefSafetyTitle' : 'opaChefAccessTitle', { kitchen: kitchenName });
  const line = role === 'manager' ? t('opaKitchenLine', { time }) : t(safety ? 'opaChefSafetyLine' : 'opaChefAccessLine', { kitchen: kitchenName, time });
  return <NowAttentionRow data-testid="open-problem-alert" tone="warning">
    <p className="font-medium">{title}</p>
    <p className="text-sm">{line}</p>
    {role === 'manager' && <p className="whitespace-pre-wrap text-sm text-muted-foreground">“{open.description}”</p>}
    <div className="flex flex-wrap gap-2">
      {messageButton}
      <Button type="button" variant="ghost" className="min-h-11" onClick={onViewReport}>{t('opaViewReport')}</Button>
    </div>
  </NowAttentionRow>;
}
