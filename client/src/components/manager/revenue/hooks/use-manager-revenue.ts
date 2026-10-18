import { useQuery } from '@tanstack/react-query';
import type { ManagerRevenue } from '@shared/manager-revenue';
import { apiGet } from '@/lib/api';
import { useDateRangeParams } from './use-revenue-data';
import type { DateRange } from '../types';

export function useManagerRevenue(dateRange: DateRange, locationId?: number, kitchenId?: number, enabled = true) {
  const { startDate, endDate } = useDateRangeParams(dateRange);
  return useQuery<ManagerRevenue>({
    queryKey: ['/api/manager/revenue/ledger', startDate, endDate, locationId, kitchenId],
    queryFn: () => {
      const params = new URLSearchParams({ startDate: startDate!, endDate: endDate! });
      if (locationId) params.set('locationId', String(locationId));
      if (kitchenId) params.set('kitchenId', String(kitchenId));
      return apiGet(`/manager/revenue/ledger?${params}`);
    },
    enabled: enabled && !!startDate && !!endDate,
  });
}
