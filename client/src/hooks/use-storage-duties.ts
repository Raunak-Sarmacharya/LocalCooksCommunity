import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { VisitDuties } from '@shared/visit-duties';
export function useStorageDuties(bookingId: number, open: boolean) {
  return useQuery<VisitDuties>({ queryKey: ['storage-duties', bookingId], enabled: open,
    queryFn: () => apiGet(`/chef/storage-bookings/${bookingId}/duties`), staleTime: 0 });
}
