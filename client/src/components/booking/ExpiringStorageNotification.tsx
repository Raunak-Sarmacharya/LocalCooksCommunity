import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, Package, CalendarPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StorageExtensionDialog } from "./StorageExtensionDialog";
import { getAuthHeaders } from "@/lib/api";

interface ExpiringStorageBooking {
  id: number;
  storageListingId: number;
  startDate: string;
  endDate: string;
  status: string;
  totalPrice: number;
  serviceFee: number;
  storageName: string;
  storageType: string;
  kitchenName: string;
  basePrice: number;
  minimumBookingDuration: number;
  daysUntilExpiry: number;
  isExpired: boolean;
  isExpiringSoon: boolean;
}

export function ExpiringStorageNotification() {
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set());
  const [extendDialogBooking, setExtendDialogBooking] = useState<ExpiringStorageBooking | null>(null);

  const { data: expiringBookings, isLoading } = useQuery({
    queryKey: ['/api/chef/storage-bookings/expiring'],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/chef/storage-bookings/expiring?days=3', {
        headers,
      });
      if (!response.ok) {
        throw new Error('Failed to fetch expiring storage bookings');
      }
      return response.json() as Promise<ExpiringStorageBooking[]>;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 10 * 60 * 1000, // Refetch every 10 minutes
  });

  const visibleBookings = expiringBookings?.filter(
    (booking) => !dismissedIds.has(booking.id)
  ) || [];

  const handleDismiss = (id: number) => {
    setDismissedIds((prev) => {
      const newSet = new Set(prev);
      newSet.add(id);
      return newSet;
    });
  };

  if (isLoading || visibleBookings.length === 0) {
    return null;
  }

  return (
    <>
      <div className="space-y-3 mb-6">
        {visibleBookings.map((booking) => {
          const theme = booking.isExpired
            ? { border: 'border-red-200', bg: 'bg-red-50', text: 'text-red-900', muted: 'text-red-700', icon: 'text-red-600', btn: 'bg-red-600 hover:bg-red-700' }
            : booking.isExpiringSoon
            ? { border: 'border-amber-200', bg: 'bg-amber-50', text: 'text-amber-900', muted: 'text-amber-700', icon: 'text-amber-600', btn: 'bg-amber-600 hover:bg-amber-700' }
            : { border: 'border-blue-200', bg: 'bg-blue-50', text: 'text-blue-900', muted: 'text-blue-700', icon: 'text-blue-600', btn: 'bg-blue-600 hover:bg-blue-700' };

          return (
            <div
              key={booking.id}
              className={`rounded-lg border ${theme.border} ${theme.bg} p-4`}
            >
              <div className="flex items-start gap-3">
                {booking.isExpired ? (
                  <AlertTriangle className={`h-5 w-5 mt-0.5 shrink-0 ${theme.icon}`} />
                ) : (
                  <Package className={`h-5 w-5 mt-0.5 shrink-0 ${theme.icon}`} />
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className={`text-sm font-semibold ${theme.text}`}>
                        {booking.isExpired
                          ? 'Storage Expired'
                          : booking.daysUntilExpiry === 0
                          ? 'Storage Expires Today'
                          : booking.daysUntilExpiry === 1
                          ? 'Storage Expires Tomorrow'
                          : `Storage Expires in ${booking.daysUntilExpiry} Days`}
                      </h3>
                      <p className={`text-xs ${theme.muted} mt-1`}>
                        Extend your storage at <span className="font-medium">{booking.kitchenName}</span> to avoid losing your spot.
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className={`h-6 w-6 -mt-1 -mr-1 shrink-0 ${theme.muted} hover:${theme.text}`}
                      onClick={() => handleDismiss(booking.id)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs ${theme.muted}`}>
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{booking.storageName}</span>
                      <span className="px-1.5 py-0.5 rounded-full bg-white/60 border border-current/20 capitalize">
                        {booking.storageType}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span>Ends</span>
                      <span className="font-medium">
                        {format(new Date(booking.endDate), "MMM d, yyyy")}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span>${((booking.basePrice || 0) / 100).toFixed(2)}</span>
                      <span>/day</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 mt-4">
                    <Button
                      size="sm"
                      className={`${theme.btn} text-white`}
                      onClick={() => setExtendDialogBooking(booking)}
                    >
                      <CalendarPlus className="h-3.5 w-3.5 mr-1.5" />
                      Extend Storage
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {extendDialogBooking && (
        <StorageExtensionDialog
          booking={extendDialogBooking}
          open={!!extendDialogBooking}
          onOpenChange={(open) => {
            if (!open) setExtendDialogBooking(null);
          }}
          onSuccess={() => {
            setExtendDialogBooking(null);
          }}
        />
      )}
    </>
  );
}
