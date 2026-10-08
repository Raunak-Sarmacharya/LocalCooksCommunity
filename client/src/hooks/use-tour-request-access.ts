import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getAuthHeaders } from '@/lib/api';
import { useTourClock } from './use-tour-clock';
import type { TourRequestAccess } from '@shared/tour-request-access';

export function useTourRequestAccess(kitchenId: number | undefined, chefUid: string | undefined) {
  const query = useQuery<TourRequestAccess>({
    queryKey: ['/api/viewings/request-access', chefUid, kitchenId],
    enabled: !!kitchenId && !!chefUid,
    queryFn: async () => {
      const response = await fetch(`/api/viewings/chef/kitchen/${kitchenId}/request-access`, {
        headers: await getAuthHeaders(), credentials: 'include',
      });
      if (!response.ok) throw new Error('Could not check your kitchen tours');
      const access = await response.json();
      if (typeof access?.canRequest !== 'boolean') throw new Error('Could not check your kitchen tours');
      return access;
    },
    staleTime: 0,
  });
  const tour = query.data?.tour;
  const boundary = tour?.kind === 'pending' ? Date.parse(tour.scheduledAt)
    : tour?.kind === 'confirmed' ? Date.parse(tour.scheduledAt) + tour.durationMinutes * 60_000 : undefined;
  const expiry = query.data?.authorization && !query.data.authorization.recovery
    ? Date.parse(query.data.authorization.expiresAt) : undefined;
  const nextBoundary = [boundary, expiry].filter((value): value is number => value !== undefined && value > Date.now())
    .sort((a, b) => a - b)[0];
  useTourClock(nextBoundary);
  useEffect(() => {
    // Keep the refetch scheduled when the clock rerenders at the boundary.
    const serverBoundary = [boundary, expiry].filter((value): value is number => value !== undefined).sort((a, b) => a - b)[0];
    if (serverBoundary === undefined) return;
    const timer = window.setTimeout(() => void query.refetch(), Math.min(Math.max(0, serverBoundary - Date.now()), 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [boundary, expiry, query.dataUpdatedAt, query.refetch]);
  const kind = tour?.kind === 'confirmed' && boundary !== undefined && boundary <= Date.now() ? 'ended' : tour?.kind;
  const expiredPermission = expiry !== undefined && expiry <= Date.now();
  return { ...query, data: query.data ? { ...query.data, canRequest: query.data.canRequest && !expiredPermission,
    tour: tour && kind ? { ...tour, kind } : null } : undefined };
}
