import { useTranslation } from 'react-i18next';
import { useLocation } from 'wouter';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { initials } from '@/lib/booking-header-state';

/** Who the chef is, for the kitchen (Airbnb host view, Food Corridor renter record): initials, name, tenure, visits here, profile link. */
export function ChefSummary({ chef, name }: { chef: { id: number; memberSince?: string | null; completedBookingsHere?: number }; name: string }) {
  const { t, i18n } = useTranslation('chef');
  const [, navigate] = useLocation();
  const since = chef.memberSince && !Number.isNaN(Date.parse(chef.memberSince))
    ? t('bdhMemberSince', { date: new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language, { month: 'long', year: 'numeric' }).format(new Date(chef.memberSince)) }) : null;
  const facts = [since, typeof chef.completedBookingsHere === 'number' ? t('bdhBookingsHere', { count: chef.completedBookingsHere }) : null].filter(Boolean).join(' · ');
  const href = `/manager/customers/${chef.id}`;
  return <div className="flex items-start gap-3" data-testid="person-who">
    <Avatar className="h-10 w-10 shrink-0"><AvatarFallback className="bg-muted text-[13px] font-semibold">{initials(name)}</AvatarFallback></Avatar>
    <div className="min-w-0">
      <p className="truncate text-sm font-medium">{name}</p>
      {facts && <p className="text-[13px] leading-[18px] text-muted-foreground">{facts}</p>}
      <a href={href} onClick={event => { event.preventDefault(); navigate(href); }}
        className="inline-flex min-h-11 items-center text-[13px] font-medium underline underline-offset-4">{t('bdhViewProfile')}</a>
    </div>
  </div>;
}
