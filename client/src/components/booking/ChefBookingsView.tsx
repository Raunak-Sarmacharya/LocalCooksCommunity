import { logger } from "@/lib/logger";
"use client"

import { useState, useMemo, useEffect } from "react"
import { useLocation } from "wouter"
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import {
  Calendar,
  Clock,
  MapPin,
  CheckCircle,
  XCircle,
  ChevronDown,
  Search,
  ArrowUpDown,
  Loader2,
  FileText,
  CalendarDays,
  MoreHorizontal,
  Eye,
  Download,
  AlertTriangle,
  Ban,
  X,
  Package,
  CalendarPlus,
  LogIn,
  LogOut,
  Building2,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { DEFAULT_TIMEZONE, isBookingPast, createBookingDateTime } from "@/utils/timezone-utils"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { StorageExtensionDialog } from "./StorageExtensionDialog"
import { StorageCheckoutDialog } from "./StorageCheckoutDialog"
import { StorageCheckinDialog } from "./StorageCheckinDialog"
import { CheckoutStatusTracker } from "./CheckoutStatusTracker"
import { CheckinStatusTracker } from "./CheckinStatusTracker"
import { ExpiringStorageNotification } from "./ExpiringStorageNotification"
import { PendingOverstayPenalties } from "../chef/PendingOverstayPenalties"
import { CancellationRequestSheet, type CancellationTarget } from "./CancellationRequestSheet"
import { KitchenCheckinTracker } from "./KitchenCheckinTracker"
import { auth } from "@/lib/firebase"
import { onAuthStateChanged } from "firebase/auth"
import { format, differenceInDays } from "date-fns"
import { cn } from "@/lib/utils"

// Types
interface Booking {
  id: number
  referenceCode?: string | null
  chefId: number
  kitchenId: number
  bookingDate: string
  startTime: string
  endTime: string
  selectedSlots?: Array<string | { startTime: string; endTime: string }>
  status: "pending" | "confirmed" | "cancelled" | "completed" | "cancellation_requested"
  specialNotes?: string
  createdAt: string
  updatedAt: string
  kitchenName?: string
  locationName?: string
  locationTimezone?: string
  location?: {
    id: number
    name: string
    cancellationPolicyHours?: number
    cancellationPolicyMessage?: string
  }
  totalPrice?: number
  paymentStatus?: string
  // ── Payment State Flags (from server PT join) ────────────────────────
  isVoidedAuthorization?: boolean  // true when PT canceled before capture — $0 charged
  isAuthorizedHold?: boolean       // true when payment held but not yet captured
  originalAuthorizedAmount?: number // Original auth amount for voided display context (cents)
  refundAmount?: number            // Actual refund amount in cents (from PT)
  chargedAmount?: number | null     // Tax-inclusive amount from PT (what chef actually paid/authorized)
  cancellationRequestedAt?: string
  // ── Kitchen Check-In/Checkout Lifecycle ──────────────────────────────────
  checkinStatus?: string | null
  checkedInAt?: string | null
  checkedInMethod?: string | null
  checkoutRequestedAt?: string | null
  checkedOutAt?: string | null
  checkoutApprovedAt?: string | null
  noShowDetectedAt?: string | null
  accessCodeValidFrom?: string | null
  accessCodeValidUntil?: string | null
}

interface StorageBooking {
  id: number
  referenceCode?: string | null
  storageListingId?: number
  kitchenBookingId?: number
  storageName?: string
  storageType?: string
  locationId?: number
  locationName?: string
  kitchenName?: string
  startDate: string
  endDate: string
  status: string
  paymentStatus?: string
  checkoutStatus?: string
  checkoutRequestedAt?: string
  checkoutApprovedAt?: string
  checkinStatus?: string
  checkinRequestedAt?: string
  checkinCompletedAt?: string
  cancellationRequestedAt?: string
  totalPrice?: number
  serviceFee?: number
  basePrice?: number
  minimumBookingDuration?: number
}

interface EquipmentBooking {
  id: number
  equipmentListingId?: number
  kitchenBookingId?: number
  equipmentType?: string
  brand?: string
  kitchenName?: string
  status: string
  totalPrice?: number
  paymentStatus?: string
}

interface ChefBookingsViewProps {
  bookings: Booking[]
  isLoading: boolean
  onCancelBooking: (bookingId: number, reason?: string) => void
  kitchens?: Array<{ id: number; name: string; locationName?: string }>
}

type FilterType = "all" | "pending" | "confirmed" | "cancelled" | "completed" | "cancellation_requested"
type ViewType = "upcoming" | "past" | "all"

// Helper functions
async function getAuthHeaders(): Promise<HeadersInit> {
  try {
    const currentUser = auth.currentUser
    if (currentUser) {
      const token = await currentUser.getIdToken()
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      }
    }
  } catch (error) {
    logger.error('Error getting Firebase token:', error)
  }
  return { 'Content-Type': 'application/json' }
}

const formatDate = (dateStr: string) => {
  try {
    const dateOnly = dateStr.split('T')[0]
    const date = new Date(dateOnly)
    if (isNaN(date.getTime())) return 'Invalid Date'
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return 'Invalid Date'
  }
}

const formatTime = (timeString: string) => {
  const [hours, minutes] = timeString.split(":")
  const hour = parseInt(hours)
  const ampm = hour >= 12 ? "PM" : "AM"
  const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour
  return `${displayHour}:${minutes} ${ampm}`
}

const formatBookingTimeSlots = (booking: Booking): string => {
  const rawSlots = booking.selectedSlots

  if (!rawSlots || rawSlots.length === 0) {
    return `${formatTime(booking.startTime)} - ${formatTime(booking.endTime)}`
  }

  const normalizeSlot = (slot: string | { startTime: string; endTime: string }) => {
    if (typeof slot === 'string') {
      const [h, m] = slot.split(':').map(Number)
      const endMins = h * 60 + m + 60
      const endH = Math.floor(endMins / 60)
      const endM = endMins % 60
      return {
        startTime: slot,
        endTime: `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`
      }
    }
    return slot
  }

  const normalized = rawSlots.map(normalizeSlot).filter(s => s.startTime && s.endTime)
  const sorted = [...normalized].sort((a, b) => a.startTime.localeCompare(b.startTime))

  let isContiguous = true
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1].endTime !== sorted[i].startTime) {
      isContiguous = false
      break
    }
  }

  if (isContiguous) {
    return `${formatTime(booking.startTime)} - ${formatTime(booking.endTime)}`
  }

  return sorted.map(s => `${formatTime(s.startTime)}-${formatTime(s.endTime)}`).join(', ')
}

const getTimeUntilBooking = (bookingDateTime: Date, now: Date) => {
  const hoursUntil = Math.floor((bookingDateTime.getTime() - now.getTime()) / (1000 * 60 * 60))
  const daysUntil = Math.floor(hoursUntil / 24)
  if (daysUntil > 0) return `${daysUntil}d`
  if (hoursUntil > 0) return `${hoursUntil}h`
  return "Soon"
}

const canCancelBooking = (booking: Booking, now: Date): boolean => {
  if (booking.status === 'cancelled' || booking.status === 'completed' || booking.status === 'cancellation_requested') return false

  try {
    const dateStr = booking.bookingDate?.split('T')[0] || booking.bookingDate
    // Resolve the booking start in the LOCATION's timezone — the kitchen's
    // wall-clock time is what the cancellation policy is measured against,
    // not the chef's browser timezone.
    const timezone = booking.locationTimezone || DEFAULT_TIMEZONE
    const bookingDateTime = createBookingDateTime(dateStr, booking.startTime, timezone)

    if (isNaN(bookingDateTime.getTime())) return false
    if (bookingDateTime < now) return false

    const hoursUntilBooking = (bookingDateTime.getTime() - now.getTime()) / (1000 * 60 * 60)
    const cancellationHours = booking.location?.cancellationPolicyHours ?? 24

    return hoursUntilBooking >= cancellationHours
  } catch {
    return false
  }
}

// Column definitions factory
interface BookingColumnsProps {
  onCancelBooking: (bookingId: number) => void
  onDownloadInvoice: (bookingId: number, bookingDate: string) => void | Promise<void>
  onNavigate: (path: string) => void
  onCheckinTracker: (bookingId: number) => void
  downloadingInvoiceId: number | null
  now: Date
  kitchens: Array<{ id: number; name: string; locationName?: string }>
  storageBookings: StorageBooking[]
  equipmentBookings: EquipmentBooking[]
}

const getChefBookingColumns = ({
  onCancelBooking,
  onDownloadInvoice,
  onNavigate,
  onCheckinTracker,
  downloadingInvoiceId,
  now,
  kitchens,
  storageBookings: allStorageBookings,
  equipmentBookings: allEquipmentBookings,
}: BookingColumnsProps): ColumnDef<Booking>[] => [
  {
    accessorKey: "createdAt",
    header: () => null,
    cell: () => null,
    enableHiding: true,
  },
  {
    id: "reference",
    header: "Ref",
    cell: ({ row }) => {
      const ref = row.original.referenceCode || row.original.id;
      return (
        <div className="font-mono text-xs text-muted-foreground whitespace-nowrap">
          {ref ? `#${ref}` : "—"}
        </div>
      );
    },
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        className="h-8 -ml-3"
      >
        Status
        <ArrowUpDown className="ml-2 h-3 w-3" />
      </Button>
    ),
    cell: ({ row }) => {
      const status = row.getValue("status") as string
      const booking = row.original

      let variant: "default" | "secondary" | "destructive" | "outline" = "outline"
      let icon = null
      let className = ""
      let label = status as string

      if (status === 'confirmed') {
        variant = "default"
        icon = <CheckCircle className="h-3 w-3 mr-1" />
        className = "bg-green-600 hover:bg-green-700"
        label = "Confirmed"
      } else if (status === 'cancelled') {
        // Industry standard: distinguish by cause
        if (booking.paymentStatus === 'failed' || booking.isVoidedAuthorization) {
          // Payment auth expired or voided — never charged
          variant = "outline"
          icon = <Clock className="h-3 w-3 mr-1" />
          className = "bg-muted text-muted-foreground border-border"
          label = "Expired"
        } else if (booking.cancellationRequestedAt) {
          // Chef requested cancellation, manager accepted
          variant = "outline"
          icon = <XCircle className="h-3 w-3 mr-1" />
          className = "bg-muted text-muted-foreground border-border"
          label = "Cancelled"
        } else if (booking.paymentStatus === 'refunded') {
          // Cancelled and fully refunded
          variant = "outline"
          icon = <XCircle className="h-3 w-3 mr-1" />
          className = "bg-muted text-muted-foreground border-border"
          label = "Refunded"
        } else {
          // Manager declined the booking
          variant = "destructive"
          icon = <XCircle className="h-3 w-3 mr-1" />
          label = "Declined"
        }
      } else if (status === 'completed') {
        variant = "default"
        icon = <CheckCircle className="h-3 w-3 mr-1" />
        className = "bg-blue-600 hover:bg-blue-700"
        label = "Completed"
      } else if (status === 'cancellation_requested') {
        variant = "secondary"
        icon = <Clock className="h-3 w-3 mr-1" />
        className = "bg-orange-100 text-orange-800 border-orange-300 hover:bg-orange-200"
        label = "Cancellation Pending"
      } else {
        variant = "secondary"
        icon = <Clock className="h-3 w-3 mr-1" />
        className = "bg-yellow-100 text-yellow-800 border-yellow-300 hover:bg-yellow-200"
        label = "Pending Approval"
      }

      let timeBadge = null
      try {
        const dateStr = booking.bookingDate?.split('T')[0] || booking.bookingDate
        // Resolve booking start in the location's timezone so "time until
        // booking" is measured against the kitchen's clock, not the chef's.
        const timezone = booking.locationTimezone || DEFAULT_TIMEZONE
        const bookingDateTime = createBookingDateTime(dateStr, booking.startTime, timezone)
        if (!isNaN(bookingDateTime.getTime())) {
          const isUpcoming = bookingDateTime >= now
          if (isUpcoming && status !== 'cancelled') {
            timeBadge = (
              <span className="text-xs text-muted-foreground ml-1">
                ({getTimeUntilBooking(bookingDateTime, now)})
              </span>
            )
          }
        }
      } catch {
        // Ignore
      }

      // Check for mixed storage statuses
      const relatedStorage = allStorageBookings.filter(
        (sb) => sb.kitchenBookingId === booking.id
      )
      const rejectedStorageCount = relatedStorage.filter((sb) => sb.status === 'cancelled' && sb.checkoutStatus !== 'completed' && sb.checkoutStatus !== 'checkout_claim_filed').length
      const pendingStorageCount = relatedStorage.filter((sb) => sb.status === 'pending').length

      // Check for mixed equipment statuses (mirrors storage logic)
      const relatedEquipment = allEquipmentBookings.filter(
        (eb) => eb.kitchenBookingId === booking.id
      )
      const rejectedEquipmentCount = relatedEquipment.filter((eb) => eb.status === 'cancelled').length

      const isVoided = booking.isVoidedAuthorization === true
      const isAuthHold = booking.isAuthorizedHold === true

      // ── Kitchen Check-In/Check-Out lifecycle badge (chef-facing) ──────────
      const checkinStatus = booking.checkinStatus
      let checkinBadge: { label: string; bg: string; text: string; border: string; icon: React.ReactNode } | null = null
      if ((status === 'confirmed' || status === 'completed') && checkinStatus) {
        if (checkinStatus === 'checked_in') {
          checkinBadge = { label: 'Checked In', bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', icon: <LogIn className="h-2.5 w-2.5" /> }
        } else if (checkinStatus === 'checkout_requested') {
          checkinBadge = { label: 'Checkout Pending Review', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', icon: <Clock className="h-2.5 w-2.5" /> }
        } else if (checkinStatus === 'checked_out') {
          checkinBadge = { label: 'Checked Out', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: <CheckCircle className="h-2.5 w-2.5" /> }
        } else if (checkinStatus === 'no_show') {
          checkinBadge = { label: 'No-Show', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', icon: <XCircle className="h-2.5 w-2.5" /> }
        } else if (checkinStatus === 'checkout_claim_filed') {
          checkinBadge = { label: 'Claim Filed', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: <AlertTriangle className="h-2.5 w-2.5" /> }
        }
      }

      return (
        <div className="flex flex-col gap-1">
          <div className="flex items-center">
            <Badge variant={variant} className={cn("items-center flex w-fit text-xs", className)}>
              {icon}
              {label}
            </Badge>
            {timeBadge}
          </div>
          {checkinBadge && (
            <div className={cn("flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border w-fit", checkinBadge.bg, checkinBadge.text, checkinBadge.border)}>
              {checkinBadge.icon}
              {checkinBadge.label}
            </div>
          )}
          {isVoided && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded border border-border w-fit">
              <XCircle className="h-2.5 w-2.5" />
              No charge
            </div>
          )}
          {isAuthHold && status === 'pending' && (
            <div className="flex items-center gap-1 text-xs text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200 w-fit">
              <Clock className="h-2.5 w-2.5" />
              Payment held
            </div>
          )}
          {/* Only show individual addon rejection badges when the booking itself was NOT fully voided.
              Full voided auth already communicates everything was rejected — individual badges would be redundant
              and misleading (implying kitchen was approved but specific addons were individually rejected). */}
          {!isVoided && rejectedStorageCount > 0 && (
            <div className="flex items-center gap-1 text-xs text-red-600 bg-red-50 px-1.5 py-0.5 rounded w-fit">
              <Package className="h-2.5 w-2.5" />
              {rejectedStorageCount} storage declined
            </div>
          )}
          {!isVoided && rejectedEquipmentCount > 0 && (
            <div className="flex items-center gap-1 text-xs text-red-600 bg-red-50 px-1.5 py-0.5 rounded w-fit">
              <Package className="h-2.5 w-2.5" />
              {rejectedEquipmentCount} equipment declined
            </div>
          )}
          {pendingStorageCount > 0 && status === 'confirmed' && (
            <div className="flex items-center gap-1 text-xs text-yellow-700 bg-yellow-50 px-1.5 py-0.5 rounded w-fit">
              <Package className="h-2.5 w-2.5" />
              {pendingStorageCount} storage pending
            </div>
          )}
          {status === 'cancelled' && booking.paymentStatus === 'partially_refunded' && (
            <div className="flex items-center gap-1 text-xs text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded border border-orange-200 w-fit">
              <AlertTriangle className="h-2.5 w-2.5" />
              Partial refund
            </div>
          )}
        </div>
      )
    },
    filterFn: (row, id, value) => {
      if (value === "all") return true
      return row.getValue(id) === value
    },
  },
  {
    accessorKey: "kitchenName",
    header: ({ column }) => (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        className="h-8 -ml-3"
      >
        Kitchen
        <ArrowUpDown className="ml-2 h-3 w-3" />
      </Button>
    ),
    cell: ({ row }) => {
      const booking = row.original
      const kitchen = kitchens.find((k) => k.id === booking.kitchenId)
      const kitchenName = kitchen?.name || booking.kitchenName || `Kitchen #${booking.kitchenId}`
      const locationName = kitchen?.locationName || booking.locationName || 'Unknown Location'

      return (
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="font-medium text-sm">{kitchenName}</span>
          </div>
          <div className="flex items-center text-xs text-muted-foreground mt-0.5 ml-5">
            <MapPin className="h-3 w-3 mr-1" />
            <span>{locationName}</span>
          </div>
        </div>
      )
    },
  },
  {
    accessorKey: "bookingDate",
    header: ({ column }) => (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        className="h-8 -ml-3"
      >
        Date & Time
        <ArrowUpDown className="ml-2 h-3 w-3" />
      </Button>
    ),
    cell: ({ row }) => {
      const booking = row.original

      return (
        <div className="flex flex-col text-sm">
          <div className="flex items-center">
            <Calendar className="h-3 w-3 mr-2 text-muted-foreground" />
            {formatDate(row.getValue("bookingDate"))}
          </div>
          <div className="flex items-center text-xs text-muted-foreground mt-0.5">
            <Clock className="h-3 w-3 mr-2" />
            {formatBookingTimeSlots(booking)}
          </div>
        </div>
      )
    },
  },
  {
    accessorKey: "totalPrice",
    header: ({ column }) => (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        className="h-8 justify-end w-full"
      >
        Amount
        <ArrowUpDown className="ml-2 h-3 w-3" />
      </Button>
    ),
    cell: ({ row }) => {
      // Use chargedAmount (tax-inclusive from PT) as primary, fall back to totalPrice (pre-tax from KB)
      const chargedAmount = row.original.chargedAmount
      const totalPrice = chargedAmount ?? row.original.totalPrice
      const isVoided = row.original.isVoidedAuthorization === true
      const isAuthHold = row.original.isAuthorizedHold === true
      const originalAuthAmount = row.original.originalAuthorizedAmount
      const paymentStatus = row.original.paymentStatus

      const formatPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`

      // ── VOIDED AUTHORIZATION: No money captured ────────────────────────
      if (isVoided) {
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="text-right cursor-help">
                  <div className="font-medium text-sm text-muted-foreground">No Charge</div>
                  <div className="text-xs text-muted-foreground">Hold released</div>
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <div className="space-y-1 text-sm">
                  <p className="font-medium">Booking Rejected</p>
                  {originalAuthAmount != null && originalAuthAmount > 0 && (
                    <div className="flex justify-between gap-4 text-muted-foreground">
                      <span>Original hold:</span>
                      <span className="font-mono line-through">{formatPrice(originalAuthAmount)}</span>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    The payment hold on your card was released. You were not charged.
                  </p>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )
      }

      if (!totalPrice) {
        return <span className="text-muted-foreground text-xs">—</span>
      }

      // ── AUTHORIZED HOLD: Pending manager action ────────────────────────
      if (isAuthHold) {
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="text-right cursor-help">
                  <div className="font-medium text-sm">{formatPrice(totalPrice)}</div>
                  <div className="text-xs text-blue-600">Payment held</div>
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <div className="space-y-1 text-sm">
                  <p className="font-medium text-blue-700">Payment Hold</p>
                  <p className="text-xs text-muted-foreground">
                    This amount is held on your card. The charge will be finalized once the kitchen manager approves your booking.
                  </p>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )
      }

      // ── CAPTURED / DEFAULT ─────────────────────────────────────────────
      const refundAmount = row.original.refundAmount ?? 0
      const hasRefund = refundAmount > 0
      const isCancelled = row.original.status === 'cancelled'
      const isRefunded = paymentStatus === 'refunded'

      // Cancelled + refunded: show original charge struck through + refund amount
      if (isCancelled && hasRefund) {
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="text-right cursor-help">
                  <div className="font-medium text-sm text-muted-foreground line-through">{formatPrice(totalPrice)}</div>
                  <div className="text-xs text-orange-600">Refunded: {formatPrice(refundAmount)}</div>
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <div className="space-y-1 text-sm">
                  <p className="font-medium text-orange-700">{isRefunded ? 'Fully Refunded' : 'Partially Refunded'}</p>
                  <div className="flex justify-between gap-4 text-muted-foreground">
                    <span>Original Charge:</span>
                    <span className="font-mono line-through">{formatPrice(totalPrice)}</span>
                  </div>
                  <div className="flex justify-between gap-4 font-semibold text-green-600">
                    <span>Refunded to You:</span>
                    <span>{formatPrice(refundAmount)}</span>
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )
      }

      // Active booking + partial refund (e.g., some addons cancelled)
      if (!isCancelled && hasRefund) {
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="text-right cursor-help">
                  <div className="font-medium text-sm">{formatPrice(totalPrice)}</div>
                  <div className="text-xs text-amber-600">Refund: {formatPrice(refundAmount)}</div>
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <div className="space-y-1 text-sm">
                  <p className="font-medium text-amber-700">Partial Refund Issued</p>
                  <div className="flex justify-between gap-4">
                    <span>Total Charged:</span>
                    <span className="font-medium font-mono">{formatPrice(totalPrice)}</span>
                  </div>
                  <div className="flex justify-between gap-4 text-green-600">
                    <span>Refunded to You:</span>
                    <span>{formatPrice(refundAmount)}</span>
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )
      }

      // Default: no refund
      const statusLabel = paymentStatus === 'paid' ? 'Paid'
        : paymentStatus === 'refunded' ? 'Refunded'
        : paymentStatus === 'partially_refunded' ? 'Partial Refund'
        : paymentStatus === 'processing' ? 'Processing'
        : 'Pending'

      const statusColor = paymentStatus === 'paid' ? 'text-green-600'
        : paymentStatus === 'refunded' || paymentStatus === 'partially_refunded' ? 'text-orange-600'
        : 'text-muted-foreground'

      return (
        <div className="text-right">
          <div className="font-medium text-sm">{formatPrice(totalPrice)}</div>
          <div className={`text-xs ${statusColor}`}>{statusLabel}</div>
        </div>
      )
    },
  },
  {
    accessorKey: "specialNotes",
    header: "Notes",
    cell: ({ row }) => {
      const notes = row.getValue("specialNotes") as string
      if (!notes) return <span className="text-muted-foreground text-xs">—</span>

      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center cursor-help">
                <FileText className="h-4 w-4 text-muted-foreground hover:text-foreground transition-colors" />
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="text-sm">{notes}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )
    },
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => {
      const booking = row.original
      const showCancel = canCancelBooking(booking, now)
      const isDownloading = downloadingInvoiceId === booking.id
      const isVoided = booking.isVoidedAuthorization === true
      const canDownloadInvoice = booking.status !== 'cancelled' && !isVoided

      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onNavigate(`/booking/${booking.id}`)}>
              <Eye className="h-4 w-4 mr-2" />
              View Details
            </DropdownMenuItem>

            {(booking.status === 'confirmed' || booking.status === 'completed') && (
              <DropdownMenuItem onClick={() => onCheckinTracker(booking.id)}>
                <LogIn className="h-4 w-4 mr-2" />
                {!booking.checkinStatus || booking.checkinStatus === 'not_checked_in'
                  ? 'Check In'
                  : booking.status === 'completed'
                    ? 'View Session Summary'
                    : booking.checkinStatus === 'checked_in'
                      ? 'View Check-In Status'
                      : 'Check-In / Checkout Status'}
              </DropdownMenuItem>
            )}

            {canDownloadInvoice && (
              <DropdownMenuItem
                onClick={() => onDownloadInvoice(booking.id, booking.bookingDate)}
                disabled={isDownloading}
              >
                {isDownloading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Download Invoice
              </DropdownMenuItem>
            )}

            {showCancel && (() => {
              const isConfirmedPaid = booking.status === 'confirmed' &&
                (booking.paymentStatus === 'paid' || booking.paymentStatus === 'partially_refunded')
              return (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onCancelBooking(booking.id)}
                    className={isConfirmedPaid ? "text-amber-600 focus:text-amber-700" : "text-destructive focus:text-destructive"}
                  >
                    <Ban className="h-4 w-4 mr-2" />
                    {isConfirmedPaid ? "Request Cancellation" : "Cancel Booking"}
                  </DropdownMenuItem>
                </>
              )
            })()}
          </DropdownMenuContent>
        </DropdownMenu>
      )
    },
  },
]

// Storage Booking Column definitions factory
interface StorageBookingColumnsProps {
  onExtend: (storageBookingId: number) => void
  onDownloadInvoice: (storageBookingId: number) => void | Promise<void>
  onCheckout: (storageBookingId: number) => void
  onCheckin: (storageBookingId: number) => void
  onViewCheckoutStatus: (storageBookingId: number) => void
  onViewCheckinStatus: (storageBookingId: number) => void
  onCancelStorage: (storageBookingId: number) => void
  downloadingInvoiceId: number | null
  now: Date
  kitchenBookings: Booking[]
}

const getStorageBookingColumns = ({
  onExtend,
  onDownloadInvoice,
  onCheckout,
  onCheckin,
  onViewCheckoutStatus,
  onViewCheckinStatus,
  onCancelStorage,
  downloadingInvoiceId,
  now,
  kitchenBookings,
}: StorageBookingColumnsProps): ColumnDef<StorageBooking>[] => [
  {
    id: "reference",
    header: "Ref",
    cell: ({ row }) => {
      const ref = row.original.referenceCode || row.original.id;
      return (
        <div className="font-mono text-xs text-muted-foreground whitespace-nowrap">
          {ref ? `#${ref}` : "—"}
        </div>
      );
    },
  },
  {
    accessorKey: "storageName",
    header: ({ column }) => (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        className="h-8 -ml-3"
      >
        Storage
        <ArrowUpDown className="ml-2 h-3 w-3" />
      </Button>
    ),
    cell: ({ row }) => {
      const storageBooking = row.original
      return (
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <Package className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="font-medium text-sm">{storageBooking.storageName || 'Storage Unit'}</span>
          </div>
          <div className="flex items-center text-xs text-muted-foreground mt-0.5 ml-5">
            <MapPin className="h-3 w-3 mr-1" />
            <span>{storageBooking.locationName || 'Unknown Location'}</span>
          </div>
        </div>
      )
    },
  },
  {
    accessorKey: "storageType",
    header: "Type",
    cell: ({ row }) => {
      const storageType = row.getValue("storageType") as string
      return (
        <Badge variant="outline" className="capitalize">
          {storageType || 'Standard'}
        </Badge>
      )
    },
  },
  {
    accessorKey: "startDate",
    header: ({ column }) => (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        className="h-8 -ml-3"
      >
        Period
        <ArrowUpDown className="ml-2 h-3 w-3" />
      </Button>
    ),
    cell: ({ row }) => {
      const storageBooking = row.original
      const endDate = new Date(storageBooking.endDate)
      const daysUntilExpiry = differenceInDays(endDate, now)
      const isExpiringSoon = daysUntilExpiry >= 0 && daysUntilExpiry <= 7
      const isExpired = daysUntilExpiry < 0
      const isActive = storageBooking.status === 'confirmed' || storageBooking.status === 'pending' || storageBooking.status === 'cancellation_requested'

      return (
        <div className="flex flex-col">
          <div className="flex items-center text-sm">
            <Calendar className="h-3 w-3 mr-2 text-muted-foreground" />
            {format(new Date(storageBooking.startDate), "MMM d")} - {format(endDate, "MMM d, yyyy")}
          </div>
          {isActive && isExpiringSoon && !isExpired && (
            <div className="text-xs text-amber-600 mt-0.5 ml-5">
              Expires in {daysUntilExpiry} day{daysUntilExpiry !== 1 ? 's' : ''}
            </div>
          )}
          {isActive && isExpired && (
            <div className="text-xs text-red-600 mt-0.5 ml-5">
              Expired {Math.abs(daysUntilExpiry)} day{Math.abs(daysUntilExpiry) !== 1 ? 's' : ''} ago
            </div>
          )}
        </div>
      )
    },
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const storageBooking = row.original
      const status = storageBooking.status
      const checkoutStatus = storageBooking.checkoutStatus

      // Completed bookings — checkout cleared or claim filed
      if (status === 'completed' && checkoutStatus === 'checkout_claim_filed') {
        return (
          <Badge variant="warning">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Claim Filed
          </Badge>
        )
      } else if (status === 'completed') {
        return (
          <Badge variant="success">
            <CheckCircle className="h-3 w-3 mr-1" />
            Cleared
          </Badge>
        )
      // Cancelled bookings — distinguish by cause for intuitive labels
      // Industry standard: Expired (payment failed), Cancelled (chef-initiated), Declined (manager rejected)
      } else if (status === 'cancelled' && storageBooking.paymentStatus === 'failed') {
        // Distinguish auth-expired (whole booking died) vs manager-declined (parent KB still confirmed)
        const parentKB = storageBooking.kitchenBookingId
          ? kitchenBookings.find(b => b.id === storageBooking.kitchenBookingId)
          : null
        const isManagerDeclined = parentKB && (parentKB.status === 'confirmed' || parentKB.paymentStatus === 'paid')
        if (isManagerDeclined) {
          return (
            <Badge variant="outline" className="text-destructive border-destructive/30">
              <XCircle className="h-3 w-3 mr-1" />
              Declined
            </Badge>
          )
        }
        // Payment auth expired or failed — never charged
        return (
          <Badge variant="outline" className="bg-muted text-muted-foreground border-border">
            <Clock className="h-3 w-3 mr-1" />
            Expired
          </Badge>
        )
      } else if (status === 'cancelled' && storageBooking.cancellationRequestedAt) {
        // Chef requested cancellation, manager accepted
        return (
          <Badge variant="outline" className="bg-muted text-muted-foreground border-border">
            <XCircle className="h-3 w-3 mr-1" />
            Cancelled
          </Badge>
        )
      } else if (status === 'cancelled' && storageBooking.paymentStatus === 'refunded') {
        // Cancelled and fully refunded
        return (
          <Badge variant="outline" className="bg-muted text-muted-foreground border-border">
            <XCircle className="h-3 w-3 mr-1" />
            Refunded
          </Badge>
        )
      } else if (status === 'cancelled') {
        // Manager declined the booking (no chef cancellation request, payment was paid)
        return (
          <Badge variant="outline" className="text-destructive border-destructive/30">
            <XCircle className="h-3 w-3 mr-1" />
            Declined
          </Badge>
        )
      } else if (status === 'cancellation_requested') {
        return (
          <Badge variant="warning">
            <Clock className="h-3 w-3 mr-1" />
            Cancellation Pending
          </Badge>
        )
      } else if (status === 'pending') {
        return (
          <Badge variant="warning">
            <Clock className="h-3 w-3 mr-1" />
            Pending Approval
          </Badge>
        )
      } else if (status === 'confirmed' && checkoutStatus === 'checkout_requested') {
        return (
          <Badge variant="info">
            <Clock className="h-3 w-3 mr-1" />
            Checkout Under Review
          </Badge>
        )
      } else if (status === 'confirmed' && checkoutStatus === 'checkout_approved') {
        return (
          <Badge variant="success">
            <CheckCircle className="h-3 w-3 mr-1" />
            Checkout Approved
          </Badge>
        )
      } else if (status === 'confirmed' && checkoutStatus === 'active') {
        return (
          <Badge variant="success">
            <CheckCircle className="h-3 w-3 mr-1" />
            Active
          </Badge>
        )
      } else if (status === 'confirmed') {
        return (
          <Badge variant="success">
            <CheckCircle className="h-3 w-3 mr-1" />
            Confirmed
          </Badge>
        )
      }
      return (
        <Badge variant="outline" className="capitalize">
          {status}
        </Badge>
      )
    },
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => {
      const storageBooking = row.original
      const isDownloading = downloadingInvoiceId === storageBooking.id
      const isConfirmed = storageBooking.status === 'confirmed'
      const isCompleted = storageBooking.status === 'completed'
      const isCancellationRequested = storageBooking.status === 'cancellation_requested'
      const canCancel = (isConfirmed || storageBooking.status === 'pending') && !isCancellationRequested
      const checkoutStatusActive = storageBooking.checkoutStatus === 'active'
      const bookingEndDate = new Date(storageBooking.endDate)
      bookingEndDate.setHours(0, 0, 0, 0)
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const isExpired = bookingEndDate < todayStart

      // Storage Check-In: available once the booking has started and before
      // check-in has been completed. Symmetric with the checkout gate below.
      const bookingStartDate = new Date(storageBooking.startDate)
      bookingStartDate.setHours(0, 0, 0, 0)
      const hasStarted = bookingStartDate <= todayStart
      const checkinStatus = storageBooking.checkinStatus || 'not_checked_in'
      const checkinCompleted = checkinStatus === 'checkin_completed' || checkinStatus === 'skipped'
      const canCheckin =
        isConfirmed &&
        checkoutStatusActive &&
        hasStarted &&
        !checkinCompleted

      // Storage Check-Out: only available AFTER check-in is completed.
      // You cannot check out of a storage unit you haven't checked into.
      const canCheckout =
        isConfirmed &&
        checkoutStatusActive &&
        checkinCompleted

      const canExtend = isConfirmed && checkoutStatusActive && !isCompleted && !isExpired

      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canExtend && (
              <DropdownMenuItem onClick={() => onExtend(storageBooking.id)}>
                <CalendarPlus className="h-4 w-4 mr-2" />
                Extend Storage
              </DropdownMenuItem>
            )}

            <DropdownMenuItem
              onClick={() => onDownloadInvoice(storageBooking.id)}
              disabled={isDownloading}
            >
              {isDownloading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Download Invoice
            </DropdownMenuItem>

            {canCheckin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onCheckin(storageBooking.id)}>
                  <LogIn className="h-4 w-4 mr-2" />
                  Check In
                </DropdownMenuItem>
              </>
            )}

            {checkinCompleted && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onViewCheckinStatus(storageBooking.id)}>
                  <CheckCircle className="h-4 w-4 mr-2 text-emerald-600" />
                  View Check-In History
                </DropdownMenuItem>
              </>
            )}

            {isConfirmed && canCheckout && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onCheckout(storageBooking.id)}>
                  <LogOut className="h-4 w-4 mr-2" />
                  Request Checkout
                </DropdownMenuItem>
              </>
            )}

            {storageBooking.checkoutStatus && storageBooking.checkoutStatus !== 'active' && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onViewCheckoutStatus(storageBooking.id)}>
                  <Eye className="h-4 w-4 mr-2" />
                  View Checkout Status
                </DropdownMenuItem>
              </>
            )}

            {canCancel && (() => {
              const isConfirmedPaid = storageBooking.status === 'confirmed' &&
                (storageBooking.paymentStatus === 'paid' || storageBooking.paymentStatus === 'partially_refunded')
              return (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onCancelStorage(storageBooking.id)}
                    className={isConfirmedPaid ? "text-amber-600 focus:text-amber-700 focus:bg-amber-50" : "text-red-600 focus:text-red-700 focus:bg-red-50"}
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    {isConfirmedPaid ? "Request Cancellation" : "Cancel Storage"}
                  </DropdownMenuItem>
                </>
              )
            })()}
          </DropdownMenuContent>
        </DropdownMenu>
      )
    },
  },
]

// Main Component
export default function ChefBookingsView({
  bookings,
  isLoading,
  onCancelBooking,
  kitchens = [],
}: ChefBookingsViewProps) {
  const [, navigate] = useLocation()
  const [statusFilter, setStatusFilter] = useState<FilterType>("all")
  const [viewType, setViewType] = useState<ViewType>("upcoming")
  const [searchQuery, setSearchQuery] = useState("")
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState<number | null>(null)
  const [extendDialogOpen, setExtendDialogOpen] = useState<number | null>(null)
  const [checkoutDialogOpen, setCheckoutDialogOpen] = useState<number | null>(null)
  const [checkinDialogOpen, setCheckinDialogOpen] = useState<number | null>(null)
  const [checkoutStatusBookingId, setCheckoutStatusBookingId] = useState<number | null>(null)
  const [checkinStatusBookingId, setCheckinStatusBookingId] = useState<number | null>(null)
  const [cancellationTarget, setCancellationTarget] = useState<CancellationTarget | null>(null)
  const [checkinTrackerBookingId, setCheckinTrackerBookingId] = useState<number | null>(null)

  // TanStack Table state
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({ createdAt: false })

  const [isAuthReady, setIsAuthReady] = useState(false)
  const [hasAuthUser, setHasAuthUser] = useState(false)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthReady(true)
      setHasAuthUser(!!user)
    })
    return () => unsubscribe()
  }, [])

  // Storage bookings query
  const { data: storageBookings = [] } = useQuery({
    queryKey: ['/api/chef/storage-bookings'],
    enabled: isAuthReady && hasAuthUser,
    queryFn: async () => {
      const headers = await getAuthHeaders()
      const response = await fetch('/api/chef/storage-bookings', {
        headers,
        credentials: 'include',
      })
      if (!response.ok) throw new Error('Failed to fetch storage bookings')
      return response.json()
    },
  })

  // Equipment bookings query (mirrors storage bookings pattern)
  const { data: equipmentBookings = [] } = useQuery({
    queryKey: ['/api/chef/equipment-bookings'],
    enabled: isAuthReady && hasAuthUser,
    queryFn: async () => {
      const headers = await getAuthHeaders()
      const response = await fetch('/api/chef/equipment-bookings', {
        headers,
        credentials: 'include',
      })
      if (!response.ok) throw new Error('Failed to fetch equipment bookings')
      return response.json()
    },
  })

  const now = useMemo(() => new Date(), [])

  // Categorize bookings
  const { upcomingBookings, pastBookings, allBookings } = useMemo(() => {
    const upcoming: Booking[] = []
    const past: Booking[] = []

    if (!Array.isArray(bookings) || bookings.length === 0) {
      return { upcomingBookings: [], pastBookings: [], allBookings: [] }
    }

    bookings.forEach((booking) => {
      if (!booking || !booking.bookingDate || !booking.startTime || !booking.endTime) return

      try {
        const timezone = booking.locationTimezone || DEFAULT_TIMEZONE
        const bookingDateStr = booking.bookingDate.split('T')[0]

        if (isBookingPast(bookingDateStr, booking.endTime, timezone)) {
          past.push(booking)
        } else {
          upcoming.push(booking)
        }
      } catch {
        const dateStr = booking.bookingDate.split('T')[0]
        const bookingEndDateTime = new Date(`${dateStr}T${booking.endTime}`)
        if (bookingEndDateTime < new Date()) {
          past.push(booking)
        } else {
          upcoming.push(booking)
        }
      }
    })

    // Sort using each booking's location timezone so two bookings in different
    // time zones (e.g. one in NDT, one in PST) compare at their actual UTC
    // instants rather than being aligned to the browser's local midnight.
    const toStartMs = (bk: Booking): number => {
      const dateStr = bk.bookingDate?.split('T')[0] || bk.bookingDate
      const tz = bk.locationTimezone || DEFAULT_TIMEZONE
      return createBookingDateTime(dateStr, bk.startTime, tz).getTime()
    }
    upcoming.sort((a, b) => toStartMs(a) - toStartMs(b))
    past.sort((a, b) => toStartMs(b) - toStartMs(a))

    return { upcomingBookings: upcoming, pastBookings: past, allBookings: bookings }
  }, [bookings])

  // Get current view data
  const currentViewData = useMemo(() => {
    if (viewType === "upcoming") return upcomingBookings
    if (viewType === "past") return pastBookings
    return allBookings
  }, [viewType, upcomingBookings, pastBookings, allBookings])

  // Apply search filter
  const filteredData = useMemo(() => {
    let filtered = currentViewData

    // Status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter((b) => b.status === statusFilter)
    }

    // Search filter (includes reference code for lookup)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      filtered = filtered.filter((b) => {
        const kitchen = kitchens.find((k) => k.id === b.kitchenId)
        const kitchenName = kitchen?.name || b.kitchenName || `Kitchen #${b.kitchenId}`
        const locationName = kitchen?.locationName || b.locationName || "Unknown Location"
        const searchableText = [
          kitchenName,
          locationName,
          formatDate(b.bookingDate),
          b.specialNotes || '',
          b.referenceCode || '',
        ].join(' ').toLowerCase()
        return searchableText.includes(query)
      })
    }

    return filtered
  }, [currentViewData, statusFilter, searchQuery, kitchens])

  // Status counts for current view
  const statusCounts = useMemo(() => {
    const counts = { all: 0, pending: 0, confirmed: 0, cancelled: 0, completed: 0, cancellation_requested: 0 }
    currentViewData.forEach((b) => {
      counts.all++
      if (b.status in counts) counts[b.status as keyof typeof counts]++
    })
    return counts
  }, [currentViewData])

  // Handle invoice download
  const handleDownloadInvoice = async (bookingId: number, bookingDate: string) => {
    setDownloadingInvoiceId(bookingId)
    try {
      const currentUser = auth.currentUser
      if (!currentUser) {
        toast.error("Please log in to download invoice")
        setDownloadingInvoiceId(null)
        return
      }

      const token = await currentUser.getIdToken()
      const response = await fetch(`/api/bookings/${bookingId}/invoice`, {
        credentials: 'include',
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (!response.ok) {
        let errorMessage = 'Failed to generate invoice'
        try {
          const contentType = response.headers.get('content-type')
          if (contentType && contentType.includes('application/json')) {
            const errorData = await response.json()
            errorMessage = errorData.error || errorData.message || errorMessage
          }
        } catch {
          errorMessage = `Server returned ${response.status}`
        }
        throw new Error(errorMessage)
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.style.display = 'none'
      a.href = url
      const dateStr = bookingDate ? new Date(bookingDate).toISOString().split('T')[0] : 'unknown'
      a.download = `LocalCooks-Invoice-${bookingId}-${dateStr}.pdf`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast.success("Invoice downloaded successfully!")
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to download invoice"
      toast.error(errorMessage)
    } finally {
      setDownloadingInvoiceId(null)
    }
  }

  // Handle storage invoice download
  const handleDownloadStorageInvoice = async (storageBookingId: number) => {
    setDownloadingInvoiceId(storageBookingId)
    try {
      const currentUser = auth.currentUser
      if (!currentUser) {
        toast.error("Please log in to download invoice")
        setDownloadingInvoiceId(null)
        return
      }

      const token = await currentUser.getIdToken()
      const response = await fetch(`/api/chef/invoices/storage/${storageBookingId}`, {
        credentials: 'include',
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (!response.ok) {
        let errorMessage = 'Failed to generate invoice'
        try {
          const contentType = response.headers.get('content-type')
          if (contentType && contentType.includes('application/json')) {
            const errorData = await response.json()
            errorMessage = errorData.error || errorData.message || errorMessage
          }
        } catch {
          errorMessage = `Server returned ${response.status}`
        }
        throw new Error(errorMessage)
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.style.display = 'none'
      a.href = url
      a.download = `storage-invoice-${storageBookingId}.pdf`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast.success("Storage invoice downloaded successfully!")
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to download invoice"
      toast.error(errorMessage)
    } finally {
      setDownloadingInvoiceId(null)
    }
  }

  // ── Cancel Storage Booking mutation ─────────────────────────────────────
  const queryClient = useQueryClient()
  const cancelStorageMutation = useMutation({
    mutationFn: async ({ storageBookingId, reason }: { storageBookingId: number; reason?: string }) => {
      const headers = await getAuthHeaders()
      const response = await fetch(`/api/chef/storage-bookings/${storageBookingId}/cancel`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to cancel storage booking')
      }
      return response.json()
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/chef/storage-bookings'] })
      if (data?.action === 'cancellation_requested') {
        toast.success('Cancellation request sent to the kitchen manager for review.')
      } else {
        toast.success('Storage booking cancelled successfully.')
      }
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const handleCancelStorage = (storageBookingId: number) => {
    const sb = (storageBookings as StorageBooking[]).find(s => s.id === storageBookingId)
    if (!sb) return

    const isConfirmedPaid = sb.status === 'confirmed' &&
      (sb.paymentStatus === 'paid' || sb.paymentStatus === 'partially_refunded')

    setCancellationTarget({
      type: "storage",
      id: storageBookingId,
      name: sb.storageName || sb.storageType || `Storage #${storageBookingId}`,
      date: sb.startDate && sb.endDate
        ? `${format(new Date(sb.startDate), 'MMM d')} – ${format(new Date(sb.endDate), 'MMM d, yyyy')}`
        : undefined,
      location: sb.locationName || sb.kitchenName || undefined,
      tier: isConfirmedPaid ? "request" : "immediate",
    })
  }

  // Handle cancel with policy check
  // Tier 1: pending/authorized → immediate cancel prompt
  // Tier 2: confirmed+paid → cancellation request prompt with reason
  const handleCancel = (bookingId: number) => {
    const booking = bookings.find(b => b.id === bookingId)
    if (!booking) return

    const dateStr = booking.bookingDate.split('T')[0]
    // Resolve in the location's timezone so the cancellation-window math
    // agrees with the server (which measures against the kitchen's wall clock).
    const timezone = booking.locationTimezone || DEFAULT_TIMEZONE
    const bookingDateTime = createBookingDateTime(dateStr, booking.startTime, timezone)

    if (isNaN(bookingDateTime.getTime())) {
      toast.error("Invalid booking date format")
      return
    }

    const cancellationHours = booking.location?.cancellationPolicyHours ?? 24
    const policyMessage = booking.location?.cancellationPolicyMessage
      ?.replace('{hours}', cancellationHours.toString())
      ?? `Bookings cannot be cancelled within ${cancellationHours} hours of the scheduled time.`

    const hoursUntilBooking = (bookingDateTime.getTime() - now.getTime()) / (1000 * 60 * 60)

    if (hoursUntilBooking < 0) {
      toast.error("This booking has already started or passed")
      return
    }

    if (hoursUntilBooking < cancellationHours) {
      toast.error(policyMessage)
      return
    }

    // Tier 2: Confirmed + paid bookings → cancellation request with reason
    const isConfirmedPaid = booking.status === 'confirmed' &&
      (booking.paymentStatus === 'paid' || booking.paymentStatus === 'partially_refunded')

    const kitchen = kitchens.find(k => k.id === booking.kitchenId)
    const dateStr2 = booking.bookingDate.split('T')[0]

    setCancellationTarget({
      type: "kitchen",
      id: bookingId,
      name: kitchen?.name || `Kitchen Booking #${bookingId}`,
      date: format(new Date(dateStr2), 'EEEE, MMM d, yyyy'),
      location: booking.location?.name || undefined,
      tier: isConfirmedPaid ? "request" : "immediate",
    })
  }

  // Table columns
  const columns = useMemo(
    () => getChefBookingColumns({
      onCancelBooking: handleCancel,
      onDownloadInvoice: handleDownloadInvoice,
      onNavigate: navigate,
      onCheckinTracker: (id) => setCheckinTrackerBookingId(id),
      downloadingInvoiceId,
      now,
      kitchens,
      storageBookings: storageBookings as StorageBooking[],
      equipmentBookings: equipmentBookings as EquipmentBooking[],
    }),
    [downloadingInvoiceId, now, kitchens, navigate, storageBookings, equipmentBookings, bookings]
  )

  // Storage table columns
  const storageColumns = useMemo(
    () => getStorageBookingColumns({
      onExtend: (id) => setExtendDialogOpen(id),
      onDownloadInvoice: handleDownloadStorageInvoice,
      onCheckout: (id) => setCheckoutDialogOpen(id),
      onCheckin: (id) => setCheckinDialogOpen(id),
      onViewCheckoutStatus: (id) => setCheckoutStatusBookingId(id),
      onViewCheckinStatus: (id) => setCheckinStatusBookingId(id),
      onCancelStorage: handleCancelStorage,
      downloadingInvoiceId,
      now,
      kitchenBookings: bookings,
    }),
    [downloadingInvoiceId, now, storageBookings, bookings]
  )

  // TanStack Table instance for kitchen bookings
  const table = useReactTable({
    data: filteredData,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
    },
    initialState: {
      pagination: { pageSize: 10 },
    },
  })

  // TanStack Table instance for storage bookings
  const storageTable = useReactTable({
    data: (storageBookings as StorageBooking[]),
    columns: storageColumns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    initialState: {
      pagination: { pageSize: 10 },
    },
  })

  const statusConfig = {
    all: { variant: "outline" as const, className: "" },
    pending: { variant: "secondary" as const, className: "bg-yellow-100 text-yellow-800 border-yellow-300 hover:bg-yellow-200" },
    confirmed: { variant: "default" as const, className: "bg-green-600 hover:bg-green-700" },
    cancelled: { variant: "destructive" as const, className: "" },
    completed: { variant: "outline" as const, className: "bg-green-50 text-green-700 border-green-200 hover:bg-green-100" },
    cancellation_requested: { variant: "secondary" as const, className: "bg-orange-100 text-orange-800 border-orange-300 hover:bg-orange-200" },
  }

  // ── Compute bookings needing check-in/check-out action ──────────────────
  const needsCheckinBookings = useMemo(() => {
    const now = new Date()
    return upcomingBookings.filter(b => {
      if (b.status !== 'confirmed') return false
      if (b.checkinStatus && b.checkinStatus !== 'not_checked_in') return false
      // Resolve booking start in the LOCATION's timezone so this filter agrees
      // with the kitchen's wall clock (not the chef's browser clock). An NDT
      // booking viewed from IST must not show the "check in now" card until
      // it's actually within 2 hours in NDT.
      const dateStr = b.bookingDate.split('T')[0]
      const timezone = b.locationTimezone || DEFAULT_TIMEZONE
      const bookingStart = createBookingDateTime(dateStr, b.startTime, timezone)
      const hoursUntil = (bookingStart.getTime() - now.getTime()) / (1000 * 60 * 60)
      return hoursUntil <= 2 // Within 2 hours of start time
    })
  }, [upcomingBookings])

  const needsCheckoutBookings = useMemo(() => {
    return upcomingBookings.filter(b => {
      if (b.status !== 'confirmed') return false
      return b.checkinStatus === 'checked_in'
    })
  }, [upcomingBookings])

  const needsStorageCheckin = useMemo(() => {
    const now = new Date()
    const todayStr = now.toISOString().split('T')[0]
    return (storageBookings as StorageBooking[]).filter(sb => {
      if (sb.status !== 'confirmed') return false
      if (sb.checkinStatus && sb.checkinStatus !== 'not_checked_in') return false
      const sd = String(sb.startDate).split('T')[0]
      return sd <= todayStr // Start date is today or earlier
    })
  }, [storageBookings])

  const needsStorageCheckout = useMemo(() => {
    return (storageBookings as StorageBooking[]).filter(sb => {
      if (sb.status !== 'confirmed') return false
      return sb.checkinStatus === 'checkin_completed' && (!sb.checkoutStatus || sb.checkoutStatus === 'active')
    })
  }, [storageBookings])

  return (
    <div className="space-y-6">
      {/* Pending Overstay Penalties */}
      <PendingOverstayPenalties />

      {/* Expiring Storage Notifications */}
      <ExpiringStorageNotification />

      {/* ── Check-In Action Banner ──────────────────────────────────────── */}
      {needsCheckinBookings.length > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="flex items-start gap-3">
            <LogIn className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-blue-900">
                {needsCheckinBookings.length === 1
                  ? "Time to Check In!"
                  : `${needsCheckinBookings.length} Bookings Need Check-In`}
              </h3>
              <p className="text-xs text-blue-700 mt-1">
                You must check in when you arrive at the kitchen. Complete a quick checklist and snap photos to document the condition — this protects you if any issues arise.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                {needsCheckinBookings.map(b => {
                  const kitchen = kitchens.find(k => k.id === b.kitchenId)
                  const kitchenName = kitchen?.name || b.kitchenName || `Kitchen #${b.kitchenId}`
                  return (
                    <Button
                      key={b.id}
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                      onClick={() => setCheckinTrackerBookingId(b.id)}
                    >
                      <LogIn className="h-3.5 w-3.5 mr-1.5" />
                      Check In — {kitchenName}
                    </Button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Check-Out Action Banner ─────────────────────────────────────── */}
      {needsCheckoutBookings.length > 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-start gap-3">
            <LogOut className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-emerald-900">
                {needsCheckoutBookings.length === 1
                  ? "Ready to Check Out?"
                  : `${needsCheckoutBookings.length} Bookings Need Check-Out`}
              </h3>
              <p className="text-xs text-emerald-700 mt-1">
                Submit your check-out photos when you're done. The manager will review and clear your session.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                {needsCheckoutBookings.map(b => {
                  const kitchen = kitchens.find(k => k.id === b.kitchenId)
                  const kitchenName = kitchen?.name || b.kitchenName || `Kitchen #${b.kitchenId}`
                  return (
                    <Button
                      key={b.id}
                      size="sm"
                      variant="outline"
                      className="border-emerald-300 text-emerald-700 hover:bg-emerald-100"
                      onClick={() => setCheckinTrackerBookingId(b.id)}
                    >
                      <LogOut className="h-3.5 w-3.5 mr-1.5" />
                      Check Out — {kitchenName}
                    </Button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Storage Check-In Action Banner (only when not checked in) ──── */}
      {needsStorageCheckin.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <Package className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-amber-900">
                {needsStorageCheckin.length === 1
                  ? "Storage Move-In Inspection Due"
                  : `${needsStorageCheckin.length} Storage Units Need Check-In`}
              </h3>
              <p className="text-xs text-amber-700 mt-1">
                Complete the move-in checklist and upload photos of your storage unit. This establishes the baseline condition and protects you from unfair damage claims. You must check in before you can check out.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                {needsStorageCheckin.map(sb => (
                  <Button
                    key={`checkin-${sb.id}`}
                    size="sm"
                    className="bg-amber-600 hover:bg-amber-700 text-white"
                    variant="default"
                    onClick={() => setCheckinDialogOpen(sb.id)}
                  >
                    <LogIn className="h-3.5 w-3.5 mr-1.5" />Check In — {sb.storageName || `Storage #${sb.id}`}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Storage Check-Out Action Banner (only after check-in completed) ── */}
      {needsStorageCheckout.length > 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-start gap-3">
            <LogOut className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-emerald-900">
                {needsStorageCheckout.length === 1
                  ? "Ready to Move Out?"
                  : `${needsStorageCheckout.length} Storage Units Ready for Check-Out`}
              </h3>
              <p className="text-xs text-emerald-700 mt-1">
                Submit your check-out photos showing the unit is clean and empty. The manager will review and clear you.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                {needsStorageCheckout.map(sb => (
                  <Button
                    key={`checkout-${sb.id}`}
                    size="sm"
                    variant="outline"
                    className="border-emerald-300 text-emerald-700 hover:bg-emerald-100"
                    onClick={() => setCheckoutDialogOpen(sb.id)}
                  >
                    <LogOut className="h-3.5 w-3.5 mr-1.5" />
                    Check Out — {sb.storageName || `Storage #${sb.id}`}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Kitchen Bookings Table */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-xl font-semibold">My Bookings</CardTitle>
              <CardDescription>
                {table.getFilteredRowModel().rows.length} of {currentViewData.length} booking{currentViewData.length !== 1 ? 's' : ''}
              </CardDescription>
            </div>

            {/* Search */}
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search bookings..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-9"
              />
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => setSearchQuery('')}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* View Type Tabs */}
          <Tabs value={viewType} onValueChange={(v) => setViewType(v as ViewType)} className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="upcoming" className="gap-2">
                <CalendarDays className="h-4 w-4" />
                Upcoming
                <Badge variant="count" className="ml-1">{upcomingBookings.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="past" className="gap-2">
                Past
                <Badge variant="count" className="ml-1">{pastBookings.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="all" className="gap-2">
                All
                <Badge variant="count" className="ml-1">{allBookings.length}</Badge>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Status Filter Pills & Column Visibility */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {(["all", "pending", "confirmed", "cancelled"] as FilterType[]).map((filter) => {
              const config = statusConfig[filter]
              return (
                <Button
                  key={filter}
                  variant={statusFilter === filter ? config.variant : "outline"}
                  size="sm"
                  onClick={() => setStatusFilter(filter)}
                  className={cn(
                    "h-8 text-xs font-medium",
                    statusFilter === filter && config.className
                  )}
                >
                  {filter.charAt(0).toUpperCase() + filter.slice(1)}
                  <span className="ml-1.5 opacity-70">({statusCounts[filter]})</span>
                </Button>
              )
            })}

            {/* Column Visibility Toggle */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 ml-auto">
                  Columns <ChevronDown className="ml-2 h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {table
                  .getAllColumns()
                  .filter((column) => column.getCanHide() && column.id !== 'actions')
                  .map((column) => (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      className="capitalize"
                      checked={column.getIsVisible()}
                      onCheckedChange={(value) => column.toggleVisibility(!!value)}
                    >
                      {column.id === 'kitchenName' ? 'Kitchen' : column.id === 'bookingDate' ? 'Date & Time' : column.id === 'totalPrice' ? 'Amount' : column.id === 'specialNotes' ? 'Notes' : column.id}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <Separator />

          {/* Table */}
          <div className="rounded-md border overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id} className="whitespace-nowrap text-xs sm:text-sm">
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="h-48 text-center">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <p className="text-sm text-muted-foreground">Loading bookings...</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : table.getRowModel().rows?.length ? (
                  table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      data-state={row.getIsSelected() && "selected"}
                      className={cn(
                        "hover:bg-muted/50",
                        row.original.status === "cancelled" && "opacity-60"
                      )}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className="py-3 text-xs sm:text-sm whitespace-nowrap">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="h-48 text-center">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Calendar className="h-8 w-8 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                          {viewType === "upcoming"
                            ? "No upcoming bookings found"
                            : viewType === "past"
                            ? "No past bookings to display"
                            : "No bookings match your current filters"}
                        </p>
                        {searchQuery && (
                          <Button variant="ghost" size="sm" onClick={() => setSearchQuery('')}>
                            Clear search
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground order-2 sm:order-1">
              Showing {table.getRowModel().rows.length} of {filteredData.length} results
            </div>
            <div className="flex items-center gap-2 order-1 sm:order-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Storage Bookings Section */}
      {storageBookings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Package className="h-5 w-5" />
              My Storage Bookings
            </CardTitle>
            <CardDescription>
              {storageTable.getFilteredRowModel().rows.length} of {storageBookings.length} storage booking{storageBookings.length !== 1 ? 's' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
              <Table>
                <TableHeader>
                  {storageTable.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <TableHead key={header.id} className="whitespace-nowrap text-xs sm:text-sm">
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {storageTable.getRowModel().rows?.length ? (
                    storageTable.getRowModel().rows.map((row) => (
                      <TableRow
                        key={row.id}
                        data-state={row.getIsSelected() && "selected"}
                        className="hover:bg-muted/50"
                      >
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id} className="py-3 text-xs sm:text-sm whitespace-nowrap">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={storageColumns.length} className="h-24 text-center">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <Package className="h-8 w-8 text-muted-foreground" />
                          <p className="text-sm text-muted-foreground">No storage bookings found</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Storage Pagination */}
            {storageBookings.length > 10 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground order-2 sm:order-1">
                  Showing {storageTable.getRowModel().rows.length} of {storageBookings.length} results
                </div>
                <div className="flex items-center gap-2 order-1 sm:order-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => storageTable.previousPage()}
                    disabled={!storageTable.getCanPreviousPage()}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => storageTable.nextPage()}
                    disabled={!storageTable.getCanNextPage()}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Extension Dialog */}
      {extendDialogOpen && storageBookings.find((sb: StorageBooking) => sb.id === extendDialogOpen) && (
        <StorageExtensionDialog
          booking={storageBookings.find((sb: StorageBooking) => sb.id === extendDialogOpen) as any}
          open={extendDialogOpen !== null}
          onOpenChange={(open) => !open && setExtendDialogOpen(null)}
          onSuccess={() => setExtendDialogOpen(null)}
        />
      )}

      {/* Storage Checkout Dialog */}
      {checkoutDialogOpen && (
        <StorageCheckoutDialog
          open={checkoutDialogOpen !== null}
          onOpenChange={(open) => !open && setCheckoutDialogOpen(null)}
          storageBooking={(storageBookings as StorageBooking[]).find((sb) => sb.id === checkoutDialogOpen) || {
            id: checkoutDialogOpen,
            storageName: 'Storage Unit',
            storageType: 'dry',
            endDate: new Date().toISOString(),
          }}
          onSuccess={() => setCheckoutDialogOpen(null)}
        />
      )}

      {/* Storage Check-In Dialog (move-in inspection baseline) */}
      {checkinDialogOpen && (
        <StorageCheckinDialog
          open={checkinDialogOpen !== null}
          onOpenChange={(open) => !open && setCheckinDialogOpen(null)}
          storageBooking={(storageBookings as StorageBooking[]).find((b) => b.id === checkinDialogOpen) || {
            id: checkinDialogOpen,
            storageName: 'Storage Unit',
            storageType: 'dry',
            startDate: new Date().toISOString(),
          }}
          onSuccess={() => setCheckinDialogOpen(null)}
        />
      )}

      {/* Checkout Status Tracker */}
      {checkoutStatusBookingId && (
        <CheckoutStatusTracker
          open={checkoutStatusBookingId !== null}
          onOpenChange={(open) => !open && setCheckoutStatusBookingId(null)}
          storageBookingId={checkoutStatusBookingId}
          storageName={(storageBookings as StorageBooking[]).find((sb) => sb.id === checkoutStatusBookingId)?.storageName}
          checkoutStatus={(storageBookings as StorageBooking[]).find((sb) => sb.id === checkoutStatusBookingId)?.checkoutStatus}
        />
      )}

      {/* Check-In Status Tracker (move-in inspection history) */}
      {checkinStatusBookingId && (
        <CheckinStatusTracker
          open={checkinStatusBookingId !== null}
          onOpenChange={(open) => !open && setCheckinStatusBookingId(null)}
          storageBookingId={checkinStatusBookingId}
          storageName={(storageBookings as StorageBooking[]).find((sb) => sb.id === checkinStatusBookingId)?.storageName}
          checkinStatus={(storageBookings as StorageBooking[]).find((sb) => sb.id === checkinStatusBookingId)?.checkinStatus}
        />
      )}

      {/* Kitchen Check-In / Checkout Tracker */}
      {checkinTrackerBookingId && (
        <KitchenCheckinTracker
          open={checkinTrackerBookingId !== null}
          onOpenChange={(open) => !open && setCheckinTrackerBookingId(null)}
          bookingId={checkinTrackerBookingId}
          kitchenName={(() => {
            const b = bookings.find(bk => bk.id === checkinTrackerBookingId)
            if (!b) return undefined
            return b.kitchenName || kitchens.find(k => k.id === b.kitchenId)?.name
          })()}
          bookingDate={bookings.find(bk => bk.id === checkinTrackerBookingId)?.bookingDate?.split('T')[0]}
          startTime={bookings.find(bk => bk.id === checkinTrackerBookingId)?.startTime}
          endTime={bookings.find(bk => bk.id === checkinTrackerBookingId)?.endTime}
        />
      )}

      {/* Cancellation Request / Confirm Sheet */}
      <CancellationRequestSheet
        open={cancellationTarget !== null}
        onOpenChange={(open) => { if (!open) setCancellationTarget(null) }}
        target={cancellationTarget}
        isPending={cancelStorageMutation.isPending}
        onConfirm={(id, reason) => {
          if (!cancellationTarget) return
          if (cancellationTarget.type === "storage") {
            cancelStorageMutation.mutate(
              { storageBookingId: id, reason },
              { onSettled: () => setCancellationTarget(null) },
            )
          } else {
            onCancelBooking(id, reason)
            setCancellationTarget(null)
          }
        }}
      />
    </div>
  )
}
