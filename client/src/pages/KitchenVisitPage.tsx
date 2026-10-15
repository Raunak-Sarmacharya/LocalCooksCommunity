import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useRoute, useSearch } from "wouter";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { apiGet } from "@/lib/api";
import ChefDashboardLayout from "@/layouts/ChefDashboardLayout";
import { useChefShellChrome } from "@/layouts/chef-shell-context";
import { KitchenCheckinTracker } from "@/components/booking/KitchenCheckinTracker";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function KitchenVisitPage() {
  const [, params] = useRoute("/booking/:id/visit");
  const [, navigate] = useLocation();
  const search = useSearch();
  const bookingId = Number(params?.id);
  const validId = Number.isSafeInteger(bookingId) && bookingId > 0;
  const selectedVisitId = Number(new URLSearchParams(search).get("visitId"));
  const { loading: authLoading } = useFirebaseAuth();
  const { t } = useTranslation("chef");
  const booking = useQuery<{ kitchen?: { name: string; imageUrl?: string | null; galleryImages?: string[] | null; photos?: string[] | null }; kitchenContact?: { phone?: string | null } | null; bookingDate: string; startTime: string; endTime: string }>({
    queryKey: [`/api/chef/bookings/${bookingId}/details`],
    queryFn: () => apiGet(`/chef/bookings/${bookingId}/details`),
    enabled: validId && !authLoading,
  });
  const onViewChange = useCallback((view: string) => navigate(`/dashboard?view=${view}`), [navigate]);
  const breadcrumbs = useMemo(() => [
    { label: t("shellMyBookings"), onClick: () => navigate("/dashboard?view=bookings"), navId: "bookings" as const },
    { label: t("bdBookingDetails"), onClick: () => navigate(`/booking/${bookingId}`) },
    { label: t("kciVisitActions", "Visit actions") },
  ], [t, navigate, bookingId]);
  const inShell = useChefShellChrome({ activeView: "bookings", onViewChange, breadcrumbs });
  const body = <div className="max-w-4xl mx-auto space-y-5">
    <Link href={validId ? `/booking/${bookingId}` : "/dashboard?view=bookings"} className="inline-flex items-center gap-2 text-sm font-medium hover:underline">
      <ArrowLeft className="h-4 w-4" />{t("kciBackToBooking", "Back to booking")}
    </Link>
    {booking.isRefetchError && booking.data && <div role="alert" className="rounded-xl border p-5 space-y-3">
      <p>{booking.error instanceof Error ? booking.error.message : t("bdErrNotFound")}</p>
      <Button variant="outline" onClick={() => void booking.refetch()}>{t("kciRetryVisit", "Retry visit details")}</Button>
    </div>}
    {!validId || (booking.isError && !booking.data) ? <div role="alert" className="rounded-xl border p-5 space-y-3">
      <p>{booking.error instanceof Error ? booking.error.message : t("bdErrNotFound")}</p>
      {validId && <Button variant="outline" onClick={() => void booking.refetch()}>{t("kciRetryVisit", "Retry visit details")}</Button>}
    </div> : authLoading || !booking.data ? <Skeleton className="h-40 rounded-2xl" aria-label={t("kciLoadingVisit", "Loading visit")} /> :
      <KitchenCheckinTracker key={bookingId} bookingId={bookingId} kitchenName={booking.data.kitchen?.name}
        kitchenImageUrl={booking.data.kitchen?.imageUrl || booking.data.kitchen?.galleryImages?.[0] || booking.data.kitchen?.photos?.[0] || null}
        bookingDate={booking.data.bookingDate} startTime={booking.data.startTime} endTime={booking.data.endTime}
        initialVisitId={Number.isSafeInteger(selectedVisitId) && selectedVisitId > 0 ? selectedVisitId : null}
        kitchenPhone={booking.data.kitchenContact?.phone}
        // Stay on the visit page after arrival so the in-session panel shows at once; checkout returns to the booking.
        onSuccess={kind => { if (kind === "checkout") navigate(`/booking/${bookingId}`, { replace: true }) }} />}
  </div>;
  return inShell ? body : <ChefDashboardLayout activeView="bookings" onViewChange={onViewChange} breadcrumbs={breadcrumbs}>{body}</ChefDashboardLayout>;
}
