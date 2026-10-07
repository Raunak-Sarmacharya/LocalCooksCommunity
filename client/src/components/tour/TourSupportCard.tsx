import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Link } from 'wouter';

export function TourSupportCard({ role = 'chef' }: { role?: 'chef' | 'manager' }) {
  const { t } = useTranslation('common');
  return <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-5 text-sm sm:p-6">
    <div className="space-y-1"><h2 className="text-sm font-semibold">{t('tourSupportTitle', 'Need help with this tour?')}</h2>
      <p className="text-xs text-muted-foreground">{t('tourSupportHelp', 'Contact Local Cooks Support for help with access, kitchen tour records, or other tour questions.')}</p></div>
    <Button asChild variant="outline" size="sm"><Link href={`${role === 'manager' ? '/manager' : ''}/dashboard?view=support`}>{t('tourSupportOpen', 'Open Support')}</Link></Button>
  </section>;
}
