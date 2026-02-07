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
import { DEFAULT_TIMEZONE, isBookingPast } from "@/utils/timezone-utils"
import { useQuery } from "@tanstack/react-query"
import { StorageExtensionDialog } from "./StorageExtensionDialog"
import { StorageCheckoutDialog } from "./StorageCheckoutDialog"
import { CheckoutStatusTracker } from "./CheckoutStatusTracker"
import { ExpiringStorageNotification } from "./ExpiringStorageNotification"
import { PendingOverstayPenalties } from "../chef/PendingOverstayPenalties"
import { auth } from "@/lib/firebase"
import { onAuthStateChanged } from "firebase/auth"
import { format, differenceInDays } from "date-fns"
import { cn } from "@/lib/utils"

// Types
interface Booking {
  id: number
  chefId: number
  kitchenId: number
  bookingDate: string
  startTime: string
  endTime: string
  selectedSlots?: Array<string | { startTime: string; endTime: string }>
  status: "pending" | "confirmed" | "cancelled" | "completed"
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
}

interface StorageBooking {
  id: number
  storageListingId?: number
  kitchenBookingId?: number
  storageName?: string
  storageType?: string
  locationName?: string
  kitchenName?: string
  startDate: string
  endDate: string
  status: string
  checkoutStatus?: string
  checkoutRequestedAt?: string
  checkoutApprovedAt?: string
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
  onCancelBooking: (bookingId: number) => void
  kitchens?: Array<{ id: number; name: string; locationName?: string }>
}

type FilterType = "all" | "pending" | "confirmed" | "cancelled" | "completed"
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
    console.error('Error getting Firebase token:', error)
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
  if (booking.status === 'cancelled' || booking.status === 'completed') return false

  try {
    const dateStr = booking.bookingDate?.split('T')[0] || booking.bookingDate
    const bookingDateTime = new Date(`${dateStr}T${booking.startTime}`)

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

      if (status === 'confirmed') {
        variant = "default"
        icon = <CheckCircle className="h-3 w-3 mr-1" />
        className = "bg-green-600 hover:bg-green-700"
      } else if (status === 'cancelled') {
        variant = "destructive"
        icon = <XCircle className="h-3 w-3 mr-1" />
      } else {
        variant = "secondary"
        icon = <Clock className="h-3 w-3 mr-1" />
        className = "bg-yellow-100 text-yellow-800 border-yellow-300 hover:bg-yellow-200"
      }

      let timeBadge = null
      try {
        const dateStr = booking.bookingDate?.split('T')[0] || booking.bookingDate
        const bookingDateTime = new Date(`${dateStr}T${booking.startTime}`)
        if (!isNaN(bookingDateTime.getTime())) {
          const isUpcoming = bookingDateTime >= now
          if (isUpcoming && status !== 'cancelled') {
            timeBadge = (
              <span className="text-[10px] text-muted-foreground ml-1">
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

      return (
        <div className="flex flex-col gap-1">
          <div className="flex items-center">
            <Badge variant={variant} className={cn("capitalize items-center flex w-fit text-xs", className)}>
              {icon}
              {status}
            </Badge>
            {timeBadge}
          </div>
          {isVoided && (
            <div className="flex items-center gap-1 text-[10px] text-gray-600 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-200 w-fit">
              <XCircle className="h-2.5 w-2.5" />
              No charge
            </div>
          )}
          {isAuthHold && status === 'pending' && (
            <div className="flex items-center gap-1 text-[10px] text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200 w-fit">
              <Clock className="h-2.5 w-2.5" />
              Payment held
            </div>
          )}
          {/* Only show individual addon rejection badges when the booking itself was NOT fully voided.
              Full voided auth already communicates everything was rejected — individual badges would be redundant
              and misleading (implying kitchen was approved but specific addons were individually rejected). */}
          {!isVoided && rejectedStorageCount > 0 && (
            <div className="flex items-center gap-1 text-[10px] text-red-600 bg-red-50 px-1.5 py-0.5 rounded w-fit">
              <Package className="h-2.5 w-2.5" />
              {rejectedStorageCount} storage rejected
            </div>
          )}
          {!isVoided && rejectedEquipmentCount > 0 && (
            <div className="flex items-center gap-1 text-[10px] text-red-600 bg-red-50 px-1.5 py-0.5 rounded w-fit">
              <Package className="h-2.5 w-2.5" />
              {rejectedEquipmentCount} equipment rejected
            </div>
          )}
          {pendingStorageCount > 0 && status === 'confirmed' && (
            <div className="flex items-center gap-1 text-[10px] text-yellow-700 bg-yellow-50 px-1.5 py-0.5 rounded w-fit">
              <Package className="h-2.5 w-2.5" />
              {pendingStorageCount} storage pending
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
      const totalPrice = row.original.totalPrice
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
                  <div className="text-xs text-gray-500">Hold released</div>
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

            {showCancel && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onCancelBooking(booking.id)}
                  className="text-destructive focus:text-destructive"
                >
                  <Ban className="h-4 w-4 mr-2" />
                  Cancel Booking
                </DropdownMenuItem>
              </>
            )}
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
  onViewCheckoutStatus: (storageBookingId: number) => void
  downloadingInvoiceId: number | null
  now: Date
}

const getStorageBookingColumns = ({
  onExtend,
  onDownloadInvoice,
  onCheckout,
  onViewCheckoutStatus,
  downloadingInvoiceId,
  now,
}: StorageBookingColumnsProps): ColumnDef<StorageBooking>[] => [
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

      return (
        <div className="flex flex-col">
          <div className="flex items-center text-sm">
            <Calendar className="h-3 w-3 mr-2 text-muted-foreground" />
            {format(new Date(storageBooking.startDate), "MMM d")} - {format(endDate, "MMM d, yyyy")}
          </div>
          {isExpiringSoon && !isExpired && (
            <div className="text-xs text-amber-600 mt-0.5 ml-5">
              Expires in {daysUntilExpiry} day{daysUntilExpiry !== 1 ? 's' : ''}
            </div>
          )}
          {isExpired && (
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
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Claim Filed
          </Badge>
        )
      } else if (status === 'completed') {
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
            <CheckCircle className="h-3 w-3 mr-1" />
            Cleared
          </Badge>
        )
      // Cancelled bookings — genuinely rejected by manager
      } else if (status === 'cancelled') {
        return (
          <Badge variant="destructive" className="bg-red-100 text-red-800 border-red-300">
            <XCircle className="h-3 w-3 mr-1" />
            Rejected
          </Badge>
        )
      } else if (status === 'pending') {
        return (
          <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 border-yellow-300">
            <Clock className="h-3 w-3 mr-1" />
            Pending Approval
          </Badge>
        )
      } else if (status === 'confirmed' && checkoutStatus === 'checkout_requested') {
        return (
          <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">
            <Clock className="h-3 w-3 mr-1" />
            Checkout Under Review
          </Badge>
        )
      } else if (status === 'confirmed' && checkoutStatus === 'checkout_approved') {
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
            <CheckCircle className="h-3 w-3 mr-1" />
            Checkout Approved
          </Badge>
        )
      } else if (status === 'confirmed' && checkoutStatus === 'active') {
        return (
          <Badge variant="default" className="bg-green-600 hover:bg-green-700">
            <CheckCircle className="h-3 w-3 mr-1" />
            Active
          </Badge>
        )
      } else if (status === 'confirmed') {
        return (
          <Badge variant="default" className="bg-green-600 hover:bg-green-700">
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
      const canCheckout = storageBooking.checkoutStatus === 'active'

      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {isConfirmed && canCheckout && (
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
  const [checkoutStatusBookingId, setCheckoutStatusBookingId] = useState<number | null>(null)

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

      if (booking.status === 'cancelled') {
        past.push(booking)
        return
      }

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

    upcoming.sort((a, b) => {
      const dateStrA = a.bookingDate?.split('T')[0] || a.bookingDate
      const dateStrB = b.bookingDate?.split('T')[0] || b.bookingDate
      return new Date(`${dateStrA}T${a.startTime}`).getTime() - new Date(`${dateStrB}T${b.startTime}`).getTime()
    })

    past.sort((a, b) => {
      const dateStrA = a.bookingDate?.split('T')[0] || a.bookingDate
      const dateStrB = b.bookingDate?.split('T')[0] || b.bookingDate
      return new Date(`${dateStrB}T${b.startTime}`).getTime() - new Date(`${dateStrA}T${a.startTime}`).getTime()
    })

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

    // Search filter
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
        ].join(' ').toLowerCase()
        return searchableText.includes(query)
      })
    }

    return filtered
  }, [currentViewData, statusFilter, searchQuery, kitchens])

  // Status counts for current view
  const statusCounts = useMemo(() => {
    const counts = { all: 0, pending: 0, confirmed: 0, cancelled: 0, completed: 0 }
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

  // Handle cancel with policy check
  const handleCancel = (bookingId: number) => {
    const booking = bookings.find(b => b.id === bookingId)
    if (!booking) return

    const dateStr = booking.bookingDate.split('T')[0]
    const bookingDateTime = new Date(`${dateStr}T${booking.startTime}`)

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

    if (window.confirm("Are you sure you want to cancel this booking? This action cannot be undone.")) {
      onCancelBooking(bookingId)
    }
  }

  // Table columns
  const columns = useMemo(
    () => getChefBookingColumns({
      onCancelBooking: handleCancel,
      onDownloadInvoice: handleDownloadInvoice,
      onNavigate: navigate,
      downloadingInvoiceId,
      now,
      kitchens,
      storageBookings: storageBookings as StorageBooking[],
      equipmentBookings: equipmentBookings as EquipmentBooking[],
    }),
    [downloadingInvoiceId, now, kitchens, navigate, storageBookings, equipmentBookings]
  )

  // Storage table columns
  const storageColumns = useMemo(
    () => getStorageBookingColumns({
      onExtend: (id) => setExtendDialogOpen(id),
      onDownloadInvoice: handleDownloadStorageInvoice,
      onCheckout: (id) => setCheckoutDialogOpen(id),
      onViewCheckoutStatus: (id) => setCheckoutStatusBookingId(id),
      downloadingInvoiceId,
      now,
    }),
    [downloadingInvoiceId, now]
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
  }

  return (
    <div className="space-y-6">
      {/* Pending Overstay Penalties */}
      <PendingOverstayPenalties />

      {/* Expiring Storage Notifications */}
      <ExpiringStorageNotification />

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
                <Badge variant="secondary" className="ml-1">{upcomingBookings.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="past" className="gap-2">
                Past
                <Badge variant="secondary" className="ml-1">{pastBookings.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="all" className="gap-2">
                All
                <Badge variant="secondary" className="ml-1">{allBookings.length}</Badge>
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
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id} className="whitespace-nowrap">
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
                        <TableCell key={cell.id} className="py-3">
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
          <div className="flex items-center justify-between">
            <div className="flex-1 text-sm text-muted-foreground">
              Showing {table.getRowModel().rows.length} of {filteredData.length} results
            </div>
            <div className="flex items-center space-x-2">
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
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  {storageTable.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <TableHead key={header.id} className="whitespace-nowrap">
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
                          <TableCell key={cell.id} className="py-3">
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
              <div className="flex items-center justify-between">
                <div className="flex-1 text-sm text-muted-foreground">
                  Showing {storageTable.getRowModel().rows.length} of {storageBookings.length} results
                </div>
                <div className="flex items-center space-x-2">
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
    </div>
  )
}
