/**
 * ViewingsDashboard
 *
 * Manager-facing dashboard for viewing and managing all kitchen viewing bookings.
 * Shows upcoming and past viewings with intake data, status controls, and no-show tracking.
 * Built mobile-first with shadcn/ui components.
 */

import { useState, useEffect, useRef, type MutableRefObject } from "react"
import { CommitmentProblems } from '@/components/support/CommitmentProblems';
import { useLocation, useSearch } from "wouter"
import type { ColumnDef } from "@tanstack/react-table"
import { mt } from "@/i18n/manager"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { KitchenTour, Clock, User, Loader2, CheckCircle, XCircle, AlertTriangle, FileText, Search, X } from "@/components/ui/manager-icons"
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
import { UnsavedChangesDialog } from "@/components/manager/UnsavedChangesDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { formatTourDate, formatTourClock } from "@shared/tour-time"
import type { TourBookingOverlap } from "@shared/tour-booking-overlap"
import { isPendingOrUpcomingTour } from "@/lib/chef-viewing-display"
import { useTourClock } from "@/hooks/use-tour-clock"
import { hasTourConfirmation, tourDisruptionReasons } from '@shared/tour-outcome'
import { TourChatButton } from '@/components/chat/TourChatButton'
import { TourAttendancePanel } from '@/components/tour/TourAttendancePanel'
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
    checkedInAt?: string | null
    checkedOutAt?: string | null
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
  return labels[key] || key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ")
}

function canReviewReschedule(viewing: ViewingRecord["viewing"]): boolean {
  return viewing.status === "confirmed" && !!viewing.requestedRescheduleAt && new Date(viewing.scheduledAt).getTime() > Date.now()
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ViewingsDashboardProps {
  tourId?: string
  onOpenTour?: (id: number) => void
  onBackToTours?: () => void
  onConfigureNotes?: (kitchenId: number, locationId: number) => void
  navigationGuardRef?: MutableRefObject<((navigate: () => void) => boolean) | null>
  locationId?: number
  onSelectTourLocation?: (locationId: number) => void
  onConfigureTours?: () => void
  hasKitchen?: boolean
}

export function ViewingsDashboard({ locationId, onSelectTourLocation, onConfigureTours, hasKitchen = true,
  tourId, onOpenTour, onBackToTours, onConfigureNotes, navigationGuardRef }: ViewingsDashboardProps) {
  useTourClock()
  
  const queryClient = useQueryClient()
  const [, navigate] = useLocation()
  const heading = useRef<HTMLHeadingElement>(null)
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
  const selectedDeepLinkLocation = useRef<string | null>(null)
  const tourSearch = useSearch()
  const exactId = tourId || new URLSearchParams(tourSearch).get('viewing')
  const pendingNavigation = useRef<(() => void) | null>(null)

  // Fetch viewings
  const queryUrl = locationId
    ? `/api/viewings/manager?locationId=${locationId}`
    : `/api/viewings/manager`

  const { data: viewings, isLoading, isError, refetch } = useQuery<ViewingRecord[]>({
    queryKey: [queryUrl],
    refetchInterval: 30000, // Poll every 30s
    refetchOnWindowFocus: true,
  })
  // Exact links resolve through the existing current-manager endpoint, independently
  // of the shell's previously selected location or caller-supplied location hint.
  const exactQuery = useQuery<ViewingRecord[]>({
    queryKey: ['/api/viewings/manager', 'exact-tour', exactId],
    enabled: !!exactId,
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => {
      const response = await fetch('/api/viewings/manager', { headers: await getAuthHeaders() })
      if (!response.ok) throw new Error('Tour unavailable')
      return response.json()
    },
    refetchOnWindowFocus: true,
  })
  const exactRecord = exactQuery.data?.find(item => item.viewing.id === Number(exactId))
  useEffect(() => {
    if (exactId && !exactQuery.isLoading && (exactQuery.isError || !exactRecord)) setSelectedViewing(null)
  }, [exactId, exactRecord, exactQuery.isLoading, exactQuery.isError])
  useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [selectedViewing?.viewing.id])
  useEffect(() => {
    if (openedDeepLink.current && openedDeepLink.current !== exactId) {
      openedDeepLink.current = null
      setSelectedViewing(null)
      setStatusAction('')
      setManagerNotes('')
      setNoShowReason('')
      setDisruptionReason('')
      setCancellationReason('')
    }
  }, [exactId])
  useEffect(() => {
    if (!exactId) { selectedDeepLinkLocation.current = null; return }
    if (!exactRecord || locationId === undefined || selectedDeepLinkLocation.current === exactId) return
    selectedDeepLinkLocation.current = exactId
    if (exactRecord.viewing.locationId !== locationId) onSelectTourLocation?.(exactRecord.viewing.locationId)
  }, [exactId, exactRecord, locationId, onSelectTourLocation])
  useEffect(() => {
    const id = exactId
    if (!id) { openedDeepLink.current = null; return }
    if (openedDeepLink.current === id) return
    const record = exactRecord
    if (!record) return
    openedDeepLink.current = id
    setSelectedViewing(record)
    setStatusAction("view")
    setManagerNotes(record.viewing.sharedManagerNotes ?? "")
  }, [exactRecord, exactId])
  useEffect(() => {
    setSelectedViewing(current => current
      ? viewings?.find(record => record.viewing.id === current.viewing.id) ?? current
      : null)
  }, [viewings])

  const correctingOutcome = !!selectedViewing && (["completed", "no_show"].includes(selectedViewing.viewing.status) || !!selectedViewing.viewing.disruptionReason)
  const outcomeEligible = !!selectedViewing && hasTourConfirmation(selectedViewing.viewing)
    && (['confirmed', 'completed', 'no_show'].includes(selectedViewing.viewing.status) || !!selectedViewing.viewing.disruptionReason)
    && new Date(selectedViewing.viewing.scheduledAt).getTime() + selectedViewing.viewing.durationMinutes * 60_000 <= Date.now()
  const nextStepKey = selectedViewing && statusAction === 'view'
    ? selectedViewing.viewing.status === 'pending'
      ? new Date(selectedViewing.viewing.scheduledAt).getTime() > Date.now() ? 'tourNextReview' : 'tourNextExpired'
      : canReviewReschedule(selectedViewing.viewing) ? 'tourNextReschedule'
      : selectedViewing.viewing.status === 'confirmed' && !selectedViewing.viewing.disruptionReason
        ? outcomeEligible ? 'tourNextOutcome'
          : new Date(selectedViewing.viewing.scheduledAt).getTime() > Date.now() ? 'tourNextPrepare' : 'tourNextHost'
        : null
    : null

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
  const refreshOverview = (updated: ViewingRecord['viewing']) => {
    queryClient.setQueriesData<ViewingRecord[]>({ queryKey: ['managerViewings'] }, current => current?.map(record =>
      record.viewing.id === updated.id ? { ...record, viewing: { ...record.viewing, ...updated } } : record))
    queryClient.invalidateQueries({ queryKey: ['managerViewings'] })
  }
  const reviewReschedule = useMutation({
    mutationFn: async ({ id, decision }: { id: number; decision: "accept" | "decline" }) => {
      const response = await fetch(`/api/viewings/manager/${id}/reschedule`, { method: "PATCH", headers: await getAuthHeaders(), body: JSON.stringify({ decision, ...decisionReview() }) })
      const body = await response.json()
      if (!response.ok) throw Object.assign(new Error(body.error || mt("tourDecisionFailed")), { status: response.status })
      return body
    },
    onSuccess: (data) => {
      refreshOverview(data)
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
      refreshOverview(updated)
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
    if (exactId) onBackToTours?.()
  }

  const hasUnsavedInput = !!selectedViewing && (managerNotes !== (selectedViewing.viewing.sharedManagerNotes || "") || !!noShowReason || !!disruptionReason || !!cancellationReason.trim())
  const guardNavigation = (navigate: () => void) => {
    if (!hasUnsavedInput) return true
    pendingNavigation.current = navigate
    setConfirmExit(true)
    return false
  }
  const requestNavigation = (navigate: () => void) => { if (guardNavigation(navigate)) navigate() }
  const requestClose = () => requestNavigation(closeDialog)
  useEffect(() => {
    if (navigationGuardRef) navigationGuardRef.current = guardNavigation
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    if (hasUnsavedInput) window.addEventListener('beforeunload', preventLoss)
    return () => {
      if (navigationGuardRef) navigationGuardRef.current = null
      window.removeEventListener('beforeunload', preventLoss)
    }
  })

  const handleStatusAction = (viewing: ViewingRecord, action: string) => {
    if (action === 'view' && onOpenTour) { onOpenTour(viewing.viewing.id); return }
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
    { id: "actions", header: "", meta: { mobileHidden: true }, cell: ({ row }) => <div className="flex gap-2"><TourChatButton tour={row.original.viewing} role="manager" /><Button variant="outline" size="sm" onClick={() => handleStatusAction(row.original, "view")}>{mt("viewDetails")}</Button></div> },
  ]

  return (
    <>
      {!selectedViewing && <div className="space-y-6">
        {exactId && exactQuery.isLoading && <p role="status">{mt('tourDetailsLoading')}</p>}
        {exactId && !exactQuery.isLoading && (exactQuery.isError || !exactRecord) &&
          <div role="alert"><p>This tour is unavailable. Check your location access or try again.</p><Button variant="outline" onClick={() => void exactQuery.refetch()}>Try again</Button></div>}
        {!exactId && <>
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
        </>}
      </div>}

      {selectedViewing && <section aria-label={mt('sheetViewingDetails')} className="space-y-6">
          {selectedViewing && (
            <>
              <header className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight focus:outline-none">TOUR-{selectedViewing.viewing.id} · {selectedViewing.chefName || mt('chef')}</h1>
                  <p className="text-sm text-muted-foreground">{formatTourWhen(selectedViewing.viewing.scheduledAt, selectedViewing.viewing.durationMinutes, selectedViewing.locationTimezone || 'America/St_Johns')}</p>
                </div>
                {getStatusBadge(selectedViewing.viewing.status, selectedViewing.viewing.cancelledBy, selectedViewing.viewing.adminReviewDecision, selectedViewing.viewing.disruptionReason)}
              </header>
              {nextStepKey && <section className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-5" aria-label={mt('tourNextStep')}>
                <h2 className="font-semibold">{mt('tourNextStep')}</h2>
                <p className="text-sm">{mt(nextStepKey)}</p>
                {nextStepKey === 'tourNextReview' && <div className="flex flex-wrap gap-2">
                  <Button onClick={() => setStatusAction('confirm')} disabled={updateStatusMutation.isPending}>{mt('acceptViewing')}</Button>
                  <Button variant="outline" onClick={() => setStatusAction('cancel')}>{mt('declineRequest')}</Button>
                </div>}
              </section>}
              <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="min-w-0 space-y-4 rounded-xl border bg-card">

              <div className="space-y-5 p-5 sm:p-6">
                <div className="space-y-3 text-sm">
                  <div><p className="font-medium">{selectedViewing.kitchenName || selectedViewing.locationName}</p>{selectedViewing.kitchenName && <p className="text-muted-foreground">{selectedViewing.locationName}</p>}{selectedViewing.locationAddress && <p className="text-muted-foreground">{selectedViewing.locationAddress}</p>}</div>
                </div>
                <section className="space-y-4 rounded-lg border bg-background p-4" aria-label={mt('tourChefDetailsTitle')}>
                  <h2 className="font-semibold">{mt('tourChefDetailsTitle')}</h2>
                  <dl className="grid min-w-0 gap-4 sm:grid-cols-2">
                    <div><dt className="text-xs text-muted-foreground">{mt('chef')}</dt><dd className="mt-1 font-medium">{selectedViewing.chefName || selectedViewing.chefUsername || mt('tourNotShared')}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{mt('tourChefEmail')}</dt><dd className="mt-1 break-all">{selectedViewing.chefEmail ? <a className="text-primary underline underline-offset-2" href={`mailto:${selectedViewing.chefEmail}`}>{selectedViewing.chefEmail}</a> : mt('tourNotShared')}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{mt('tourChefPhone')}</dt><dd className="mt-1">{selectedViewing.chefPhone ? <a className="text-primary underline underline-offset-2" href={`tel:${selectedViewing.chefPhone}`}>{selectedViewing.chefPhone}</a> : mt('tourNotShared')}</dd></div>
                  </dl>
                </section>
                <section className="space-y-4 rounded-lg border bg-background p-4" aria-label={mt('tourChefRequestDetails')}>
                  <h2 className="font-semibold">{mt('tourChefRequestDetails')}</h2>
                  <dl className="grid gap-4 sm:grid-cols-2">
                    <div><dt className="text-xs text-muted-foreground">{mt('tourRequestedTime')}</dt><dd className="mt-1 text-sm">{formatTourWhen(selectedViewing.viewing.scheduledAt, selectedViewing.viewing.durationMinutes, selectedViewing.locationTimezone || 'America/St_Johns')}</dd></div>
                    {selectedViewing.viewing.createdAt && <div><dt className="text-xs text-muted-foreground">{mt('tourRequestSubmitted')}</dt><dd className="mt-1 text-sm">{formatTourWhen(selectedViewing.viewing.createdAt, null, selectedViewing.locationTimezone || 'America/St_Johns')}</dd></div>}
                  </dl>
                  <div className="space-y-1 border-t pt-3"><p className="text-sm font-medium">{mt('chefSNotes')}</p><p className="whitespace-pre-wrap text-sm text-muted-foreground">{selectedViewing.viewing.chefNotes?.trim() || mt('tourNoChefNotes')}</p></div>
                  {!!Object.keys(selectedViewing.viewing.intakeData || {}).length && <div className="space-y-3 border-t pt-3">
                    <dl className="grid min-w-0 gap-4 sm:grid-cols-2">{Object.entries(selectedViewing.viewing.intakeData)
                      .filter(([, value]) => value != null && value !== '' && ['string','number','boolean'].includes(typeof value))
                      .map(([key,value]) => <div key={key}><dt className="text-xs text-muted-foreground">{getIntakeLabel(key)}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm">{typeof value === 'boolean' ? mt(value ? 'yes' : 'no') : String(value).replaceAll('_',' ')}</dd></div>)}</dl>
                  </div>}
                </section>
                {selectedViewing.viewing.checkedInAt && <TourAttendancePanel key={selectedViewing.viewing.id} id={selectedViewing.viewing.id} role="manager" version={selectedViewing.viewing.updatedAt} />}
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
                <div className="flex flex-col gap-2 border-t px-6 py-4 sm:flex-row sm:space-x-0">
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
                </div>
              )}

              {statusAction === "view" && outcomeEligible && (
                <div className="flex flex-col gap-2 border-t px-6 py-4 sm:flex-row sm:space-x-0">
                  {!selectedViewing.viewing.disruptionReason && <Button variant="outline" onClick={() => { setManagerNotes(''); setStatusAction('disrupt') }}>{mt('tourRecordDisruption')}</Button>}
                  {selectedViewing.viewing.status !== 'no_show' && <Button variant="outline" onClick={() => { if (correctingOutcome) setManagerNotes(''); setStatusAction('no_show') }}>{mt('markNoShow')}</Button>}
                  {selectedViewing.viewing.status !== 'completed' && <Button onClick={() => { if (correctingOutcome) setManagerNotes(''); setStatusAction('complete') }}>{mt('markCompleted')}</Button>}
                </div>
              )}
              {statusAction === 'view' && selectedViewing.viewing.status === 'pending' && new Date(selectedViewing.viewing.scheduledAt).getTime() <= Date.now() && <div className="border-t px-6 py-4"><Button variant="outline" onClick={() => setStatusAction('cancel')}>{mt('tourCloseExpiredRequest')}</Button></div>}

              {statusAction === "view" && selectedViewing.viewing.status === "confirmed" && new Date(selectedViewing.viewing.scheduledAt).getTime() > Date.now() && (
                <div className="border-t px-6 py-4 sm:space-x-0">
                  <Button variant="outline" onClick={() => setStatusAction("cancel")}>{mt("cancelViewing")}</Button>
                </div>
              )}
              </div>
              <aside className="space-y-4">
                {['pending', 'confirmed'].includes(selectedViewing.viewing.status) && new Date(selectedViewing.viewing.scheduledAt).getTime() + selectedViewing.viewing.durationMinutes * 60_000 > Date.now() && <Card><CardContent className="space-y-3 p-5">
                  <h2 className="font-semibold">{mt('tourVisitNotesTitle')}</h2>
                  <p className="text-sm text-muted-foreground">{mt('tourNotesOptionalHelp')}</p>
                  {selectedViewing.viewing.targetedKitchenId && onConfigureNotes && <Button variant="outline" className="w-full" onClick={() => requestNavigation(() => onConfigureNotes(selectedViewing.viewing.targetedKitchenId!, selectedViewing.viewing.locationId))}>{mt('tourEditVisitNotes')}</Button>}
                </CardContent></Card>}
                <Card><CardContent className="space-y-3 p-5">
                  <h2 className="font-semibold">{mt('tourVisitorContactTitle')}</h2>
                  <p className="text-sm text-muted-foreground">{mt('tourVisitorContactHelp')}</p>
                  <TourChatButton tour={selectedViewing.viewing} role="manager" onNavigate={path => requestNavigation(() => navigate(path))} />
                </CardContent></Card>
                <CommitmentProblems kind="tour" id={selectedViewing.viewing.id} role="manager" canReport />
              </aside>
              </div>
            </>
          )}
      </section>}
      <UnsavedChangesDialog open={confirmExit} onOpenChange={setConfirmExit} description={mt("tourUnsavedDescription")} onDiscard={() => {
        setConfirmExit(false);
        const navigate = pendingNavigation.current;
        pendingNavigation.current = null;
        if (navigationGuardRef) navigationGuardRef.current = null;
        navigate?.();
      }} />

    </>
  )
}

export default ViewingsDashboard
