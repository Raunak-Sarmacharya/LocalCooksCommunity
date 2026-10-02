/**
 * ViewingsDashboard
 *
 * Manager-facing dashboard for viewing and managing all kitchen viewing bookings.
 * Shows upcoming and past viewings with intake data, status controls, and no-show tracking.
 * Built mobile-first with shadcn/ui components.
 */

import { useState, useEffect, useRef } from "react"
import { useSearch } from "wouter"
import type { ColumnDef } from "@tanstack/react-table"
import { mt } from "@/i18n/manager"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { KitchenTour, Clock, User, Loader2, CheckCircle, XCircle, AlertTriangle, Calendar, MapPin, Briefcase, FileText, Mail, Phone, Search, X } from "@/components/ui/manager-icons"
import { toast } from "sonner"
import { auth } from "@/lib/firebase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/ui/data-table"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { AppDialogContent, AppDialogHeader } from "@/components/ui/app-dialog";
import { UnsavedChangesDialog } from "@/components/manager/UnsavedChangesDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { formatTourDate, formatTourClock } from "@shared/tour-time"
import type { TourBookingOverlap } from "@shared/tour-booking-overlap"
import { isPendingOrUpcomingTour } from "@/lib/chef-viewing-display"
import { useTourClock } from "@/hooks/use-tour-clock"
import { hasTourConfirmation, tourDisruptionReasons } from '@shared/tour-outcome'
import { formatTourWhen } from "@/lib/chef-viewing-display"

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

// ─── Types ────────────────────────────────────────────────────────────────────

interface TourDecisionContext { updatedAt: string; scheduledAt: string; overlapReviewKey: string; overlaps: TourBookingOverlap[] }

interface ViewingRecord {
  viewing: {
    id: number
    locationId: number
    targetedKitchenId: number | null
    chefId: number
    managerId: number | null
    status: string
    scheduledAt: string
    durationMinutes: number
    chefNotes: string | null
    sharedManagerNotes: string | null
    disruptionReason: string | null
    outcomeHistory?: Array<{ from: string; to: string; actorRole: string; recordedAt: string; sharedNotes?: string | null }>
    noShowReason: string | null
    intakeData: Record<string, any>
    cancelledBy: string | null
    adminReviewDecision: string | null
    cancellationReason: string | null
    cancelledAt: string | null
    completedAt: string | null
    createdAt: string
    updatedAt: string
    requestedRescheduleAt: string | null
  }
  locationName: string | null
  locationAddress: string | null
  locationTimezone: string | null
  kitchenName: string | null
  chefUsername: string | null
  chefEmail: string | null
  chefPhone: string | null
  chefName?: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getStatusBadge(status: string, cancelledBy?: string | null, adminReviewDecision?: string | null, disruptionReason?: string | null) {
  if (disruptionReason) return <Badge variant="destructive">{mt('tourDisrupted')}</Badge>
  if (status === "cancelled" && (cancelledBy === "manager_declined" || adminReviewDecision === "denied")) {
    return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />{mt("rejected")}</Badge>
  }
  switch (status) {
    case "confirmed":
      return (
        <Badge variant="success">
          <CheckCircle className="h-3 w-3 mr-1" />{mt("confirmed")}</Badge>
      )
    case "pending":
      return (
        <Badge variant="warning">
          <Clock className="h-3 w-3 mr-1" />{mt("pending")}</Badge>
      )
    case "cancelled":
      return (
        <Badge variant="secondary">
          <XCircle className="h-3 w-3 mr-1" />{mt("cancelled")}</Badge>
      )
    case "completed":
      return (
        <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">
          <CheckCircle className="h-3 w-3 mr-1" />{mt("completed")}</Badge>
      )
    case "no_show":
      return (
        <Badge variant="destructive">
          <AlertTriangle className="h-3 w-3 mr-1" />{mt("noShow")}</Badge>
      )
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function getIntakeLabel(key: string): string {
  const labels: Record<string, string> = {
    intendedUse: mt("viewingIntakeIntendedUse"),
    estimatedWeeklyHours: mt("viewingIntakeWeeklyHours"),
    hasLicense: mt("viewingIntakeHasLicense"),
    targetStartDate: mt("viewingIntakeTargetStart"),
    additionalInfo: mt("viewingIntakeNotes"),
  }
  return labels[key] || key
}

function canReviewReschedule(viewing: ViewingRecord["viewing"]): boolean {
  return viewing.status === "confirmed" && !!viewing.requestedRescheduleAt && new Date(viewing.scheduledAt).getTime() > Date.now()
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ViewingsDashboardProps {
  locationId?: number
  onConfigureTours?: () => void
  hasKitchen?: boolean
}

export function ViewingsDashboard({ locationId, onConfigureTours, hasKitchen = true }: ViewingsDashboardProps) {
  useTourClock()
  
  const queryClient = useQueryClient()
  const [selectedViewing, setSelectedViewing] = useState<ViewingRecord | null>(null)
  const [statusAction, setStatusAction] = useState<string>("")
  const [managerNotes, setManagerNotes] = useState("")
  const [noShowReason, setNoShowReason] = useState("")
  const [disruptionReason, setDisruptionReason] = useState("")
  const [cancellationReason, setCancellationReason] = useState("")
  const [acceptBookingOverlap, setAcceptBookingOverlap] = useState(false)
  const [confirmExit, setConfirmExit] = useState(false)
  const [statusFilter, setStatusFilter] = useState("all")
  const [searchQuery, setSearchQuery] = useState("")
  const openedDeepLink = useRef<string | null>(null)
  const tourSearch = useSearch()

  // Fetch viewings
  const queryUrl = locationId
    ? `/api/viewings/manager?locationId=${locationId}`
    : `/api/viewings/manager`

  const { data: viewings, isLoading, isError, refetch } = useQuery<ViewingRecord[]>({
    queryKey: [queryUrl],
    refetchInterval: 30000, // Poll every 30s
    refetchOnWindowFocus: true,
  })
  useEffect(() => {
    const id = new URLSearchParams(tourSearch).get("viewing")
    if (!id) { openedDeepLink.current = null; return }
    if (openedDeepLink.current === id) return
    const record = viewings?.find((item) => item.viewing.id === Number(id))
    if (!record) return
    openedDeepLink.current = id
    setSelectedViewing(record)
    setStatusAction("view")
    setManagerNotes(record.viewing.sharedManagerNotes ?? "")
  }, [viewings, tourSearch])
  useEffect(() => {
    setSelectedViewing(current => current
      ? viewings?.find(record => record.viewing.id === current.viewing.id) ?? current
      : null)
  }, [viewings])

  const correctingOutcome = !!selectedViewing && (["completed", "no_show"].includes(selectedViewing.viewing.status) || !!selectedViewing.viewing.disruptionReason)
  const outcomeEligible = !!selectedViewing && hasTourConfirmation(selectedViewing.viewing)
    && (['confirmed', 'completed', 'no_show'].includes(selectedViewing.viewing.status) || !!selectedViewing.viewing.disruptionReason)
    && new Date(selectedViewing.viewing.scheduledAt).getTime() + selectedViewing.viewing.durationMinutes * 60_000 <= Date.now()

  const decisionKind = selectedViewing && canReviewReschedule(selectedViewing.viewing)
    ? "reschedule" : statusAction === "confirm" ? "confirm" : null
  const { data: decisionContext, isFetching: contextLoading, error: contextError, refetch: refetchContext } = useQuery<TourDecisionContext>({
    queryKey: ["tour-decision-context", selectedViewing?.viewing.id, selectedViewing?.viewing.updatedAt, decisionKind],
    enabled: !!selectedViewing && !!decisionKind,
    queryFn: async () => {
      const response = await fetch(`/api/viewings/manager/${selectedViewing!.viewing.id}/decision-context?kind=${decisionKind}`, { headers: await getAuthHeaders() })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || mt("tourDecisionContextError"))
      return body
    },
    refetchInterval: 30_000,
  })
  useEffect(() => { setAcceptBookingOverlap(false) }, [selectedViewing?.viewing.id, selectedViewing?.viewing.updatedAt, decisionContext?.overlapReviewKey, decisionKind])
  const acceptanceReady = !!decisionContext && decisionContext.updatedAt === selectedViewing?.viewing.updatedAt
    && !contextLoading && !contextError && (!decisionContext.overlaps.length || acceptBookingOverlap)
  const decisionReview = () => ({ expectedUpdatedAt: selectedViewing?.viewing.updatedAt,
    overlapReviewKey: decisionContext?.overlapReviewKey, acceptBookingOverlap })
  const decisionError = (error: Error & { status?: number }) => {
    toast.error(error.message)
    if (error.status === 409) {
      setAcceptBookingOverlap(false)
      queryClient.invalidateQueries({ queryKey: [queryUrl] })
      queryClient.invalidateQueries({ queryKey: ["tour-decision-context"] })
    }
  }
  const reviewReschedule = useMutation({
    mutationFn: async ({ id, decision }: { id: number; decision: "accept" | "decline" }) => {
      const response = await fetch(`/api/viewings/manager/${id}/reschedule`, { method: "PATCH", headers: await getAuthHeaders(), body: JSON.stringify({ decision, ...decisionReview() }) })
      const body = await response.json()
      if (!response.ok) throw Object.assign(new Error(body.error || mt("tourDecisionFailed")), { status: response.status })
      return body
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [queryUrl] })
      queryClient.invalidateQueries({ queryKey: ["tour-decision-context"] })
      closeDialog()
      if (data.notificationDeliveryFailed) toast.warning(mt("tourSavedDeliveryFailed"))
      else toast.success(mt("tourDateChangeReviewed"))
    },
    onError: decisionError,
  })

  // Status update mutation
  const updateStatusMutation = useMutation({
    mutationFn: async ({
      viewingId,
      status,
      notes,
      noShow,
      cancelReason,
    }: {
      viewingId: number
      status: string
      notes?: string
      noShow?: string
      cancelReason?: string
    }) => {
      const headers = await getAuthHeaders()
      const response = await fetch(`/api/viewings/${viewingId}/status`, {
        method: "PATCH",
        headers,
        credentials: "include",
        body: JSON.stringify({
          status,
          sharedManagerNotes: notes?.trim() || undefined,
          disruptionReason: statusAction === "disrupt" ? disruptionReason : undefined,
          noShowReason: noShow || undefined,
          cancellationReason: cancelReason || undefined,
          ...decisionReview(),
          cancelledBy: status === "cancelled" ? "manager" : undefined,
        }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw Object.assign(new Error(err.error || mt("viewingStatusUpdateFailed")), { status: response.status })
      }
      return response.json()
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<ViewingRecord[]>([queryUrl], (current = []) =>
        current.map((record) => record.viewing.id === updated.id
          ? { ...record, viewing: { ...record.viewing, ...updated } }
          : record)
      )
      queryClient.invalidateQueries({ queryKey: [queryUrl] })
      closeDialog()
      queryClient.invalidateQueries({ queryKey: ["tour-decision-context"] })
      if (updated.notificationDeliveryFailed) toast.warning(mt("tourSavedDeliveryFailed"))
      else toast.success(mt("viewingStatusUpdated"))
    },
    onError: decisionError,
  })

  const closeDialog = () => {
    setSelectedViewing(null)
    setStatusAction("")
    setManagerNotes("")
    setNoShowReason("")
    setDisruptionReason("")
    setCancellationReason("")
    setAcceptBookingOverlap(false)
  }

  const requestClose = () => {
    const hasUnsavedInput = managerNotes !== (selectedViewing?.viewing.sharedManagerNotes || "") || !!noShowReason || !!disruptionReason || !!cancellationReason.trim()
    if (hasUnsavedInput) setConfirmExit(true)
    else closeDialog()
  }

  const handleStatusAction = (viewing: ViewingRecord, action: string) => {
    setSelectedViewing(viewing)
    setStatusAction(action)
    setManagerNotes(viewing.viewing.sharedManagerNotes || "")
  }

  // Split viewings into upcoming/past
  const upcoming =
    viewings?.filter(
      (v) =>
        isPendingOrUpcomingTour(v.viewing)
    ).sort((a, b) => new Date(a.viewing.scheduledAt).getTime() - new Date(b.viewing.scheduledAt).getTime()) || []

  const past =
    viewings?.filter(
      (v) =>
        !isPendingOrUpcomingTour(v.viewing)
    ).sort((a, b) => new Date(b.viewing.updatedAt).getTime() - new Date(a.viewing.updatedAt).getTime()) || []

  const allTours = [...upcoming, ...past]
  const filterOptions = [
    { key: "all", label: mt("filterAll"), count: allTours.length },
    { key: "upcoming", label: mt("upcoming"), count: upcoming.length },
    { key: "past", label: mt("past"), count: past.length },
    { key: "pending", label: mt("pending"), count: allTours.filter((row) => row.viewing.status === "pending").length },
    { key: "confirmed", label: mt("confirmed"), count: allTours.filter((row) => row.viewing.status === "confirmed").length },
  ]
  const filteredTours = allTours.filter((record) => {
    if (statusFilter === "upcoming" && !upcoming.includes(record)) return false
    if (statusFilter === "past" && !past.includes(record)) return false
    if (statusFilter !== "all" && statusFilter !== "upcoming" && statusFilter !== "past" && record.viewing.status !== statusFilter) return false
    const query = searchQuery.trim().toLowerCase()
    return !query || [record.viewing.id, `TOUR-${record.viewing.id}`, record.chefName, record.chefUsername, record.chefEmail, record.kitchenName, record.locationName]
      .join(" ").toLowerCase().includes(query)
  })
  const columns: ColumnDef<ViewingRecord>[] = [
    { id: "scheduledAt", accessorFn: (row) => row.viewing.scheduledAt, header: mt("dateTime"), cell: ({ row }) => <div><div className="font-medium">{formatTourDate(new Date(row.original.viewing.scheduledAt))}</div><div className="text-xs text-muted-foreground">{formatTourClock(new Date(row.original.viewing.scheduledAt))} · {mt("minutesShort", { count: row.original.viewing.durationMinutes })}</div></div> },
    { id: "chef", header: mt("chef"), cell: ({ row }) => <div><div className="flex items-center gap-1.5"><User className="h-3.5 w-3.5 text-muted-foreground" />{row.original.chefName || row.original.chefUsername?.split("@")[0] || `Chef #${row.original.viewing.chefId}`}</div>{Object.keys(row.original.viewing.intakeData || {}).length > 0 && <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><FileText className="h-3 w-3" />{mt("hasIntakeData")}</div>}</div> },
    { id: "kitchen", header: mt("navLocation"), cell: ({ row }) => <div><div>{row.original.locationName || "—"}</div><div className="text-xs text-muted-foreground">{row.original.kitchenName}</div></div> },
    { id: "status", header: mt("status"), cell: ({ row }) => <div className="flex flex-col items-start gap-1">{row.original.viewing.status === "pending" && new Date(row.original.viewing.scheduledAt).getTime() < Date.now() ? <Badge variant="secondary">Request expired</Badge> : getStatusBadge(row.original.viewing.status, row.original.viewing.cancelledBy, row.original.viewing.adminReviewDecision, row.original.viewing.disruptionReason)}{row.original.viewing.requestedRescheduleAt && <Badge variant="outline">Date change requested</Badge>}</div> },
    { id: "actions", header: "", meta: { mobileHidden: true }, cell: ({ row }) => <Button variant="outline" size="sm" onClick={() => handleStatusAction(row.original, "view")}>{mt("viewDetails")}</Button> },
  ]

  return (
    <>
      <div className="space-y-6">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-md">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={mt("searchKitchenTours")} className="pl-9 pr-8" />
            {searchQuery && <Button variant="ghost" size="icon" className="absolute right-0 top-1/2 h-7 w-7 -translate-y-1/2" onClick={() => setSearchQuery("")} aria-label={mt("clearSearch")}><X className="h-3 w-3" /></Button>}
          </div>
        </div>
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {filterOptions.map((filter) => <button key={filter.key} type="button" onClick={() => setStatusFilter(filter.key)} aria-pressed={statusFilter === filter.key} className={statusFilter === filter.key ? "rounded-xl border border-primary bg-primary/[0.04] p-4 text-left transition-colors" : "rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/30"}><p className="text-xs text-muted-foreground">{filter.label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{filter.count}</p></button>)}
        </div>
          {isLoading ? (
            <div className="space-y-3" role="status" aria-label="Loading kitchen tours">
              <Skeleton className="h-11 w-full rounded-xl" />
              {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-14 w-full rounded-xl" />)}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-sm text-destructive">{mt("overviewActivityError")}</p>
              <Button variant="outline" size="sm" onClick={() => void refetch()}>{mt("retry")}</Button>
            </div>
          ) : viewings?.length === 0 ? (
            <Card><CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <KitchenTour className="size-7 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">{mt("noUpcomingViewings")}</p>
              {onConfigureTours && <Button size="sm" onClick={onConfigureTours}>
                {mt(hasKitchen ? "tourSetupTitle" : "addYourKitchen")}
              </Button>}
            </CardContent></Card>
          ) : (
            <DataTable columns={columns} data={filteredTours} defaultSorting={[{ id: "scheduledAt", desc: true }]} pageSize={15} onRowClick={(record) => handleStatusAction(record, "view")} />
          )}
      </div>

      {/* Detail / Action Dialog */}
      <Dialog open={selectedViewing !== null} onOpenChange={(open) => !open && requestClose()}>
        <AppDialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl">
          {selectedViewing && (
            <>
              <AppDialogHeader
                icon={<Calendar className="h-5 w-5" />}
                title={statusAction === "view" ? mt("sheetViewingDetails") : statusAction === "confirm" ? mt("sheetConfirmViewingRequest") : statusAction === "complete" ? mt("sheetMarkAsCompleted") : statusAction === "no_show" ? mt("sheetMarkAsNoShow") : mt("sheetCancelViewing")}
                description={`${formatTourDate(new Date(selectedViewing.viewing.scheduledAt))} at ${formatTourClock(new Date(selectedViewing.viewing.scheduledAt))}`}
                badge={getStatusBadge(selectedViewing.viewing.status, selectedViewing.viewing.cancelledBy, selectedViewing.viewing.adminReviewDecision, selectedViewing.viewing.disruptionReason)}
              />

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
                {/* Viewing Info */}
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{mt("viewingReference")}</span>
                    <span className="font-medium">TOUR-{selectedViewing.viewing.id}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{mt("submitted")}</span>
                    <span className="text-right">{formatTourWhen(selectedViewing.viewing.createdAt, null, selectedViewing.locationTimezone || "America/St_Johns")}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{mt("tourDateAndTime")}</span>
                    <span className="text-right">{formatTourWhen(selectedViewing.viewing.scheduledAt, selectedViewing.viewing.durationMinutes, selectedViewing.locationTimezone || "America/St_Johns")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{mt("chef")}</span>
                    <span>
                      {selectedViewing.chefName || selectedViewing.chefUsername?.split("@")[0] ||
                        `Chef #${selectedViewing.viewing.chefId}`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{mt("navLocation")}</span>
                    <span>{selectedViewing.locationName || "—"}</span>
                  </div>
                  {selectedViewing.locationAddress && (
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">{mt("address")}</span>
                      <span className="text-right">{selectedViewing.locationAddress}</span>
                    </div>
                  )}
                  {selectedViewing.chefEmail && (
                    <div className="flex justify-between gap-4">
                      <span className="flex items-center gap-1 text-muted-foreground"><Mail className="h-3.5 w-3.5" />Email</span>
                      <a className="truncate text-primary hover:underline" href={`mailto:${selectedViewing.chefEmail}`}>{selectedViewing.chefEmail}</a>
                    </div>
                  )}
                  {selectedViewing.chefPhone && (
                    <div className="flex justify-between gap-4">
                      <span className="flex items-center gap-1 text-muted-foreground"><Phone className="h-3.5 w-3.5" />Phone</span>
                      <a className="text-primary hover:underline" href={`tel:${selectedViewing.chefPhone}`}>{selectedViewing.chefPhone}</a>
                    </div>
                  )}
                  {selectedViewing.kitchenName && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{mt("kitchenInterest")}</span>
                      <span>{selectedViewing.kitchenName}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{mt("duration")}</span>
                    <span>{mt("minutesLong", { count: selectedViewing.viewing.durationMinutes })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{mt("status")}</span>
                    {getStatusBadge(selectedViewing.viewing.status, selectedViewing.viewing.cancelledBy, selectedViewing.viewing.adminReviewDecision, selectedViewing.viewing.disruptionReason)}
                  </div>
                </div>

                {decisionKind && (
                  <div className="space-y-3 rounded-md border p-4" aria-live="polite">
                    <p className="text-sm font-medium">{mt("tourOverlappingBookings")}</p>
                    <p className="text-xs text-muted-foreground">{mt("tourOverlapAllowed")}</p>
                    {contextLoading && <p className="text-sm">{mt("tourDecisionContextLoading")}</p>}
                    {(contextError || (decisionContext && decisionContext.updatedAt !== selectedViewing.viewing.updatedAt)) && (
                      <div className="space-y-2"><p role="alert" className="text-sm">{contextError?.message || mt("tourDecisionChanged")}</p>
                        <Button variant="outline" size="sm" onClick={() => { refetch(); refetchContext() }}>{mt("tourReviewAgain")}</Button></div>
                    )}
                    {decisionContext && !contextError && decisionContext.updatedAt === selectedViewing.viewing.updatedAt && (
                      <>
                        {!decisionContext.overlaps.length && <p className="text-sm">{mt("tourNoOverlappingBookings")}</p>}
                        {decisionContext.overlaps.map(overlap => (
                          <div key={`${overlap.bookingId}-${overlap.start}`} className="space-y-1 text-sm">
                            <p className="font-medium">{overlap.reference} · {mt(overlap.status === "pending" ? "tourOverlapPending" : overlap.status === "confirmed" ? "tourOverlapConfirmed" : "tourOverlapCancellationRequested")}</p>
                            <p>{formatTourWhen(overlap.start, (new Date(overlap.end).getTime() - new Date(overlap.start).getTime()) / 60_000, "America/St_Johns")}</p>
                            {overlap.timeUncertain && <p className="text-xs text-muted-foreground">{mt("tourOverlapAmbiguousTime")}</p>}
                          </div>
                        ))}
                        {!!decisionContext.overlaps.length && <label className="flex items-start gap-2 text-sm">
                          <input type="checkbox" checked={acceptBookingOverlap} onChange={event => setAcceptBookingOverlap(event.target.checked)} className="mt-1" />
                          <span>{mt("tourAcceptBookingOverlap")}</span>
                        </label>}
                      </>
                    )}
                  </div>
                )}

                {canReviewReschedule(selectedViewing.viewing) && (
                  <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4">
                    <p className="text-sm font-medium">Date change requested</p>
                    <p className="text-sm">Requested: {formatTourWhen(selectedViewing.viewing.requestedRescheduleAt!, selectedViewing.viewing.durationMinutes, selectedViewing.locationTimezone || "America/St_Johns")}</p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button variant="outline" className="w-full sm:w-auto" disabled={reviewReschedule.isPending || updateStatusMutation.isPending} onClick={() => reviewReschedule.mutate({ id: selectedViewing.viewing.id, decision: "decline" })}>Keep original time</Button>
                      <Button className="w-full sm:w-auto" disabled={reviewReschedule.isPending || updateStatusMutation.isPending || !acceptanceReady} onClick={() => reviewReschedule.mutate({ id: selectedViewing.viewing.id, decision: "accept" })}>Approve new time</Button>
                    </div>
                  </div>
                )}

                {/* Chef Notes */}
                {selectedViewing.viewing.chefNotes && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">{mt("chefSNotes")}</p>
                      <p className="text-sm bg-muted/50 p-2 rounded">
                        {selectedViewing.viewing.chefNotes}
                      </p>
                    </div>
                  </>
                )}

                {/* Intake Data */}
                {selectedViewing.viewing.sharedManagerNotes && statusAction === 'view' && <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">{mt('tourMessageToChefOptional')}</p>
                  <p className="rounded bg-muted/50 p-2 text-sm whitespace-pre-wrap">{selectedViewing.viewing.sharedManagerNotes}</p>
                </div>}
                {selectedViewing.viewing.disruptionReason && <p className="text-sm">{mt('tourDisruptionReason')}: {mt(`tourDisruption_${selectedViewing.viewing.disruptionReason}`)}</p>}
                {!!selectedViewing.viewing.outcomeHistory?.length && statusAction === 'view' && <details className="rounded border p-3 text-sm">
                  <summary>{mt('tourOutcomeHistory')}</summary>
                  {selectedViewing.viewing.outcomeHistory.map((entry, index) => <div key={index} className="border-t py-2">
                    <p>{entry.from} → {entry.to} · {entry.actorRole} · {entry.recordedAt ? formatTourWhen(entry.recordedAt, null, 'America/St_Johns') : '—'}</p>
                    {entry.sharedNotes && <p className="whitespace-pre-wrap">{entry.sharedNotes}</p>}
                  </div>)}
                </details>}
                {selectedViewing.viewing.intakeData &&
                  Object.keys(selectedViewing.viewing.intakeData).length > 0 && (
                    <>
                      <Separator />
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-2">{mt("preViewingScreening")}</p>
                        <div className="space-y-1.5 bg-blue-50/50 p-3 rounded-md border border-blue-100">
                          {Object.entries(selectedViewing.viewing.intakeData)
                            .filter(([_, v]) => v != null && v !== "")
                            .map(([key, value]) => (
                              <div
                                key={key}
                                className="flex justify-between text-xs sm:text-sm"
                              >
                                <span className="text-muted-foreground">
                                  {getIntakeLabel(key)}
                                </span>
                                <span className="font-medium break-words text-right">
                                  {typeof value === "boolean"
                                    ? value
                                      ? mt("yes")
                                      : mt("no")
                                    : typeof value === "object" ? JSON.stringify(value) : String(value).replace(/_/g, " ")}
                                </span>
                              </div>
                            ))}
                        </div>
                      </div>
                    </>
                  )}

                {/* Action Forms */}
                {statusAction !== "view" && (
                  <>
                    <Separator />

                    {statusAction === "no_show" && (
                      <div className="space-y-2">
                        <Label className="text-sm">{mt("noShowReason")}</Label>
                        <Select
                          value={noShowReason}
                          onValueChange={setNoShowReason}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={mt("selectReason")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="visitor_absent">{mt("tourVisitorAbsent")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {statusAction === "disrupt" && <div className="space-y-2">
                      <Label>{mt('tourDisruptionReason')}</Label>
                      <Select value={disruptionReason} onValueChange={setDisruptionReason}>
                        <SelectTrigger aria-label={mt('tourDisruptionReason')}><SelectValue placeholder={mt('selectReason')} /></SelectTrigger>
                        <SelectContent>{Object.keys(tourDisruptionReasons).map(reason => <SelectItem key={reason} value={reason}>{mt(`tourDisruption_${reason}`)}</SelectItem>)}</SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">{mt('tourDisruptionDisclosure')}</p>
                    </div>}
                    {statusAction === "no_show" && <p className="text-xs text-muted-foreground">{mt('tourNoShowDisclosure')}</p>}
                    {statusAction === "cancel" && (
                      <div className="space-y-2">
                        <Label className="text-sm">{mt("cancellationReason")}</Label>
                        <Textarea
                          value={cancellationReason}
                          onChange={(e) => setCancellationReason(e.target.value)}
                          placeholder={mt("reasonForCancellation")}
                          rows={2}
                        />
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label className="text-sm">{mt(correctingOutcome || (statusAction === "disrupt" && disruptionReason === "other") ? "tourSharedExplanationRequired" : "tourMessageToChefOptional")}</Label>
                      <Textarea
                        value={managerNotes}
                        onChange={(e) => setManagerNotes(e.target.value)}
                        placeholder={mt("tourSharedMessageDisclosure")}
                        rows={2}
                      />
                    </div>
                  </>
                )}
              </div>

              {statusAction !== "view" && (
                <DialogFooter className="flex flex-col gap-2 border-t px-6 py-4 sm:flex-row sm:space-x-0">
                  <Button
                    variant="ghost"
                    onClick={requestClose}
                    className="w-full sm:w-auto"
                  >{mt("cancel")}</Button>
                  <Button
                    onClick={() =>
                      updateStatusMutation.mutate({
                        viewingId: selectedViewing.viewing.id,
                        status:
                          statusAction === "complete"
                            ? "completed"
                            : statusAction === "confirm"
                            ? "confirmed"
                            : statusAction === "no_show"
                            ? "no_show"
                            : "cancelled",
                        notes: managerNotes,
                        noShow: noShowReason,
                        cancelReason: cancellationReason,
                      })
                    }
                    disabled={
                      updateStatusMutation.isPending ||
                      reviewReschedule.isPending ||
                      (statusAction === "confirm" && !acceptanceReady) ||
                      (statusAction === "no_show" && !noShowReason) || (statusAction === "disrupt" && !disruptionReason) || ((correctingOutcome || (statusAction === "disrupt" && disruptionReason === "other")) && !managerNotes.trim())
                    }
                    className={cn(
                      "w-full sm:w-auto",
                      statusAction === "cancel" && "bg-destructive hover:bg-destructive/90",
                      statusAction === "no_show" && "bg-amber-600 hover:bg-amber-700"
                    )}
                  >
                    {updateStatusMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : null}
                    {statusAction === "confirm" && mt("confirmViewing")}
                    {statusAction === "complete" && mt("markCompleted")}
                    {statusAction === "no_show" && mt("confirmNoShow")}
                    {statusAction === "cancel" && mt("cancelViewing")}
                    {statusAction === "disrupt" && mt("tourRecordDisruption")}
                  </Button>
                </DialogFooter>
              )}

              {statusAction === "view" && outcomeEligible && (
                <DialogFooter className="flex flex-col gap-2 border-t px-6 py-4 sm:flex-row sm:space-x-0">
                  {!selectedViewing.viewing.disruptionReason && <Button variant="outline" onClick={() => { setManagerNotes(''); setStatusAction('disrupt') }}>{mt('tourRecordDisruption')}</Button>}
                  {selectedViewing.viewing.status !== 'no_show' && <Button variant="outline" onClick={() => { if (correctingOutcome) setManagerNotes(''); setStatusAction('no_show') }}>{mt('markNoShow')}</Button>}
                  {selectedViewing.viewing.status !== 'completed' && <Button onClick={() => { if (correctingOutcome) setManagerNotes(''); setStatusAction('complete') }}>{mt('markCompleted')}</Button>}
                </DialogFooter>
              )}
              {statusAction === 'view' && selectedViewing.viewing.status === 'pending' && new Date(selectedViewing.viewing.scheduledAt).getTime() <= Date.now() && <DialogFooter className="border-t px-6 py-4"><Button variant="outline" onClick={() => setStatusAction('cancel')}>{mt('tourCloseExpiredRequest')}</Button></DialogFooter>}

              {statusAction === "view" && selectedViewing.viewing.status === "pending" && new Date(selectedViewing.viewing.scheduledAt).getTime() > Date.now() && (
                <DialogFooter className="flex flex-col gap-2 border-t px-6 py-4 sm:flex-row sm:space-x-0">
                  <Button
                    variant="outline"
                    className="w-full sm:w-auto text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setStatusAction("cancel")}
                  >{mt("declineRequest")}</Button>
                  <Button
                    className="w-full sm:w-auto"
                    disabled={updateStatusMutation.isPending}
                    onClick={() => setStatusAction("confirm")}
                  >{mt("acceptViewing")}</Button>
                </DialogFooter>
              )}
              {statusAction === "view" && selectedViewing.viewing.status === "confirmed" && new Date(selectedViewing.viewing.scheduledAt).getTime() > Date.now() && (
                <DialogFooter className="border-t px-6 py-4 sm:space-x-0">
                  <Button variant="outline" onClick={() => setStatusAction("cancel")}>{mt("cancelViewing")}</Button>
                </DialogFooter>
              )}
            </>
          )}
        </AppDialogContent>
      </Dialog>
      <UnsavedChangesDialog open={confirmExit} onOpenChange={setConfirmExit} description={mt("tourUnsavedDescription")} onDiscard={() => { setConfirmExit(false); closeDialog(); }} />

    </>
  )
}

export default ViewingsDashboard
