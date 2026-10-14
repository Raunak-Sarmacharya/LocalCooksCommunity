/**
 * TodaysKitchenBookings
 *
 * Manager view showing today's kitchen bookings with live check-in status.
 * Opens the booking or its focused inspection page for manager actions.
 * Mirrors PendingStorageCheckouts component pattern.
 */

import { useLocation } from "wouter"
import { useQuery } from "@tanstack/react-query"
import { CheckCircle, Clock, User, MoreHorizontal, Calendar, LogOut, XCircle, ShieldCheck, FileWarning,  } from "@/components/ui/manager-icons"
import { auth } from "@/lib/firebase"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { friendlyTimezoneName, formatInTimezone as format } from "@shared/timezone-utils"
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import { ct } from "@/i18n/chef-ns";
import { calendarDateForBookingTime } from '@shared/operating-hours';
import i18n from "@/i18n";
import { formatTime as formatClockTime } from "@/lib/formatters";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TodayBooking {
  id: number
  visitId?: number
  visitBlockIndex?: number
  referenceCode?: string | null
  chefId: number
  kitchenId: number
  bookingDate: string
  startTime: string
  endTime: string
  operatingWindowStartTime?: string | null
  status: string
  operationsComplete?: boolean
  checkinStatus: string | null
  checkedInAt: string | null
  checkedInMethod: string | null
  checkoutRequestedAt: string | null
  checkedOutAt: string | null
  noShowDetectedAt: string | null
  actualStartTime: string | null
  actualEndTime: string | null
  // Photos + notes uploaded by chef (verification evidence)
  checkinPhotoUrls: string[] | null
  checkoutPhotoUrls: string[] | null
  checkinNotes: string | null
  checkoutNotes: string | null
  checkoutManagerMessage?: string | null
  checkinChecklistItems: Array<{ id: string; label: string; checked: boolean }> | null
  checkoutChecklistItems: Array<{ id: string; label: string; checked: boolean }> | null
  kitchenName: string | null
  timezone?: string | null
  locationName: string | null
  chefEmail: string | null
  chefName?: string | null
}

interface TodayResponse {
  bookings: TodayBooking[]
  settings: {
    noShowGraceMinutes: number
    checkoutReviewWindowMinutes: number
    checkinWindowMinutesBefore: number
  }
}

// ─── Auth Helper ──────────────────────────────────────────────────────────────

async function getAuthHeaders(): Promise<HeadersInit> {
  const currentUser = auth.currentUser
  if (currentUser) {
    const token = await currentUser.getIdToken()
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    }
  }
  return { "Content-Type": "application/json" }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(t: string): string {
  return formatClockTime(t, i18n.language)
}

function getCheckinBadge(checkinStatus: string | null) {
  switch (checkinStatus) {
    case "checked_in":
      return (
        <Badge className="bg-green-600 hover:bg-green-700 text-white">
          <CheckCircle className="h-3 w-3 mr-1" />{mt("checkedIn")}</Badge>
      )
    case "checkout_requested":
      return (
        <Badge variant="info">
          <LogOut className="h-3 w-3 mr-1" />{mt("checkoutRequested")}</Badge>
      )
    case "checked_out":
      return (
        <Badge className="bg-blue-600 hover:bg-blue-700 text-white">
          <ShieldCheck className="h-3 w-3 mr-1" />{mt("checkedOut")}</Badge>
      )
    case "no_show":
      return (
        <Badge variant="destructive">
          <XCircle className="h-3 w-3 mr-1" />{mt("noShow2")}</Badge>
      )
    case "checkout_claim_filed":
      return (
        <Badge variant="warning">
          <FileWarning className="h-3 w-3 mr-1" />{mt("claimFiled")}</Badge>
      )
    default:
      return (
        <Badge variant="outline">
          <Clock className="h-3 w-3 mr-1" />{mt("notCheckedIn")}</Badge>
      )
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function TodaysKitchenBookings() {
  
  const [, navigate] = useLocation()

  // Fetch upcoming bookings
  const { data, isLoading, error, refetch } = useQuery<TodayResponse>({
    queryKey: ["/api/manager/bookings/upcoming"],
    queryFn: async () => {
      const headers = await getAuthHeaders()
      const response = await fetch("/api/manager/bookings/upcoming", {
        headers,
        credentials: "include",
      })
      if (!response.ok) throw new Error(mt("failedToFetchToday"))
      return response.json()
    },
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  })

  const rawBookings = data?.bookings ?? []

  // Sort upcoming bookings to match viewings priority
  const bookings = [...rawBookings].sort((a, b) => {
    const statusPriority: Record<string, number> = {
      'pending': 1,
      'confirmed': 2,
    };
    const pA = statusPriority[a.status] || 99;
    const pB = statusPriority[b.status] || 99;
    if (pA !== pB) return pA - pB;

    const startA = calendarDateForBookingTime(a.bookingDate.split('T')[0], a.startTime, a.operatingWindowStartTime);
    const startB = calendarDateForBookingTime(b.bookingDate.split('T')[0], b.startTime, b.operatingWindowStartTime);
    return `${startA}T${a.startTime}`.localeCompare(`${startB}T${b.startTime}`);
  });

  // Fetch manager's viewings
  const { data: viewingsData, isLoading: isLoadingViewings } = useQuery<any[]>({
    queryKey: ["/api/viewings/manager"],
    queryFn: async () => {
      const headers = await getAuthHeaders()
      const response = await fetch("/api/viewings/manager", {
        headers,
        credentials: "include",
      })
      if (!response.ok) throw new Error(tt("failedToFetchViewings"))
      return response.json()
    },
    refetchInterval: 30000,
  })

  // Filter for upcoming viewings (today and future)
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const upcomingViewings = (viewingsData || [])
    .filter((v: any) => {
      if (!v.viewing?.scheduledAt) return false;
      const status = v.viewing?.status;
      if (status === 'completed' || status === 'cancelled') return false;
      return new Date(v.viewing.scheduledAt) >= now;
    })
    .sort((a: any, b: any) => {
      const statusPriority: Record<string, number> = {
        'pending': 1,
        'confirmed': 2,
        'completed': 3,
        'cancelled': 4
      };

      const pA = statusPriority[a.viewing?.status] || 99;
      const pB = statusPriority[b.viewing?.status] || 99;

      if (pA !== pB) {
        return pA - pB;
      }

      return new Date(a.viewing?.scheduledAt).getTime() - new Date(b.viewing?.scheduledAt).getTime();
    });

  const openAction = (booking: TodayBooking, mode: 'view' | 'clear-checkout' | 'file-claim') => {
    navigate(mode === 'view' ? `/manager/booking/${booking.id}`
      : `/manager/booking/${booking.id}/inspection${booking.visitId ? `?visitId=${booking.visitId}` : ''}`)
  }

  // Stats
  const checkedInCount = bookings.filter(
    (b) => b.checkinStatus === "checked_in"
  ).length
  const checkoutPendingCount = bookings.filter(
    (b) => b.checkinStatus === "checkout_requested"
  ).length
  const noShowCount = bookings.filter(
    (b) => b.checkinStatus === "no_show"
  ).length
  const notCheckedInCount = bookings.filter(
    (b) => !b.checkinStatus || b.checkinStatus === "not_checked_in"
  ).length

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Upcoming Bookings */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{mt("upcomingKitchenBookings")}</CardTitle>
              <CardDescription>{mt("liveCheckInCheckoutStatusAndUpcomingBookings")}</CardDescription>
            </div>
          </div>

          {/* Stats Row */}
          {bookings.length > 0 && (
            <div className="flex gap-3 mt-3 flex-wrap">
              <Badge variant="outline" className="gap-1">
                <Clock className="h-3 w-3" />
                {mt("countAwaiting", { count: notCheckedInCount })}
              </Badge>
              <Badge className="bg-green-600 text-white gap-1">
                <CheckCircle className="h-3 w-3" />
                {mt("countActive", { count: checkedInCount })}
              </Badge>
              {checkoutPendingCount > 0 && (
                <Badge variant="info" className="gap-1">
                  <LogOut className="h-3 w-3" />
                  {mt("countCheckoutPending", { count: checkoutPendingCount })}
                </Badge>
              )}
              {noShowCount > 0 && (
                <Badge variant="destructive" className="gap-1">
                  <XCircle className="h-3 w-3" />
                  {mt("countNoShow", { count: noShowCount })}
                </Badge>
              )}
            </div>
          )}
        </CardHeader>

        <CardContent>
          {error ? <div role="alert" className="space-y-2 py-3 text-sm"><p>{mt("failedToFetchToday")}</p><Button variant="outline" onClick={() => void refetch()}>{ct("fixRetry")}</Button></div> : isLoading ? (
            <div className="space-y-3 py-3" role="status" aria-label={mt("loadingBookings")}>
              {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-14 w-full rounded-lg" />)}
            </div>
          ) : bookings.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Calendar className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">{mt("noUpcomingBookings")}</p>
            </div>
          ) : (
            <>
            <div className="space-y-3 md:hidden">
              {bookings.map((booking) => <article key={`${booking.id}-${booking.visitId ?? 'single'}`} className="min-w-0 space-y-3 rounded-xl border bg-card p-4">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0"><p className="break-words font-semibold">{booking.kitchenName}</p><p className="text-sm text-muted-foreground">{format(new Date(`${booking.bookingDate.slice(0, 10)}T12:00:00Z`), "MMM d, yyyy")} · {formatTime(booking.startTime)} – {formatTime(booking.endTime)}</p></div>
                  {booking.status === 'pending' ? <Badge variant="outline">{mt("awaitingApproval")}</Badge> : getCheckinBadge(booking.checkinStatus)}
                </div>
                {booking.timezone && <p className="text-xs text-muted-foreground">{friendlyTimezoneName(booking.timezone, i18n.language)}</p>}
                <p className="break-words text-sm">{booking.chefName || booking.chefEmail || `Chef #${booking.chefId}`}</p>
                {booking.visitId && <p className="text-xs text-muted-foreground">{ct('inspectVisit', { number: (booking.visitBlockIndex ?? 0) + 1 })}</p>}
                {booking.referenceCode && <p className="break-all font-mono text-xs text-muted-foreground">{booking.referenceCode}</p>}
                <div className="flex flex-wrap gap-2 border-t pt-3">
                  <Button variant="outline" size="sm" onClick={() => openAction(booking, "view")}>{mt("viewDetails")}</Button>
                  {booking.checkinStatus === "checkout_requested" && <>
                    <Button variant="outline" size="sm" onClick={() => openAction(booking, "clear-checkout")}>{ct('fixInspection')}</Button>
                  </>}
                </div>
              </article>)}
            </div>
            <div className="hidden rounded-md border overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap text-xs sm:text-sm">{mt("time")}</TableHead>
                    <TableHead className="whitespace-nowrap text-xs sm:text-sm">{mt("kitchen")}</TableHead>
                    <TableHead className="whitespace-nowrap text-xs sm:text-sm">{mt("chef")}</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookings.map((booking) => (
                    <TableRow
                      key={`${booking.id}-${booking.visitId ?? 'single'}`}
                      className={cn(
                        booking.checkinStatus === "no_show" && "bg-red-50/50",
                        booking.checkinStatus === "checkout_requested" &&
                          "bg-blue-50/50"
                      )}
                    >
                      <TableCell className="font-mono text-xs sm:text-sm whitespace-nowrap">
                        <div>{format(new Date(`${booking.bookingDate.slice(0, 10)}T12:00:00Z`), "MMM d, yyyy")}</div>
                        <div className="text-muted-foreground mb-1">
                          {formatTime(booking.startTime)} – {formatTime(booking.endTime)}
                        </div>
                        {booking.timezone && <p className="text-xs text-muted-foreground">{friendlyTimezoneName(booking.timezone, i18n.language)}</p>}
                        {booking.visitId && (
                          <div className="text-xs text-muted-foreground">{ct('inspectVisit', { number: (booking.visitBlockIndex ?? 0) + 1 })}</div>
                        )}
                        <div className="whitespace-nowrap">
                          {booking.status === 'pending' ? (
                            <Badge variant="outline" className="text-muted-foreground">{mt("awaitingApproval")}</Badge>
                          ) : (
                            getCheckinBadge(booking.checkinStatus)
                          )}
                          {booking.operationsComplete && <p className="text-xs text-muted-foreground whitespace-normal">{ct('bookingAttendanceEnded')}</p>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs sm:text-sm font-medium whitespace-nowrap">
                          {booking.kitchenName}
                        </div>
                        {booking.referenceCode && (
                          <div className="text-xs text-muted-foreground font-mono">
                          {booking.referenceCode}
                        </div>
                      )}
                      {booking.status === 'pending' && (
                        <Badge variant="outline" className="mt-1 text-purple-800 border-purple-300 bg-purple-100">
                          {mt("awaitingApproval")}
                        </Badge>
                      )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-xs sm:text-sm whitespace-nowrap">
                          <User className="h-3 w-3 text-muted-foreground" />
                          {booking.chefName || booking.chefEmail || `Chef #${booking.chefId}`}
                        </div>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => openAction(booking, "view")}
                            >
                              <Calendar className="h-4 w-4 mr-2" />{mt("viewDetails")}</DropdownMenuItem>

                            {booking.checkinStatus ===
                              "checkout_requested" && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() =>
                                    openAction(booking, "clear-checkout")
                                  }
                                >
                                  <ShieldCheck className="h-4 w-4 mr-2" />
                                  {ct('fixInspection')}
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Upcoming Viewings */}
      <Card>
        <CardHeader>
          <CardTitle>{mt("upcomingKitchenViewings")}</CardTitle>
          <CardDescription>{mt("scheduledViewingsForYourKitchens")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="min-w-0">
            {isLoadingViewings ? (
              <div className="space-y-3 py-3" role="status" aria-label={mt("loadingViewings")}>
                {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-14 w-full rounded-lg" />)}
              </div>
            ) : upcomingViewings.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground bg-gray-50/50 rounded-lg border border-dashed">
                <Calendar className="w-10 h-10 mx-auto text-gray-400 mb-2 opacity-50" />
                <p className="text-sm">{mt("noUpcomingViewingsScheduled")}</p>
              </div>
            ) : (
              <>
              <div className="space-y-3 md:hidden">
                {upcomingViewings.map((viewingRec: any) => {
                  const start = new Date(viewingRec.viewing.scheduledAt);
                  return <article key={viewingRec.viewing.id} className="min-w-0 rounded-xl border bg-card p-4">
                    <p className="break-words font-semibold">{viewingRec.kitchenName}</p>
                    {viewingRec.locationName && <p className="text-xs text-muted-foreground">{viewingRec.locationName}</p>}
                    <p className="mt-1 text-sm text-muted-foreground">{format(start, "MMM d, yyyy")} · {start.toLocaleTimeString([], { timeZone: 'America/St_Johns', hour: "2-digit", minute: "2-digit" })} – {new Date(start.getTime() + viewingRec.viewing.durationMinutes * 60000).toLocaleTimeString([], { timeZone: 'America/St_Johns', hour: "2-digit", minute: "2-digit" })}</p>
                    <p className="mt-2 break-words text-sm">{viewingRec.chefName || viewingRec.chefUsername?.split('@')[0] || `Chef #${viewingRec.viewing.chefId}`}</p>
                    <Badge className="mt-3" variant={viewingRec.viewing.status === "pending" ? "outline" : "secondary"}>{viewingRec.viewing.status}</Badge>
                  </article>;
                })}
              </div>
              <div className="hidden overflow-x-auto md:block"><Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{mt("time")}</TableHead>
                    <TableHead>{mt("kitchenLocation")}</TableHead>
                    <TableHead>{mt("chef")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upcomingViewings.map((viewingRec: any) => {
                    const d = new Date(viewingRec.viewing.scheduledAt);
                    const isToday = format(d, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
                    const dEnd = new Date(d.getTime() + viewingRec.viewing.durationMinutes * 60000);

                    return (
                      <TableRow key={`viewing-${viewingRec.viewing.id}`}>
                        <TableCell className="font-mono text-xs sm:text-sm whitespace-nowrap">
                          <div>{format(d, "MMM d, yyyy")}</div>
                          <div className="text-muted-foreground mb-1">{d.toLocaleTimeString([], { timeZone: 'America/St_Johns',hour: '2-digit', minute:'2-digit'})} – {dEnd.toLocaleTimeString([], { timeZone: 'America/St_Johns',hour: '2-digit', minute:'2-digit'})}</div>
                          <div className="whitespace-nowrap">
                            <Badge
                              variant={
                                viewingRec.viewing.status === 'pending' ? "outline" :
                                viewingRec.viewing.status === 'confirmed' ? "default" :
                                "secondary"
                              }
                              className={
                                viewingRec.viewing.status === 'pending' ? "text-purple-800 border-purple-300 bg-purple-100" :
                                viewingRec.viewing.status === 'confirmed' ? "bg-success text-success-foreground hover:bg-success/90" :
                                ""
                              }
                            >
                              {viewingRec.viewing.status.toUpperCase()}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-xs sm:text-sm font-medium whitespace-nowrap">
                            {viewingRec.kitchenName}
                          </div>
                          {viewingRec.locationName && (
                            <div className="text-xs text-muted-foreground font-mono">
                              {viewingRec.locationName}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-xs sm:text-sm whitespace-nowrap">
                            <User className="h-3 w-3 text-muted-foreground" />
                            {viewingRec.chefName || viewingRec.chefUsername?.split('@')[0] || `Chef #${viewingRec.viewing.chefId}`}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table></div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

    </div>
  )
}
