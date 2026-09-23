import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useKitchenBookings } from '@/hooks/use-kitchen-bookings';

/** Keep old booking links working while using the current hourly/daily flow. */
export default function LegacyKitchenBookingRedirect() {
  const [, navigate] = useLocation();
  const { kitchens, isLoadingKitchens } = useKitchenBookings();
  useEffect(() => {
    if (isLoadingKitchens) return;
    const query = new URLSearchParams(window.location.search);
    const kitchenId = Number(query.get('kitchenId'));
    const kitchen = kitchens.find((item: any) => item.id === kitchenId);
    const locationId = Number(query.get('locationId')) || kitchen?.locationId || (kitchen as any)?.location?.id || (kitchen as any)?.location_id;
    if (!Number.isSafeInteger(Number(locationId)) || Number(locationId) <= 0) {
      navigate('/dashboard?view=discover-kitchens', { replace: true });
      return;
    }
    navigate(`/book/${locationId}?${query.toString()}`, { replace: true });
  }, [isLoadingKitchens, kitchens, navigate]);
  return <div className="p-8 text-center text-sm text-muted-foreground">Opening kitchen booking…</div>;
}
