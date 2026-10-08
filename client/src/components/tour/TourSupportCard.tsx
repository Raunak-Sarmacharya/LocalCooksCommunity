import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Link } from 'wouter';

export function TourSupportCard({ role = 'chef' }: { role?: 'chef' | 'manager' }) {
  const { t } = useTranslation('common');
  return <section className="flex min-w-0 flex-col items-stretch justify-between gap-4 rounded-xl border bg-card p-5 text-sm [overflow-wrap:anywhere] sm:flex-row sm:flex-wrap sm:items-center sm:p-6">
    <div className="min-w-0 space-y-1"><h2 className="text-sm font-semibold">{t('tourSupportTitle', 'Need help with this tour?')}</h2>
      <p className="text-xs text-muted-foreground">{t('tourSupportHelp', 'Contact Local Cooks Support for help with access, kitchen tour records, or other tour questions.')}</p></div>
    <Button asChild variant="outline" size="sm" className="h-auto min-h-11 whitespace-normal py-2"><Link href={`${role === 'manager' ? '/manager' : ''}/dashboard?view=support`}>{t('tourSupportOpen', 'Open Support')}</Link></Button>
  </section>;
}
