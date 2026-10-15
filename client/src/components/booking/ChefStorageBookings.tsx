/**
 * The chef's storage bookings (move-in, move-out, extension, cancellation), shown under the kitchen bookings list.
 * Moved out of ChefBookingsView unchanged in behaviour: storage becomes its own product after the booking redesign
 * (design-booking-consolidation.md §2.8), so it keeps its existing table until then.
 */
import { ct } from '@/i18n/chef-ns';
import { StorageIcon as Package } from "@/components/ui/inventory-icons";
import { logger } from "@/lib/logger";
import { useState, useMemo, useEffect } from "react"
import { ColumnDef, flexRender, getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from "@tanstack/react-table"
import { Calendar, Clock, MapPin, CheckCircle, XCircle, ArrowUpDown, Loader2, MoreHorizontal, Eye, Download, AlertTriangle, CalendarPlus, LogIn, LogOut } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { InfoChip } from "@/components/chef/info-chip"
import { useTranslation } from "react-i18next"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { StorageExtensionDialog } from "./StorageExtensionDialog"
import { StorageCheckoutDialog } from "./StorageCheckoutDialog"
import { StorageCheckinDialog } from "./StorageCheckinDialog"
import { CheckoutStatusTracker } from "./CheckoutStatusTracker"
import { CheckinStatusTracker } from "./CheckinStatusTracker"
import { CancellationRequestDialog, type CancellationTarget } from "./CancellationRequestDialog"
import { auth } from "@/lib/firebase"
import { onAuthStateChanged } from "firebase/auth"
import { format, differenceInDays } from "date-fns"
import { tt } from "@/i18n/common-ns";
import { bt } from "@/i18n/booking-ns";

/** The parent kitchen booking facts the storage status needs (a declined add-on vs an expired request). */
type KitchenBookingRef = { id: number; status: string; paymentStatus?: string }

interface StorageBooking {
  cancellationAcceptedAt?: string | null
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
  storageCheckinEnabled?: boolean
  storageCheckoutEnabled?: boolean
}

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

type LooseTFunction = (key: string, options?: Record<string, unknown>) => string

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
  kitchenBookings: KitchenBookingRef[]
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
  t,
}: StorageBookingColumnsProps & { t: LooseTFunction }): ColumnDef<StorageBooking>[] => [
  {
    id: "reference",
    header: t("bkColRef"),
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
        {t("bkColStorage")}
        <ArrowUpDown className="ml-2 h-3 w-3" />
      </Button>
    ),
    cell: ({ row }) => {
      const storageBooking = row.original
      return (
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <Package className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="font-medium text-sm">{storageBooking.storageName ||
              t("sxDefaultUnitName")}</span>
          </div>
          <div className="flex items-center text-xs text-muted-foreground mt-0.5 ml-5">
            <MapPin className="h-3 w-3 mr-1" />
            <span>{storageBooking.locationName || t("bkUnknownLocation")}</span>
          </div>
        </div>
      )
    },
  },
  {
    accessorKey: "storageType",
    header: t("bkColType"),
    cell: ({ row }) => {
      const storageType = row.getValue("storageType") as string
      return (
        <InfoChip variant="outline" className="capitalize">
          {storageType || 'Standard'}
        </InfoChip>
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
        {t("bkColPeriod")}
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
            <div className="text-xs text-muted-foreground mt-0.5 ml-5">
              {t("bkExpiresIn", { count: daysUntilExpiry })}
            </div>
          )}
          {isActive && isExpired && (
            <div className="text-xs text-destructive mt-0.5 ml-5">
              {t("bkExpiredAgo", { count: Math.abs(daysUntilExpiry) })}
            </div>
          )}
        </div>
      )
    },
  },
  {
    accessorKey: "status",
    header: t("bkColStatus"),
    cell: ({ row }) => {
      const storageBooking = row.original
      const status = storageBooking.status
      const checkoutStatus = storageBooking.checkoutStatus

      // Completed bookings — checkout cleared or claim filed
      if (status === 'completed' && checkoutStatus === 'checkout_claim_filed') {
        return (
          <InfoChip variant="warning" icon={<AlertTriangle className="h-3 w-3" />}>
            {t("bkClaimFiled")}
          </InfoChip>
        )
      } else if (status === 'completed') {
        return (
          <InfoChip variant="success" icon={<CheckCircle className="h-3 w-3" />}>
            {t("bkCleared")}
          </InfoChip>
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
            <InfoChip variant="destructive" icon={<XCircle className="h-3 w-3" />}>{ct('sweepLabel19')}</InfoChip>
          )
        }
        // Payment auth expired or failed — never charged
        return (
          <InfoChip variant="outline" icon={<Clock className="h-3 w-3" />}>{ct('sweepLabel08')}</InfoChip>
        )
      } else if (status === 'cancelled' && storageBooking.cancellationRequestedAt) {
        // Chef requested cancellation, manager accepted
        return (
          <InfoChip variant="outline" icon={<XCircle className="h-3 w-3" />}>
            {t("bkStatusCancelled")}
          </InfoChip>
        )
      } else if (status === 'cancelled' && storageBooking.paymentStatus === 'refunded') {
        // Cancelled and fully refunded
        return (
          <InfoChip variant="outline" icon={<XCircle className="h-3 w-3" />}>
            {t("bkStatusRefunded")}
          </InfoChip>
        )
      } else if (status === 'cancelled') {
        // Manager declined the booking (no chef cancellation request, payment was paid)
        return (
          <InfoChip variant="destructive" icon={<XCircle className="h-3 w-3" />}>
            {t("bkStatusDeclined")}
          </InfoChip>
        )
      } else if (status === 'cancellation_requested') {
        return (
          <InfoChip variant="warning" icon={<Clock className="h-3 w-3" />}>
            {t("bkStatusCancellationPending")}
          </InfoChip>
        )
      } else if (status === 'pending') {
        return (
          <InfoChip variant="warning" icon={<Clock className="h-3 w-3" />}>
            {t("bkStatusPendingApproval")}
          </InfoChip>
        )
      } else if (status === 'confirmed' && checkoutStatus === 'checkout_requested') {
        return (
          <InfoChip variant="warning" icon={<Clock className="h-3 w-3" />}>
            {t("bkCheckoutUnderReview")}
          </InfoChip>
        )
      } else if (status === 'confirmed' && checkoutStatus === 'checkout_approved') {
        return (
          <InfoChip variant="success" icon={<CheckCircle className="h-3 w-3" />}>
            {t("bkCheckoutApproved")}
          </InfoChip>
        )
      } else if (status === 'confirmed' && checkoutStatus === 'active') {
        return (
          <InfoChip variant="success" icon={<CheckCircle className="h-3 w-3" />}>
            {t("bkActive")}
          </InfoChip>
        )
      } else if (status === 'confirmed') {
        return (
          <InfoChip variant="success" icon={<CheckCircle className="h-3 w-3" />}>
            {t("bkStatusConfirmed")}
          </InfoChip>
        )
      }
      return (
        <InfoChip variant="outline" className="capitalize">
          {status}
        </InfoChip>
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
      const checkoutStatusActive = !storageBooking.checkoutStatus || storageBooking.checkoutStatus === 'active'
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
        !checkinCompleted &&
        storageBooking.storageCheckinEnabled === true

      // Storage Check-Out: only available AFTER check-in is completed.
      // You cannot check out of a storage unit you haven't checked into.
      const canCheckout = checkoutStatusActive && (
        Boolean(storageBooking.cancellationAcceptedAt) ||
        (isConfirmed && hasStarted && (checkinCompleted || storageBooking.storageCheckinEnabled !== true))
      )

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
                {t("bkExtendStorage")}
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
              {t("bkDownloadInvoice")}
            </DropdownMenuItem>

            {canCheckin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onCheckin(storageBooking.id)}>
                  <LogIn className="h-4 w-4 mr-2" />
                  {t("bkCheckIn")}
                </DropdownMenuItem>
              </>
            )}

            {checkinCompleted && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onViewCheckinStatus(storageBooking.id)}>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  {t("bkViewCheckinHistory")}
                </DropdownMenuItem>
              </>
            )}

            {canCheckout && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onCheckout(storageBooking.id)}>
                  <LogOut className="h-4 w-4 mr-2" />
                  {t("bkRequestCheckout")}
                </DropdownMenuItem>
              </>
            )}

            {storageBooking.checkoutStatus && storageBooking.checkoutStatus !== 'active' && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onViewCheckoutStatus(storageBooking.id)}>
                  <Eye className="h-4 w-4 mr-2" />
                  {t("bkViewCheckoutStatus")}
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
                    className={isConfirmedPaid ? "text-warning focus:text-warning" : "text-destructive focus:text-destructive"}
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    {isConfirmedPaid ? t("bkRequestCancellation") : t("bkCancelStorage")}
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

export function ChefStorageBookings({ kitchenBookings }: { kitchenBookings: KitchenBookingRef[] }) {
  const { t: tStrict } = useTranslation("chef")
  const t = tStrict as unknown as (key: string, options?: Record<string, unknown>) => string
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState<number | null>(null)
  const [extendDialogOpen, setExtendDialogOpen] = useState<number | null>(null)
  const [checkoutDialogOpen, setCheckoutDialogOpen] = useState<number | null>(null)
  const [checkinDialogOpen, setCheckinDialogOpen] = useState<number | null>(null)
  const [checkoutStatusBookingId, setCheckoutStatusBookingId] = useState<number | null>(null)
  const [checkinStatusBookingId, setCheckinStatusBookingId] = useState<number | null>(null)
  const [cancellationTarget, setCancellationTarget] = useState<CancellationTarget | null>(null)

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
      if (!response.ok) throw new Error(tt("failedToFetchStorageBookings"))
      return response.json()
    },
  })

  const now = useMemo(() => new Date(), [])

  // Handle storage invoice download
  const handleDownloadStorageInvoice = async (storageBookingId: number) => {
    setDownloadingInvoiceId(storageBookingId)
    try {
      const currentUser = auth.currentUser
      if (!currentUser) {
        toast.error(t("bkLoginToDownload"))
        setDownloadingInvoiceId(null)
        return
      }

      const token = await currentUser.getIdToken()
      const response = await fetch(`/api/chef/invoices/storage/${storageBookingId}`, {
        credentials: 'include',
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (!response.ok) {
        let errorMessage = ct('sweepText00')
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

      toast.success(t("bkStorageInvoiceDownloaded"))
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t("bkInvoiceFailed")
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
        throw new Error(err.error || ct('sweepText16'))
      }
      return response.json()
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/chef/storage-bookings'] })
      if (data?.action === 'cancellation_requested') {
        toast.success(bt('cancellationRequestSent'))
      } else {
        toast.success(bt('storageBookingCancelled'))
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
      kitchenBookings,
      t,
    }),
    [downloadingInvoiceId, now, storageBookings, kitchenBookings, t]
  )

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

  const needsStorageCheckin = useMemo(() => {
    const now = new Date()
    const todayStr = now.toISOString().split('T')[0]
    return (storageBookings as StorageBooking[]).filter(sb => {
      if (sb.status !== 'confirmed') return false
      // Explicit opt-in only — missing/null means disabled
      if (sb.storageCheckinEnabled !== true) return false
      if (sb.checkinStatus && sb.checkinStatus !== 'not_checked_in') return false
      const sd = String(sb.startDate).split('T')[0]
      return sd <= todayStr // Start date is today or earlier
    })
  }, [storageBookings])

  const needsStorageCheckout = useMemo(() => {
    return (storageBookings as StorageBooking[]).filter(sb => {
      const active = !sb.checkoutStatus || sb.checkoutStatus === 'active'
      if (sb.cancellationAcceptedAt) return active
      return sb.status === 'confirmed' && new Date(sb.startDate) <= new Date() && (sb.checkinStatus === 'checkin_completed' || sb.storageCheckinEnabled !== true) && active
    })
  }, [storageBookings])

  if (!storageBookings.length) return null

  return (
    <div className="space-y-4">
      {/* ── Storage Check-In Action Banner (only when not checked in) ──── */}
      {needsStorageCheckin.length > 0 && (
        <div className="rounded-[1.35rem] border p-4">
          <div className="flex items-start gap-3">
            <Package className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold">
                {needsStorageCheckin.length === 1
                  ? t("sbMoveInDue")
                  : t("sbUnitsNeedCheckin", { count: needsStorageCheckin.length })}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                {t("sbMoveInBody")}
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                {needsStorageCheckin.map(sb => (
                  <Button
                    key={`checkin-${sb.id}`}
                    size="sm"
                    className="max-w-full whitespace-normal text-left"
                    onClick={() => setCheckinDialogOpen(sb.id)}
                  >
                    <LogIn className="h-3.5 w-3.5 mr-1.5" />{t("bkCheckIn")} — {sb.storageName || `Storage #${sb.id}`}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Storage Check-Out Action Banner (only after check-in completed) ── */}
      {needsStorageCheckout.length > 0 && (
        <div className="rounded-[1.35rem] border p-4">
          <div className="flex items-start gap-3">
            <LogOut className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold">
                {needsStorageCheckout.length === 1
                  ? t("bkReadyToMoveOut")
                  : t("bkStorageReadyCheckout", { count: needsStorageCheckout.length })}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                {t("bkMoveOutBannerBody")}
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                {needsStorageCheckout.map(sb => (
                  <Button
                    key={`checkout-${sb.id}`}
                    size="sm"
                    variant="outline"
                    className="max-w-full whitespace-normal text-left"
                    onClick={() => setCheckoutDialogOpen(sb.id)}
                  >
                    <LogOut className="h-3.5 w-3.5 mr-1.5" />
                    {t("bkCheckoutAction", { name: sb.storageName || `Storage #${sb.id}` })}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Storage Bookings Section */}
      {storageBookings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Package className="h-5 w-5" />
              {t("bkMyStorageTitle")}
            </CardTitle>
            <CardDescription>
              {t("bkStorageCount", {
                shown: storageTable.getFilteredRowModel().rows.length,
                total: storageBookings.length,
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
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
                          <p className="text-sm text-muted-foreground">{t("bkNoStorageFound")}</p>
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
                  {t("bkShowingResults", { shown: storageTable.getRowModel().rows.length, total: storageBookings.length })}
                </div>
                <div className="flex items-center gap-2 order-1 sm:order-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => storageTable.previousPage()}
                    disabled={!storageTable.getCanPreviousPage()}
                  >
                    {t("bkPrevPage")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => storageTable.nextPage()}
                    disabled={!storageTable.getCanNextPage()}
                  >
                    {t("bkNextPage")}
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

      {/* Storage cancellation (request or confirm) */}
      <CancellationRequestDialog
        open={cancellationTarget !== null}
        onOpenChange={(open) => { if (!open) setCancellationTarget(null) }}
        target={cancellationTarget}
        isPending={cancelStorageMutation.isPending}
        onConfirm={(id, reason) => {
          if (!cancellationTarget) return
          cancelStorageMutation.mutate(
            { storageBookingId: id, reason },
            { onSettled: () => setCancellationTarget(null) },
          )
        }}
      />
    </div>
  )
}
