import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/queryClient';
import { useFirebaseAuth } from '@/hooks/use-auth';
import type { TourApplicationNextStep } from '@shared/tour-application';

export function TourApplicationButton({ id, version }: { id: number; version: string }) {
  const { user } = useFirebaseAuth();
  const { t } = useTranslation('chef');
  const { data, isError, refetch } = useQuery<TourApplicationNextStep>({
    queryKey: ['/api/viewings/chef', user?.uid, id, 'application-next-step', version],
    queryFn: async () => (await apiRequest('GET', `/api/viewings/chef/${id}/application-next-step`)).json(),
    staleTime: 0,
  });
  if (isError) return <Button variant="outline" size="sm" onClick={() => void refetch()}>{t('tourApplicationRetry', 'Check application next step')}</Button>;
  if (!data || data.action === 'unavailable') return null;
  const label = data.action === 'apply' ? data.outcomeVerified === false ? t('tourRequestToApply') : t('tourApplyWhenReady', 'Apply when you’re ready')
    : data.action === 'continue' ? t('tourContinueApplication', 'Continue application') : data.applicationId
      ? t('tourViewApplication', 'View application') : t('tourViewKitchenAccess', 'View kitchen access');
  return <Button asChild variant="outline" size="sm" className="h-auto min-h-11 max-w-full whitespace-normal py-2"><Link href={data.href}>{label}</Link></Button>;
}
