import type { ReactNode } from 'react';
import { mt } from '@/i18n/manager';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Banknote, Download } from '@/components/ui/manager-icons';
import i18n from '@/i18n';
import { formatCurrency } from '@/lib/formatters';
import { bankDepositState } from '../ledger-format';
import type { Payout } from '../types';

const TONE = { success: 'success', warning: 'warning', info: 'info', neutral: 'outline' } as const;

/**
 * Stripe → bank deposits (the account's Stripe payouts), separate from Local Cooks → Stripe transfers in "Paid".
 * Each says when it arrives (or arrived), or what to do if it failed. Statements stay downloadable.
 */
export function BankDeposits({ payouts, isLoading, isError, onRetry, onDownloadStatement, setupAlert }: {
  payouts: Payout[]; isLoading: boolean; isError: boolean; onRetry: () => void;
  onDownloadStatement: (payoutId: string) => void; setupAlert?: ReactNode;
}) {
  return <section aria-labelledby="revenue-deposits" className="space-y-3">
    <div>
      <h3 id="revenue-deposits" className="text-base font-semibold">{mt('r1bDepositsTitle')}</h3>
      <p className="mt-0.5 text-sm text-muted-foreground">{mt('r1bDepositsBody')}</p>
    </div>
    {setupAlert}
    {isError ? <Card className="flex flex-wrap items-center justify-between gap-3 rounded-2xl p-5 shadow-none">
      <p className="text-sm text-destructive">{mt('revenueSectionUnavailable', { section: mt('r1bDepositsTitle') })}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>{mt('retry')}</Button>
    </Card> : isLoading ? <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
      : !payouts.length ? <div role="status" className="rounded-2xl border border-dashed border-border/80 px-6 py-10 text-center">
        <p className="text-sm font-medium">{mt('noPayoutsYet')}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{mt('r1bDepositsEmpty')}</p>
      </div>
      : <Card className="overflow-hidden rounded-2xl border-border/70 shadow-none">
        <ul className="divide-y divide-border/60">{payouts.map(payout => {
          const state = bankDepositState(payout.status, payout.arrivalDate);
          return <li key={payout.id} data-testid="bank-deposit" className="flex items-start gap-3 px-4 py-4 sm:items-center sm:gap-4 sm:px-5">
            <span className="hidden size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground sm:flex" aria-hidden="true"><Banknote className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-semibold tabular-nums">{formatCurrency(payout.amount, payout.currency?.toUpperCase() || 'CAD', i18n.language)}</p>
                <Badge variant={TONE[state.tone]} className="font-medium">{state.label}</Badge>
              </div>
              <p className={cn('mt-0.5 text-sm', state.tone === 'warning' ? 'text-amber-900 dark:text-amber-200' : 'text-muted-foreground')}>{state.detail}</p>
            </div>
            <Button variant="ghost" size="sm" className="shrink-0" onClick={() => onDownloadStatement(payout.id)}>
              <Download className="size-4" aria-hidden="true" /><span className="sr-only sm:not-sr-only">{mt('statement')}</span>
            </Button>
          </li>;
        })}</ul>
      </Card>}
  </section>;
}
