/**
 * TodaysKitchenBookings
 *
 * Manager view showing today's kitchen bookings with live check-in status.
 * Allows managers to: confirm check-in, clear checkout, file claims.
 * Mirrors PendingStorageCheckouts component pattern.
 */

import { useState, useCallback } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { CheckCircle, Clock, User, Loader2, MoreHorizontal, Calendar, LogIn, LogOut, XCircle, ShieldCheck, FileWarning,  Camera, Upload, X,  } from "@/components/ui/manager-icons"
import { toast } from "sonner"
import { auth } from "@/lib/firebase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { CurrencyInput } from "@/components/ui/currency-input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AppDialogContent } from "@/components/ui/app-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { formatInTimezone as format } from "@shared/timezone-utils"
import { useSessionFileUpload } from "@/hooks/useSessionFileUpload"
import { getR2ProxyUrl } from "@/utils/r2-url-helper"
import { SmartImage } from "@/components/ui/smart-image";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import { ct } from "@/i18n/chef-ns";
import { calendarDateForBookingTime } from '@shared/operating-hours';

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
  try {
    const [h, m] = t.split(":")
    const hour = parseInt(h)
    const ampm = hour >= 12 ? "PM" : "AM"
    const displayHour = hour % 12 || 12
    return `${displayHour}:${m} ${ampm}`
  } catch {
    return t
  }
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
  
  const queryClient = useQueryClient()
  const [selectedBooking, setSelectedBooking] = useState<TodayBooking | null>(
    null
  )
  const [actionMode, setActionMode] = useState<
    "view" | "clear-checkout" | "file-claim"
  >("view")
  const [notes, setNotes] = useState("")
  const [claimTitle, setClaimTitle] = useState("")
  const [claimDescription, setClaimDescription] = useState("")
  const [claimAmount, setClaimAmount] = useState("")
  const [evidencePhotos, setEvidencePhotos] = useState<string[]>([])

  const { uploadFile: uploadEvidenceFile, isUploading: isUploadingEvidence, uploadProgress: evidenceUploadProgress } = useSessionFileUpload({
    maxSize: 4.5 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
    onSuccess: (response) => {
      setEvidencePhotos(prev => [...prev, response.url])
    },
    onError: (error) => {
      toast.error(error)
    },
  })

  const handleEvidencePhotoUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (evidencePhotos.length >= 10) {
        toast.error(tt("maximumPhotosAllowed", { count: 10 }))
        return
      }
      uploadEvidenceFile(file, "damage-claims")
      e.target.value = ''
    }
  }, [uploadEvidenceFile, evidencePhotos.length])

  // Fetch upcoming bookings
  const { data, isLoading, refetch } = useQuery<TodayResponse>({
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

  // Clear checkout mutation
  const clearCheckoutMutation = useMutation({
    mutationFn: async ({
      bookingId,
      visitId,
      managerNotes,
    }: {
      bookingId: number
      visitId?: number
      managerNotes?: string
    }) => {
      const headers = await getAuthHeaders()
      const response = await fetch(
        `/api/manager/bookings/${bookingId}/clear-kitchen-checkout`,
        {
          method: "POST",
          headers,
          credentials: "include",
          body: JSON.stringify({ sharedManagerMessage: managerNotes, visitId }),
        }
      )
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || "Failed to clear checkout")
      }
      return response.json()
    },
    onSuccess: () => {
      toast.success(tt("checkoutClearedNoIssues"))
      queryClient.invalidateQueries({
        queryKey: ["/api/manager/bookings/today"],
      })
      closeDialog()
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  // File claim mutation
  const fileClaimMutation = useMutation({
    mutationFn: async ({
      bookingId,
      visitId,
      claimData,
    }: {
      bookingId: number
      visitId?: number
      claimData: {
        claimTitle: string
        claimDescription: string
        claimedAmountCents: number
        managerNotes?: string
      }
    }) => {
      const headers = await getAuthHeaders()
      const response = await fetch(
        `/api/manager/bookings/${bookingId}/kitchen-checkout-claim`,
        {
          method: "POST",
          headers,
          credentials: "include",
          body: JSON.stringify({ ...claimData, managerNotes: undefined, sharedManagerMessage: claimData.managerNotes, visitId }),
        }
      )
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || "Failed to file claim")
      }
      return response.json()
    },
    onSuccess: () => {
      toast.success(tt("damageClaimFiled"))
      queryClient.invalidateQueries({
        queryKey: ["/api/manager/bookings/today"],
      })
      closeDialog()
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const closeDialog = () => {
    setSelectedBooking(null)
    setActionMode("view")
    setNotes("")
    setClaimTitle("")
    setClaimDescription("")
    setClaimAmount("")
    setEvidencePhotos([])
  }

  const openAction = (
    booking: TodayBooking,
    mode: typeof actionMode
  ) => {
    setSelectedBooking(booking)
    setActionMode(mode)
    setNotes("")
    setClaimTitle("")
    setClaimDescription("")
    setClaimAmount("")
    setEvidencePhotos([])
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
          {isLoading ? (
            <div className="space-y-3 py-3" role="status" aria-label="Loading bookings">
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
                <p className="break-words text-sm">{booking.chefName || booking.chefEmail || `Chef #${booking.chefId}`}</p>
                {booking.visitId && <p className="text-xs text-muted-foreground">Visit {(booking.visitBlockIndex ?? 0) + 1}</p>}
                {booking.referenceCode && <p className="break-all font-mono text-xs text-muted-foreground">{booking.referenceCode}</p>}
                <div className="flex flex-wrap gap-2 border-t pt-3">
                  <Button variant="outline" size="sm" onClick={() => openAction(booking, "view")}>{mt("viewDetails")}</Button>
                  {booking.checkinStatus === "checkout_requested" && <>
                    <Button variant="outline" size="sm" onClick={() => openAction(booking, "clear-checkout")}>{mt("clearNoIssues")}</Button>
                    <Button variant="outline" size="sm" onClick={() => openAction(booking, "file-claim")}>{mt("fileDamageClaim")}</Button>
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
                        {booking.visitId && (
                          <div className="text-xs text-muted-foreground">Visit {(booking.visitBlockIndex ?? 0) + 1}</div>
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
                          PENDING
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
                                  {mt("clearNoIssues")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() =>
                                    openAction(booking, "file-claim")
                                  }
                                  className="text-amber-600 focus:text-amber-700"
                                >
                                  <FileWarning className="h-4 w-4 mr-2" />{mt("fileDamageClaim")}</DropdownMenuItem>
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

      {/* Action Dialog */}
      <Dialog
        open={selectedBooking !== null}
        onOpenChange={(open) => !open && closeDialog()}
      >
        <AppDialogContent className="sm:max-w-md">
          {selectedBooking && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {actionMode === "clear-checkout" && mt("clearCheckout")}
                  {actionMode === "file-claim" && mt("fileDamageClaim")}
                  {actionMode === "view" && mt("bookingDetailsTitle")}
                </DialogTitle>
                <DialogDescription>
                  {selectedBooking.kitchenName} ·{" "}
                  {formatTime(selectedBooking.startTime)} –{" "}
                  {formatTime(selectedBooking.endTime)}
                  {selectedBooking.visitId && ` · Visit ${(selectedBooking.visitBlockIndex ?? 0) + 1}`}
                  {selectedBooking.referenceCode &&
                    ` · ${selectedBooking.referenceCode}`}
                </DialogDescription>
              </DialogHeader>

              <div className="py-4 space-y-4">
                {/* Common booking info */}
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{mt("chef")}</span>
                    <span>
                      {selectedBooking.chefEmail ||
                        `Chef #${selectedBooking.chefId}`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{mt("status")}</span>
                    {getCheckinBadge(selectedBooking.checkinStatus)}
                  </div>
                  {selectedBooking.checkedInAt && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{mt("checkedIn")}</span>
                      <span className="text-xs">
                        {format(
                          new Date(selectedBooking.checkedInAt),
                          "h:mm a"
                        )}
                        {selectedBooking.checkedInMethod &&
                          ` (${selectedBooking.checkedInMethod})`}
                      </span>
                    </div>
                  )}
                  {selectedBooking.checkoutRequestedAt && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{mt("checkoutRequested")}</span>
                      <span className="text-xs">
                        {format(
                          new Date(selectedBooking.checkoutRequestedAt),
                          "h:mm a"
                        )}
                      </span>
                    </div>
                  )}
                </div>

                {/* Chef's Check-In / Check-Out Evidence (photos + notes) */}
                {((selectedBooking.checkinPhotoUrls && selectedBooking.checkinPhotoUrls.length > 0) ||
                  (selectedBooking.checkoutPhotoUrls && selectedBooking.checkoutPhotoUrls.length > 0) ||
                  selectedBooking.checkinNotes ||
                  selectedBooking.checkoutNotes) && (
                  <>
                    <Separator />
                    <div className="space-y-3">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{mt("chefSVerification")}</p>

                      {/* Check-in section */}
                      {(selectedBooking.checkinPhotoUrls?.length ||
                        selectedBooking.checkinNotes) && (
                        <div className="rounded-lg border bg-green-50/40 border-green-200 p-3 space-y-2">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-green-800">
                            <LogIn className="h-3 w-3" />{mt("checkIn2")}</div>
                          {selectedBooking.checkinNotes && (
                            <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                              {selectedBooking.checkinNotes}
                            </p>
                          )}
                          {selectedBooking.checkinChecklistItems && selectedBooking.checkinChecklistItems.length > 0 && (
                            <div className="space-y-1 mt-1">
                              <p className="text-[11px] text-green-700 font-medium">{mt("checklistItemsConfirmed")}</p>
                              {selectedBooking.checkinChecklistItems.map((item, index) => (
                                <div key={item.id} className="flex items-center gap-1.5">
                                  <Checkbox checked={item.checked} disabled className="pointer-events-none h-3 w-3" />
                                  <span className="tabular-nums text-[11px] font-medium text-muted-foreground">{index + 1}.</span>
                                  <span className={cn("text-[11px]", item.checked ? "text-green-700" : "text-red-600 line-through")}>{item.label}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {selectedBooking.checkinPhotoUrls &&
                            selectedBooking.checkinPhotoUrls.length > 0 && (
                              <div className="grid grid-cols-3 gap-2">
                                {selectedBooking.checkinPhotoUrls.map((url, i) => {
                                  const proxied = getR2ProxyUrl(url)
                                  return (
                                    <a
                                      key={`ci-${i}`}
                                      href={proxied}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="block"
                                    >
                                      <SmartImage
                                        src={proxied}
                                        alt={`Check-in photo ${i + 1}`}
                                        className="w-full h-20 object-cover rounded-md border hover:opacity-80 transition-opacity"
                                        onError={(e) => {
                                          ;(e.currentTarget as HTMLImageElement).style.opacity = "0.3"
                                        }}
                                      />
                                    </a>
                                  )
                                })}
                              </div>
                            )}
                        </div>
                      )}

                      {/* Checkout section */}
                      {(selectedBooking.checkoutPhotoUrls?.length ||
                        selectedBooking.checkoutNotes) && (
                        <div className="rounded-lg border bg-blue-50/40 border-blue-200 p-3 space-y-2">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-blue-800">
                            <LogOut className="h-3 w-3" />{mt("checkOut2")}</div>
                          {selectedBooking.checkoutNotes && (
                            <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                              {selectedBooking.checkoutNotes}
                            </p>
                          )}
                          {selectedBooking.checkoutChecklistItems && selectedBooking.checkoutChecklistItems.length > 0 && (
                            <div className="space-y-1 mt-1">
                              <p className="text-[11px] text-blue-700 font-medium">{mt("checklistItemsConfirmed")}</p>
                              {selectedBooking.checkoutChecklistItems.map((item, index) => (
                                <div key={item.id} className="flex items-center gap-1.5">
                                  <Checkbox checked={item.checked} disabled className="pointer-events-none h-3 w-3" />
                                  <span className="tabular-nums text-[11px] font-medium text-muted-foreground">{index + 1}.</span>
                                  <span className={cn("text-[11px]", item.checked ? "text-blue-700" : "text-red-600 line-through")}>{item.label}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {selectedBooking.checkoutPhotoUrls &&
                            selectedBooking.checkoutPhotoUrls.length > 0 && (
                              <div className="grid grid-cols-3 gap-2">
                                {selectedBooking.checkoutPhotoUrls.map((url, i) => {
                                  const proxied = getR2ProxyUrl(url)
                                  return (
                                    <a
                                      key={`co-${i}`}
                                      href={proxied}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="block"
                                    >
                                      <SmartImage
                                        src={proxied}
                                        alt={`Check-out photo ${i + 1}`}
                                        className="w-full h-20 object-cover rounded-md border hover:opacity-80 transition-opacity"
                                        onError={(e) => {
                                          ;(e.currentTarget as HTMLImageElement).style.opacity = "0.3"
                                        }}
                                      />
                                    </a>
                                  )
                                })}
                              </div>
                            )}
                        </div>
                      )}
                    </div>
                  </>
                )}

                <Separator />

                {/* Clear Checkout */}
                {actionMode === "clear-checkout" && (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Confirm the kitchen is in good condition. This completes
                      the booking.
                    </p>
                    <div>
                      <Label>{ct('bookingAttendanceMessage')}</Label>
                      <Textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder={mt("eGKitchenInspectedAllClean")}
                        rows={2}
                      />
                    </div>
                  </div>
                )}

                {/* File Claim */}
                {actionMode === "file-claim" && (
                  <div className="space-y-3">
                    <p className="text-sm text-amber-700 bg-amber-50 rounded p-2">
                      Filing a claim will charge the chef&apos;s payment method for
                      damages or cleaning fees.
                    </p>
                    <div>
                      <Label>{mt("claimTitle")}</Label>
                      <Input
                        value={claimTitle}
                        onChange={(e) => setClaimTitle(e.target.value)}
                        placeholder={mt("eGDamagedStovetopBurner")}
                      />
                    </div>
                    <div>
                      <Label>{mt("description")}</Label>
                      <Textarea
                        value={claimDescription}
                        onChange={(e) => setClaimDescription(e.target.value)}
                        placeholder={mt("describeTheDamageOrCleaningIssue")}
                        rows={3}
                      />
                    </div>
                    <div>
                      <Label>{mt("claimAmountDollars")}</Label>
                      <CurrencyInput
                        value={claimAmount}
                        onValueChange={(val: string) => setClaimAmount(val)}
                        placeholder="0.00"
                      />
                    </div>

                    {/* Evidence Photo Upload */}
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        <Camera className="h-4 w-4" />
                        {mt("photoEvidenceRequired")}
                      </Label>
                      <p className="text-xs text-muted-foreground">{mt("uploadPhotosDocumentingTheDamageOrIssueAtLeastOnePhotoIsRequ")}</p>

                      {evidencePhotos.length > 0 && (
                        <div className="grid grid-cols-3 gap-2">
                          {evidencePhotos.map((url, i) => (
                            <div key={i} className="relative group">
                              <SmartImage
                                src={getR2ProxyUrl(url)}
                                alt={`Evidence photo ${i + 1}`}
                                className="w-full h-20 object-cover rounded-lg border"
                              />
                              <button
                                type="button"
                                onClick={() => setEvidencePhotos(prev => prev.filter((_, idx) => idx !== i))}
                                className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className={cn(
                        "border-2 border-dashed border-border rounded-lg p-4 hover:border-primary/50 transition-colors",
                        isUploadingEvidence && "opacity-50 cursor-not-allowed"
                      )}>
                        <input
                          type="file"
                          accept="image/jpeg,image/jpg,image/png,image/webp"
                          onChange={handleEvidencePhotoUpload}
                          className="hidden"
                          id="evidence-photo-upload"
                          disabled={isUploadingEvidence || evidencePhotos.length >= 10}
                        />
                        <label htmlFor="evidence-photo-upload" className="flex flex-col items-center justify-center cursor-pointer">
                          {isUploadingEvidence ? (
                            <>
                              <Upload className="h-6 w-6 text-primary mb-1" />
                              <span className="text-xs text-muted-foreground">{mt("uploadingPercent", { percent: Math.round(evidenceUploadProgress) })}</span>
                            </>
                          ) : (
                            <>
                              <Upload className="h-6 w-6 text-muted-foreground mb-1" />
                              <span className="text-xs text-muted-foreground">
                                {evidencePhotos.length === 0
                                  ? mt("clickToUploadEvidencePhotos")
                                  : mt("photosUploadedCount", { count: evidencePhotos.length })}
                              </span>
                            </>
                          )}
                        </label>
                      </div>
                    </div>

                    <div>
                      <Label>{ct('bookingAttendanceMessage')}</Label>
                      <Textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Message shared with the chef"
                        rows={2}
                      />
                    </div>
                  </div>
                )}
              </div>

              {actionMode !== "view" && (
                <DialogFooter className="gap-2 sm:gap-0">
                  <Button variant="ghost" onClick={closeDialog}>{mt("cancel")}</Button>

                  {actionMode === "clear-checkout" && (
                    <Button
                      onClick={() =>
                        clearCheckoutMutation.mutate({
                          bookingId: selectedBooking.id,
                          visitId: selectedBooking.visitId,
                          managerNotes: notes || undefined,
                        })
                      }
                      disabled={clearCheckoutMutation.isPending}
                    >
                      {clearCheckoutMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <ShieldCheck className="h-4 w-4 mr-2" />
                      )}
                      {mt("clearNoIssues")}
                    </Button>
                  )}

                  {actionMode === "file-claim" && (
                    <Button
                      variant="destructive"
                      onClick={async () => {
                        const amountCents = Math.round(
                          parseFloat(claimAmount || "0") * 100
                        )
                        if (!claimTitle || !claimDescription || amountCents <= 0) {
                          toast.error(
                            "Please fill in claim title, description, and amount"
                          )
                          return
                        }
                        if (evidencePhotos.length === 0) {
                          toast.error(tt("uploadAtLeastOneEvidencePhoto"))
                          return
                        }
                        try {
                          const result = await fileClaimMutation.mutateAsync({
                            bookingId: selectedBooking.id,
                            visitId: selectedBooking.visitId,
                            claimData: {
                              claimTitle,
                              claimDescription,
                              claimedAmountCents: amountCents,
                              managerNotes: notes || undefined,
                            },
                          })
                          // Attach evidence photos to the created claim
                          if (result.damageClaimId && evidencePhotos.length > 0) {
                            const headers = await getAuthHeaders()
                            for (let i = 0; i < evidencePhotos.length; i++) {
                              try {
                                await fetch(`/api/manager/damage-claims/${result.damageClaimId}/evidence`, {
                                  method: "POST",
                                  headers,
                                  credentials: "include",
                                  body: JSON.stringify({
                                    evidenceType: "photo_after",
                                    fileUrl: evidencePhotos[i],
                                    fileName: `damage-evidence-${i + 1}.jpg`,
                                    fileSize: 0,
                                    mimeType: "image/jpeg",
                                    description: `Manager damage evidence photo ${i + 1} of ${evidencePhotos.length}`,
                                  }),
                                })
                              } catch {
                                // Evidence upload is best-effort
                              }
                            }
                          }
                        } catch {
                          // Error handled by mutation onError
                        }
                      }}
                      disabled={fileClaimMutation.isPending || isUploadingEvidence || evidencePhotos.length === 0}
                    >
                      {fileClaimMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <FileWarning className="h-4 w-4 mr-2" />
                      )}
                      File Claim
                    </Button>
                  )}
                </DialogFooter>
              )}
            </>
          )}
        </AppDialogContent>
      </Dialog>
    </div>
  )
}
