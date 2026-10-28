import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { claimRequest, claimMoney } from '@/lib/damage-claims';
export function claimShownCents(c: { claimedAmountCents: number; approvedAmountCents?: number | null; finalAmountCents?: number | null }): number {
  return c.finalAmountCents ?? c.approvedAmountCents ?? c.claimedAmountCents;
}
type QueueClaim = { id: number; referenceCode?: string | null; kitchenBookingId: number | null; storageBookingId?: number | null; status: string;
  claimedAmountCents: number; approvedAmountCents?: number | null; finalAmountCents?: number | null; chefName?: string | null; locationName?: string | null;
  createdAt: string; updatedAt?: string | null };
/** Waiting on Local Cooks: the first review, the final review after the chef's deadline or dispute (and earlier-version equivalents). */
const NEEDS_YOU = ['in_review', 'under_review', 'escalated', 'chef_disputed'];
const FINISHED = ['charge_succeeded', 'resolved', 'rejected', 'expired'];
export const claimCaseHref = (claim: Pick<QueueClaim, 'kitchenBookingId' | 'storageBookingId'>) => claim.kitchenBookingId
  ? `/admin?section=booking-support&booking=${claim.kitchenBookingId}` : claim.storageBookingId ? `/admin?section=storage-rentals&rental=${claim.storageBookingId}` : null;

function waited(iso: string | null | undefined, locale: string, now = Date.now()) {
  const ms = now - Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '';
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }), hours = Math.round(ms / 3_600_000);
  return hours < 1 ? format.format(-Math.max(1, Math.round(ms / 60_000)), 'minute') : hours < 48 ? format.format(-hours, 'hour') : format.format(-Math.round(hours / 24), 'day');
}

/** Admin claims queue (owner, Oct 28): what needs Local Cooks first, oldest first; finished claims live in Claims history. */
export function DamageClaimReview() {
  const { t, i18n } = useTranslation('booking');
  const query = useQuery({ queryKey: ['/api/admin/damage-claims', 'all'],
    queryFn: () => claimRequest<{ claims: QueueClaim[] }>('/admin/damage-claims?status=all'), retry: false });
  const oldestFirst = (a: QueueClaim, b: QueueClaim) => Date.parse(a.updatedAt || a.createdAt) - Date.parse(b.updatedAt || b.createdAt);
  const claims = query.data?.claims ?? [];
  const needsYou = claims.filter(claim => NEEDS_YOU.includes(claim.status)).sort(oldestFirst);
  const waiting = claims.filter(claim => !NEEDS_YOU.includes(claim.status) && !FINISHED.includes(claim.status) && claim.status !== 'draft').sort(oldestFirst);
  const table = (rows: QueueClaim[], label: string) => <Table aria-label={label}>
    <TableHeader><TableRow>
      <TableHead>{t('dcQueueClaim')}</TableHead><TableHead>{t('dcQueueKitchen')}</TableHead><TableHead>{t('dcQueueChef')}</TableHead>
      <TableHead className="text-right">{t('dcQueueAmount')}</TableHead><TableHead>{t('dcQueueStage')}</TableHead><TableHead>{t('dcQueueWaiting')}</TableHead><TableHead><span className="sr-only">{t('dcV2OpenCase')}</span></TableHead>
    </TableRow></TableHeader>
    <TableBody>{rows.map(claim => {
      const href = claimCaseHref(claim);
      return <TableRow key={claim.id}>
        <TableCell><span className="font-medium">{claim.referenceCode || `#${claim.id}`}</span><span className="block text-xs text-muted-foreground">{t(claim.storageBookingId && !claim.kitchenBookingId ? 'dcQueueStorage' : 'dcQueueBooking')}</span></TableCell>
        <TableCell>{claim.locationName || '—'}</TableCell>
        <TableCell>{claim.chefName || '—'}</TableCell>
        <TableCell className="text-right tabular-nums">{claimMoney(claimShownCents(claim), i18n.language)}{claimShownCents(claim) !== claim.claimedAmountCents && <span className="block text-xs text-muted-foreground">{t('dcV2OfClaimed', { amount: claimMoney(claim.claimedAmountCents, i18n.language) })}</span>}</TableCell>
        <TableCell>{t(`dcV2Status_${claim.status}`, { defaultValue: claim.status })}</TableCell>
        <TableCell className="whitespace-nowrap text-muted-foreground" title={new Date(claim.updatedAt || claim.createdAt).toLocaleString(i18n.language)}>{waited(claim.updatedAt || claim.createdAt, i18n.language)}</TableCell>
        <TableCell className="text-right">{href ? <a className="whitespace-nowrap font-medium underline underline-offset-4" href={href}>{t('dcV2OpenCase')}</a> : <span className="text-muted-foreground">{t('dcV2LegacySupport')}</span>}</TableCell>
      </TableRow>;
    })}</TableBody>
  </Table>;
  return <section className="space-y-6">
    <header className="space-y-1"><h1 className="text-xl font-semibold">{t('dcV2PolicyTitle')}</h1><p className="text-sm text-muted-foreground">{t('dcV2AdminQueueIntro')}</p></header>
    {query.isPending && <p role="status">{t('dcV2Loading')}</p>}
    {query.isError && <p role="alert">{t('dcV2LoadFailed')} <Button variant="link" onClick={() => void query.refetch()}>{t('dcV2Retry')}</Button></p>}
    {query.data && <>
      <section className="space-y-2">
        <h2 className="text-base font-semibold">{t('dcQueueNeedsYou', { count: needsYou.length })}</h2>
        {needsYou.length ? <div className="rounded-xl border">{table(needsYou, t('dcQueueNeedsYou', { count: needsYou.length }))}</div>
          : <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{t('dcQueueNothing')}</p>}
      </section>
      {waiting.length > 0 && <section className="space-y-2">
        <h2 className="text-base font-semibold">{t('dcQueueWaitingOthers', { count: waiting.length })}</h2>
        <p className="text-sm text-muted-foreground">{t('dcQueueWaitingHelp')}</p>
        <div className="rounded-xl border">{table(waiting, t('dcQueueWaitingOthers', { count: waiting.length }))}</div>
      </section>}
      <p className="text-sm text-muted-foreground">{t('dcQueueFinished')} <a className="font-medium text-foreground underline underline-offset-4" href="/admin?section=damage-claims-history">{t('dcQueueHistory')}</a></p>
    </>}
  </section>;
}
export default DamageClaimReview;
