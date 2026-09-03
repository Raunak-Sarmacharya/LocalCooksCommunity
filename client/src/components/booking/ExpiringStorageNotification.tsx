import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, Package, CalendarPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StorageExtensionDialog } from "./StorageExtensionDialog";
import { getAuthHeaders } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { bt } from "@/i18n/booking-ns";

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
  const { t } = useTranslation("chef");
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
        throw new Error(bt("failedToFetchExpiringStorage"));
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
          const badgeVariant = booking.isExpired
            ? "destructive" as const
            : booking.isExpiringSoon
            ? "warning" as const
            : "outline" as const;

          const title = booking.isExpired
            ? t('sbStorageExpired')
            : booking.daysUntilExpiry === 0
            ? t('sbExpiresToday')
            : booking.daysUntilExpiry === 1
            ? t('sbExpiresTomorrow')
            : t('sbExpiresInDays', { count: booking.daysUntilExpiry });

          return (
            <div
              key={booking.id}
              className={cn(
                "rounded-lg border p-4",
                booking.isExpired && "border-destructive/30"
              )}
            >
              <div className="flex items-start gap-3">
                {booking.isExpired ? (
                  <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0 text-destructive" />
                ) : (
                  <Package className="h-5 w-5 mt-0.5 shrink-0 text-muted-foreground" />
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold">{title}</h3>
                        <Badge variant={badgeVariant} className="text-xs">
                          {booking.isExpired ? t('sbBadgeExpired') : booking.daysUntilExpiry === 0 ? t('sbBadgeToday') : t('sbBadgeDaysLeft', { count: booking.daysUntilExpiry })}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1"
                        dangerouslySetInnerHTML={{ __html: t('sbExtendBody', { kitchen: booking.kitchenName }) }}
                      />
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 -mt-1 -mr-1 shrink-0 text-muted-foreground"
                      onClick={() => handleDismiss(booking.id)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{booking.storageName}</span>
                      <Badge variant="outline" className="text-[10px] capitalize px-1.5 py-0">
                        {booking.storageType}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span>{t("sbEnds")}</span>
                      <span className="font-medium">
                        {format(new Date(booking.endDate), "MMM d, yyyy")}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span>${((booking.basePrice || 0) / 100).toFixed(2)}</span>
                      <span>{t("sbPerDay")}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 mt-4">
                    <Button
                      size="sm"
                      onClick={() => setExtendDialogBooking(booking)}
                    >
                      <CalendarPlus className="h-3.5 w-3.5 mr-1.5" />
                      {t("sbExtendStorage")}
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
