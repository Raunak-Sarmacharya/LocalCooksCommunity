import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { getAuthHeaders } from '@/lib/api';
import { partialAcceptanceDeadlineText, type PartialAcceptance } from '@shared/partial-acceptance';

/**
 * The kitchen accepted without some equipment (owner, Oct 17): the chef accepts or declines the new total here; the kitchen
 * sees that it waits for the chef and can withdraw (= decline the request). Nothing is charged until the chef accepts.
 */
export function PartialAcceptanceCard({ bookingId, proposal, manager, kitchenName, chefName, timezone, onChanged, onWithdraw, withdrawing }: {
  bookingId: number; proposal: PartialAcceptance; manager: boolean; kitchenName: string; chefName: string; timezone?: string;
  onChanged: () => void | Promise<void>; onWithdraw?: () => void; withdrawing?: boolean;
}) {
  const { t, i18n } = useTranslation('booking');
  const { toast } = useToast();
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const lng = i18n.resolvedLanguage || 'en-CA';
  const money = (cents: number) => new Intl.NumberFormat(lng, { style: 'currency', currency: 'CAD' }).format(cents / 100);
  const day = (date: string) => new Intl.DateTimeFormat(lng, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00Z`));
  const values = {
    kitchen: kitchenName, chef: chefName, newTotal: money(proposal.newTotalCents), oldTotal: money(proposal.oldTotalCents),
    items: new Intl.ListFormat(lng, { type: 'conjunction' }).format(proposal.declined.map(item => item.date ? `${item.name} (${day(item.date)})` : item.name)),
    deadline: partialAcceptanceDeadlineText(proposal.deadlineAt, lng, timezone),
  };

  const answer = async (choice: 'accept' | 'decline') => {
    setBusy(choice);
    try {
      const response = await fetch(`/api/chef/bookings/${bookingId}/partial-acceptance`, { method: 'POST', credentials: 'include',
        headers: await getAuthHeaders(), body: JSON.stringify({ proposalId: proposal.id, answer: choice }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || t('paAnswerFailed'));
      toast({ title: t(choice === 'accept' ? 'paAcceptedToast' : 'paDeclinedToast',
        choice === 'accept' ? { amount: money(proposal.newTotalCents) } : undefined) });
      // Refresh before clearing busy so the waiting card/pill don't flash after the server already closed the offer.
      await onChanged();
    } catch (error) {
      toast({ title: t('paAnswerFailed'), description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
      await onChanged();
    } finally {
      setBusy(null); setConfirmDecline(false);
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sky-950" data-testid="partial-acceptance-card" aria-labelledby="partial-acceptance-title">
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="space-y-1 text-sm leading-relaxed">
          <h2 id="partial-acceptance-title" className="font-semibold">{t(manager ? 'paKitchenWaitingTitle' : 'paChefCardTitle', values)}</h2>
          <p>{t(manager ? 'paKitchenWaitingBody' : 'paChefCardBody', values)}</p>
          <p className="text-sky-900/80">{t(manager ? 'paKitchenWaitingNote' : 'paChefCardNote', values)}</p>
        </div>
      </div>
      {manager ? onWithdraw && (
        <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" onClick={onWithdraw} disabled={withdrawing}>
          {withdrawing && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{t('paKitchenWithdraw')}
        </Button>
      ) : confirmDecline ? (
        <div className="space-y-2" role="group" aria-label={t('paChefDeclineConfirm')}>
          <p className="text-sm font-medium">{t('paChefDeclineConfirm')}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="destructive" className="min-h-11" onClick={() => void answer('decline')} disabled={!!busy}>
              {busy === 'decline' && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{t('paChefDeclineYes')}
            </Button>
            <Button type="button" variant="ghost" className="min-h-11" onClick={() => setConfirmDecline(false)} disabled={!!busy}>{t('paChefDeclineBack')}</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" className="min-h-11" onClick={() => void answer('accept')} disabled={!!busy}>
            {busy === 'accept' && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{t('paChefAccept', values)}
          </Button>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setConfirmDecline(true)} disabled={!!busy}>{t('paChefDecline')}</Button>
        </div>
      )}
    </section>
  );
}
