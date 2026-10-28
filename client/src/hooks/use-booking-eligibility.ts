import { useQuery } from '@tanstack/react-query';
import { auth } from '@/lib/firebase';

export type BookingEligibility = {
  canBook: boolean;
  status: string;
  message?: string;
  actionUrl?: string;
  document?: { key: string; label: string; expiry: string | null; reason?: 'missing' | 'rejected' | 'pending' | 'needs_expiry' } | null;
};

/** Reads whether this chef may start a NEW booking at the location. Unknown (loading, failed, odd payload) never blocks: the server still decides. */
export function readBookingEligibility(data: unknown): BookingEligibility | null {
  const body = data as { hasApplication?: boolean; bookingEligibility?: BookingEligibility; canBook?: boolean } | null;
  if (!body || Array.isArray(body) || typeof body !== 'object') return null;
  if (body.bookingEligibility && typeof body.bookingEligibility.canBook === 'boolean') return body.bookingEligibility;
  if (body.hasApplication === false) return { canBook: false, status: 'application_required' };
  return null;
}

export function useBookingEligibility(locationId: number | null | undefined) {
  const query = useQuery<BookingEligibility | null>({
    queryKey: ['booking-eligibility', locationId],
    enabled: !!locationId,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: 1,
    queryFn: async () => {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/firebase/chef/kitchen-applications/location/${locationId}`, { credentials: 'include', headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) return null;
      return readBookingEligibility(await response.json().catch(() => null));
    },
  });
  return { eligibility: query.data ?? null, isLoading: query.isLoading };
}
