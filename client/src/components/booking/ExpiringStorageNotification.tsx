import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, differenceInDays, startOfToday } from "date-fns";
import { AlertTriangle, Package, CalendarPlus, X, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StorageExtensionDialog } from "./StorageExtensionDialog";

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

async function getAuthHeaders(): Promise<HeadersInit> {
  const token = localStorage.getItem('firebaseToken');
  return {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` }),
  };
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
        {visibleBookings.map((booking) => (
          <Card
            key={booking.id}
            className={`border-l-4 ${
              booking.isExpired
                ? 'border-l-red-500 bg-red-50'
                : booking.isExpiringSoon
                ? 'border-l-amber-500 bg-amber-50'
                : 'border-l-blue-500 bg-blue-50'
            }`}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1">
                  <div className={`p-2 rounded-full ${
                    booking.isExpired
                      ? 'bg-red-100'
                      : booking.isExpiringSoon
                      ? 'bg-amber-100'
                      : 'bg-blue-100'
                  }`}>
                    {booking.isExpired ? (
                      <AlertTriangle className="h-5 w-5 text-red-600" />
                    ) : (
                      <Package className="h-5 w-5 text-amber-600" />
                    )}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className={`font-semibold text-sm ${
                        booking.isExpired ? 'text-red-900' : 'text-amber-900'
                      }`}>
                        {booking.isExpired
                          ? 'Storage Expired'
                          : booking.daysUntilExpiry === 0
                          ? 'Storage Expires Today'
                          : booking.daysUntilExpiry === 1
                          ? 'Storage Expires Tomorrow'
                          : `Storage Expires in ${booking.daysUntilExpiry} Days`}
                      </h4>
                    </div>
                    
                    <p className="text-sm text-gray-700 mb-2">
                      <span className="font-medium">{booking.storageName}</span>
                      {' '}at{' '}
                      <span className="font-medium">{booking.kitchenName}</span>
                    </p>
                    
                    <div className="flex items-center gap-4 text-xs text-gray-600">
                      <span className="capitalize">{booking.storageType}</span>
                      <span>•</span>
                      <span>
                        {booking.isExpired
                          ? `Expired ${format(new Date(booking.endDate), "MMM d, yyyy")}`
                          : `Expires ${format(new Date(booking.endDate), "MMM d, yyyy")}`}
                      </span>
                      <span>•</span>
                      <span>${booking.basePrice.toFixed(2)}/day</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button
                    size="sm"
                    className={`${
                      booking.isExpired
                        ? 'bg-red-600 hover:bg-red-700'
                        : 'bg-amber-600 hover:bg-amber-700'
                    }`}
                    onClick={() => setExtendDialogBooking(booking)}
                  >
                    <CalendarPlus className="h-4 w-4 mr-1" />
                    Extend Now
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                  
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-gray-500 hover:text-gray-700"
                    onClick={() => handleDismiss(booking.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
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
