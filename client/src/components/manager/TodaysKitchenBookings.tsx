/**
 * TodaysKitchenBookings
 *
 * Manager view showing today's kitchen bookings with live check-in status.
 * Allows managers to: confirm check-in, clear checkout, file claims.
 * Mirrors PendingStorageCheckouts component pattern.
 */

import { useState, useCallback } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  CheckCircle,
  Clock,
  User,
  Loader2,
  MoreHorizontal,
  ChefHat,
  LogIn,
  LogOut,
  XCircle,
  ShieldCheck,
  FileWarning,
  RefreshCw,
  Camera,
  Upload,
  X,
  KeyRound,
} from "lucide-react"
import { toast } from "sonner"
import { auth } from "@/lib/firebase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { CurrencyInput } from "@/components/ui/currency-input"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { format } from "date-fns"
import { useSessionFileUpload } from "@/hooks/useSessionFileUpload"
import { getR2ProxyUrl } from "@/utils/r2-url-helper"

// ─── Types ────────────────────────────────────────────────────────────────────

interface TodayBooking {
  id: number
  referenceCode?: string | null
  chefId: number
  kitchenId: number
  bookingDate: string
  startTime: string
  endTime: string
  status: string
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
  checkinChecklistItems: Array<{ id: string; label: string; checked: boolean }> | null
  checkoutChecklistItems: Array<{ id: string; label: string; checked: boolean }> | null
  accessCode: string | null
  accessCodeFormat: string | null
  accessCodeValidFrom: string | null
  accessCodeValidUntil: string | null
  hasAccessCodeHash: boolean | null
  smartLockEnabled: boolean | null
  kitchenName: string | null
  locationName: string | null
  chefEmail: string | null
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
          <CheckCircle className="h-3 w-3 mr-1" />
          Checked In
        </Badge>
      )
    case "checkout_requested":
      return (
        <Badge variant="info">
          <LogOut className="h-3 w-3 mr-1" />
          Checkout Requested
        </Badge>
      )
    case "checked_out":
      return (
        <Badge className="bg-blue-600 hover:bg-blue-700 text-white">
          <ShieldCheck className="h-3 w-3 mr-1" />
          Checked Out
        </Badge>
      )
    case "no_show":
      return (
        <Badge variant="destructive">
          <XCircle className="h-3 w-3 mr-1" />
          No-Show
        </Badge>
      )
    case "checkout_claim_filed":
      return (
        <Badge variant="warning">
          <FileWarning className="h-3 w-3 mr-1" />
          Claim Filed
        </Badge>
      )
    default:
      return (
        <Badge variant="outline">
          <Clock className="h-3 w-3 mr-1" />
          Not Checked In
        </Badge>
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
  const [editAccessCode, setEditAccessCode] = useState("")

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
        toast.error("Maximum 10 photos allowed")
        return
      }
      uploadEvidenceFile(file, "damage-claims")
      e.target.value = ''
    }
  }, [uploadEvidenceFile, evidencePhotos.length])

  // Set access code mutation
  const setAccessCodeMutation = useMutation({
    mutationFn: async ({ bookingId, accessCode }: { bookingId: number; accessCode: string }) => {
      const headers = await getAuthHeaders()
      const response = await fetch(`/api/manager/bookings/${bookingId}/access-code`, {
        method: "PUT",
        headers,
        credentials: "include",
        body: JSON.stringify({ accessCode }),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || "Failed to set access code")
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/manager/bookings/today"] })
      toast.success("Access code updated")
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  // Revoke access code mutation
  const revokeAccessCodeMutation = useMutation({
    mutationFn: async (bookingId: number) => {
      const headers = await getAuthHeaders()
      const response = await fetch(`/api/manager/bookings/${bookingId}/revoke-access-code`, {
        method: "POST",
        headers,
        credentials: "include",
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || "Failed to revoke access code")
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/manager/bookings/today"] })
      toast.success("Access code revoked")
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  // Regenerate access code mutation
  const regenerateAccessCodeMutation = useMutation({
    mutationFn: async (bookingId: number) => {
      const headers = await getAuthHeaders()
      const response = await fetch(`/api/manager/bookings/${bookingId}/regenerate-access-code`, {
        method: "POST",
        headers,
        credentials: "include",
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || "Failed to regenerate access code")
      }
      return response.json()
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/manager/bookings/today"] })
      if (data.accessCode) {
        toast.success(`New access code: ${data.accessCode}`)
      } else {
        toast.success("Access code regenerated")
      }
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  // Fetch today's bookings
  const { data, isLoading, refetch } = useQuery<TodayResponse>({
    queryKey: ["/api/manager/bookings/today"],
    queryFn: async () => {
      const headers = await getAuthHeaders()
      const response = await fetch("/api/manager/bookings/today", {
        headers,
        credentials: "include",
      })
      if (!response.ok) throw new Error("Failed to fetch today's bookings")
      return response.json()
    },
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  })

  const bookings = data?.bookings ?? []

  // Clear checkout mutation
  const clearCheckoutMutation = useMutation({
    mutationFn: async ({
      bookingId,
      managerNotes,
    }: {
      bookingId: number
      managerNotes?: string
    }) => {
      const headers = await getAuthHeaders()
      const response = await fetch(
        `/api/manager/bookings/${bookingId}/clear-kitchen-checkout`,
        {
          method: "POST",
          headers,
          credentials: "include",
          body: JSON.stringify({ managerNotes }),
        }
      )
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || "Failed to clear checkout")
      }
      return response.json()
    },
    onSuccess: () => {
      toast.success("Checkout cleared — no issues")
      queryClient.invalidateQueries({
        queryKey: ["/api/manager/bookings/today"],
      })
      closeSheet()
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  // File claim mutation
  const fileClaimMutation = useMutation({
    mutationFn: async ({
      bookingId,
      claimData,
    }: {
      bookingId: number
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
          body: JSON.stringify(claimData),
        }
      )
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || "Failed to file claim")
      }
      return response.json()
    },
    onSuccess: () => {
      toast.success("Damage claim filed")
      queryClient.invalidateQueries({
        queryKey: ["/api/manager/bookings/today"],
      })
      closeSheet()
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const closeSheet = () => {
    setSelectedBooking(null)
    setActionMode("view")
    setNotes("")
    setClaimTitle("")
    setClaimDescription("")
    setClaimAmount("")
    setEvidencePhotos([])
    setEditAccessCode("")
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
    setEditAccessCode("")
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
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ChefHat className="h-5 w-5 text-orange-600" />
                Today&apos;s Kitchen Bookings
              </CardTitle>
              <CardDescription>
                Live check-in/checkout status for {format(new Date(), "EEEE, MMM d")}.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading}
            >
              <RefreshCw
                className={cn("h-4 w-4 mr-1", isLoading && "animate-spin")}
              />
              Refresh
            </Button>
          </div>

          {/* Stats Row */}
          {bookings.length > 0 && (
            <div className="flex gap-3 mt-3 flex-wrap">
              <Badge variant="outline" className="gap-1">
                <Clock className="h-3 w-3" />
                {notCheckedInCount} Awaiting
              </Badge>
              <Badge className="bg-green-600 text-white gap-1">
                <CheckCircle className="h-3 w-3" />
                {checkedInCount} Active
              </Badge>
              {checkoutPendingCount > 0 && (
                <Badge variant="info" className="gap-1">
                  <LogOut className="h-3 w-3" />
                  {checkoutPendingCount} Checkout Pending
                </Badge>
              )}
              {noShowCount > 0 && (
                <Badge variant="destructive" className="gap-1">
                  <XCircle className="h-3 w-3" />
                  {noShowCount} No-Show
                </Badge>
              )}
            </div>
          )}
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : bookings.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <ChefHat className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No confirmed bookings for today.</p>
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap text-xs sm:text-sm">Time</TableHead>
                    <TableHead className="whitespace-nowrap text-xs sm:text-sm">Kitchen</TableHead>
                    <TableHead className="whitespace-nowrap text-xs sm:text-sm">Chef</TableHead>
                    <TableHead className="whitespace-nowrap text-xs sm:text-sm">Status</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookings.map((booking) => (
                    <TableRow
                      key={booking.id}
                      className={cn(
                        booking.checkinStatus === "no_show" && "bg-red-50/50",
                        booking.checkinStatus === "checkout_requested" &&
                          "bg-blue-50/50"
                      )}
                    >
                      <TableCell className="font-mono text-xs sm:text-sm whitespace-nowrap">
                        {formatTime(booking.startTime)} –{" "}
                        {formatTime(booking.endTime)}
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
                        {booking.hasAccessCodeHash && (
                          <div className="text-xs text-blue-600 font-mono flex items-center gap-1 mt-0.5">
                            <KeyRound className="h-3 w-3" />
                            Code set
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-xs sm:text-sm whitespace-nowrap">
                          <User className="h-3 w-3 text-muted-foreground" />
                          {booking.chefEmail || `Chef #${booking.chefId}`}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="whitespace-nowrap">
                          {getCheckinBadge(booking.checkinStatus)}
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
                              <ChefHat className="h-4 w-4 mr-2" />
                              View Details
                            </DropdownMenuItem>

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
                                  Clear — No Issues
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() =>
                                    openAction(booking, "file-claim")
                                  }
                                  className="text-amber-600 focus:text-amber-700"
                                >
                                  <FileWarning className="h-4 w-4 mr-2" />
                                  File Damage Claim
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
          )}
        </CardContent>
      </Card>

      {/* Action Sheet */}
      <Sheet
        open={selectedBooking !== null}
        onOpenChange={(open) => !open && closeSheet()}
      >
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {selectedBooking && (
            <>
              <SheetHeader>
                <SheetTitle>
                  {actionMode === "clear-checkout" && "Clear Checkout"}
                  {actionMode === "file-claim" && "File Damage Claim"}
                  {actionMode === "view" && "Booking Details"}
                </SheetTitle>
                <SheetDescription>
                  {selectedBooking.kitchenName} ·{" "}
                  {formatTime(selectedBooking.startTime)} –{" "}
                  {formatTime(selectedBooking.endTime)}
                  {selectedBooking.referenceCode &&
                    ` · ${selectedBooking.referenceCode}`}
                </SheetDescription>
              </SheetHeader>

              <div className="py-4 space-y-4">
                {/* Common booking info */}
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Chef</span>
                    <span>
                      {selectedBooking.chefEmail ||
                        `Chef #${selectedBooking.chefId}`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status</span>
                    {getCheckinBadge(selectedBooking.checkinStatus)}
                  </div>
                  {selectedBooking.checkedInAt && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Checked In
                      </span>
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
                      <span className="text-muted-foreground">
                        Checkout Requested
                      </span>
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
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Chef's verification
                      </p>

                      {/* Check-in section */}
                      {(selectedBooking.checkinPhotoUrls?.length ||
                        selectedBooking.checkinNotes) && (
                        <div className="rounded-lg border bg-green-50/40 border-green-200 p-3 space-y-2">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-green-800">
                            <LogIn className="h-3 w-3" />
                            Check-in
                          </div>
                          {selectedBooking.checkinNotes && (
                            <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                              {selectedBooking.checkinNotes}
                            </p>
                          )}
                          {selectedBooking.checkinChecklistItems && selectedBooking.checkinChecklistItems.length > 0 && (
                            <div className="space-y-1 mt-1">
                              <p className="text-[11px] text-green-700 font-medium">Checklist items confirmed:</p>
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
                                      <img
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
                            <LogOut className="h-3 w-3" />
                            Check-out
                          </div>
                          {selectedBooking.checkoutNotes && (
                            <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                              {selectedBooking.checkoutNotes}
                            </p>
                          )}
                          {selectedBooking.checkoutChecklistItems && selectedBooking.checkoutChecklistItems.length > 0 && (
                            <div className="space-y-1 mt-1">
                              <p className="text-[11px] text-blue-700 font-medium">Checklist items confirmed:</p>
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
                                      <img
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

                {/* Access Code Section (Phase 2 Enhanced) */}
                {selectedBooking.smartLockEnabled && (
                  <div className="rounded-lg border bg-blue-50/50 border-blue-200 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <KeyRound className="h-4 w-4 text-blue-600" />
                        <span className="text-sm font-medium text-blue-800">
                          Door Access Code
                        </span>
                        {selectedBooking.accessCodeFormat && (
                          <Badge variant="outline" className="text-[10px] h-5 border-blue-300 text-blue-600">
                            {selectedBooking.accessCodeFormat === 'alphanumeric' ? 'ABC' : '123'}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {selectedBooking.hasAccessCodeHash && (
                          <Badge className="bg-amber-100 text-amber-700 text-xs">
                            <Clock className="h-3 w-3 mr-1" />
                            Active
                          </Badge>
                        )}
                      </div>
                    </div>

                    {selectedBooking.hasAccessCodeHash ? (
                      <>
                          <p className="text-sm font-mono text-blue-700 tracking-wider">
                            ••••••
                          </p>
                        {selectedBooking.accessCodeValidFrom && selectedBooking.accessCodeValidUntil && (
                          <p className="text-xs text-blue-600 mt-1">
                            Valid: {formatTime(selectedBooking.accessCodeValidFrom.split('T')[1]?.substring(0, 5) || '')} – {formatTime(selectedBooking.accessCodeValidUntil.split('T')[1]?.substring(0, 5) || '')}
                          </p>
                        )}
                        {/* Action buttons */}
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => regenerateAccessCodeMutation.mutate(selectedBooking.id)}
                            disabled={regenerateAccessCodeMutation.isPending}
                          >
                            {regenerateAccessCodeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                            Regenerate
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-600 border-red-200 hover:bg-red-50"
                            onClick={() => revokeAccessCodeMutation.mutate(selectedBooking.id)}
                            disabled={revokeAccessCodeMutation.isPending}
                          >
                            {revokeAccessCodeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <XCircle className="h-3 w-3 mr-1" />}
                            Revoke
                          </Button>
                        </div>
                        {/* Manual code override */}
                        <div className="mt-2 flex items-center gap-2">
                          <Input
                            value={editAccessCode}
                            onChange={(e) => setEditAccessCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase())}
                            placeholder="Manual code"
                            className="h-8 w-32 font-mono text-sm"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (editAccessCode.length >= 4) {
                                setAccessCodeMutation.mutate({ bookingId: selectedBooking.id, accessCode: editAccessCode })
                              } else if (editAccessCode.length < 4) {
                                toast.error("Code must be 4-8 characters")
                              }
                            }}
                            disabled={setAccessCodeMutation.isPending || editAccessCode.length < 4}
                          >
                            {setAccessCodeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Set"}
                          </Button>
                        </div>
                        <p className="text-xs text-blue-500 mt-1">
                          Override with a code you programmed into the lock.
                        </p>
                      </>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-blue-600">
                          No access code set. Generate one automatically or enter a code manually.
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            onClick={() => regenerateAccessCodeMutation.mutate(selectedBooking.id)}
                            disabled={regenerateAccessCodeMutation.isPending}
                          >
                            {regenerateAccessCodeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                            Auto-Generate
                          </Button>
                          <span className="text-xs text-blue-400">or</span>
                          <Input
                            value={editAccessCode}
                            onChange={(e) => setEditAccessCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase())}
                            placeholder="e.g., A7K9MX"
                            className="h-8 w-28 font-mono text-sm"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (editAccessCode.length >= 4) {
                                setAccessCodeMutation.mutate({ bookingId: selectedBooking.id, accessCode: editAccessCode })
                              } else {
                                toast.error("Code must be 4-8 characters")
                              }
                            }}
                            disabled={setAccessCodeMutation.isPending || editAccessCode.length < 4}
                          >
                            {setAccessCodeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Set"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Clear Checkout */}
                {actionMode === "clear-checkout" && (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Confirm the kitchen is in good condition. This completes
                      the booking.
                    </p>
                    <div>
                      <Label>Manager Notes (optional)</Label>
                      <Textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="e.g., Kitchen inspected, all clean"
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
                      <Label>Claim Title</Label>
                      <Input
                        value={claimTitle}
                        onChange={(e) => setClaimTitle(e.target.value)}
                        placeholder="e.g., Damaged stovetop burner"
                      />
                    </div>
                    <div>
                      <Label>Description</Label>
                      <Textarea
                        value={claimDescription}
                        onChange={(e) => setClaimDescription(e.target.value)}
                        placeholder="Describe the damage or cleaning issue..."
                        rows={3}
                      />
                    </div>
                    <div>
                      <Label>Claim Amount ($)</Label>
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
                        Photo Evidence *
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Upload photos documenting the damage or issue. At least one photo is required.
                      </p>

                      {evidencePhotos.length > 0 && (
                        <div className="grid grid-cols-3 gap-2">
                          {evidencePhotos.map((url, i) => (
                            <div key={i} className="relative group">
                              <img
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
                              <Loader2 className="h-6 w-6 text-primary animate-spin mb-1" />
                              <span className="text-xs text-muted-foreground">Uploading... {Math.round(evidenceUploadProgress)}%</span>
                            </>
                          ) : (
                            <>
                              <Upload className="h-6 w-6 text-muted-foreground mb-1" />
                              <span className="text-xs text-muted-foreground">
                                {evidencePhotos.length === 0
                                  ? "Click to upload evidence photos"
                                  : `${evidencePhotos.length}/10 photos uploaded`}
                              </span>
                            </>
                          )}
                        </label>
                      </div>
                    </div>

                    <div>
                      <Label>Manager Notes (optional)</Label>
                      <Textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Internal notes..."
                        rows={2}
                      />
                    </div>
                  </div>
                )}
              </div>

              {actionMode !== "view" && (
                <SheetFooter className="gap-2 sm:gap-0">
                  <Button variant="outline" onClick={closeSheet}>
                    Cancel
                  </Button>

                  {actionMode === "clear-checkout" && (
                    <Button
                      onClick={() =>
                        clearCheckoutMutation.mutate({
                          bookingId: selectedBooking.id,
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
                      Clear — No Issues
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
                          toast.error("Please upload at least one evidence photo")
                          return
                        }
                        try {
                          const result = await fileClaimMutation.mutateAsync({
                            bookingId: selectedBooking.id,
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
                </SheetFooter>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
