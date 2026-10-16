import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Mail } from 'lucide-react';
import { formatTime } from '@/lib/formatters';
import { invitationOpen, invitationRequest, type Invitation } from '@/lib/invitations';

/** Open kitchen invitations at the top of the chef's dashboard: who invited, when, the price, and one way to review. */
export function ChefInvitationsBanner() {
  const { t, i18n } = useTranslation('booking');
  const locale = i18n.resolvedLanguage || 'en-CA';
  const query = useQuery({ queryKey: ['chef-invitations'], refetchOnWindowFocus: true, staleTime: 30_000, retry: false,
    queryFn: () => invitationRequest<{ invitations: Invitation[] }>('/api/chef/invitations') });
  const open = (query.data?.invitations || []).filter(invitationOpen);
  if (!open.length) return null;
  const money = (cents: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD' }).format(cents / 100);
  return <aside className="space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm" data-testid="chef-invitations">
    {open.map(invitation => <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-3">
      <p className="flex items-start gap-2"><Mail className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{t('invBanner', { kitchen: invitation.kitchen.name,
          day: new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${invitation.date}T12:00:00Z`)),
          time: formatTime(invitation.startTime, locale), total: money(invitation.pricing.totalCents) })}</span></p>
      <Link className="font-medium underline underline-offset-4" href={`/invitation/${invitation.id}`}>{t('invReview')}</Link>
    </div>)}
  </aside>;
}
