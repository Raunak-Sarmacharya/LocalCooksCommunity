import type { TourAttendance } from '@shared/tour-attendance';
import { TourIntakeDetails } from "@/components/tour/TourIntakeDetails"
import { TourFunnel } from '@/components/tour/TourFunnel';
/**
 * ViewingsDashboard
 *
 * Manager-facing dashboard for viewing and managing all kitchen viewing bookings.
 * Shows upcoming and past viewings with intake data, status controls, and no-show tracking.
 * Built mobile-first with shadcn/ui components.
 */

import { useState, useEffect, useRef, type MutableRefObject } from "react"
import { TourSupportCard } from '@/components/tour/TourSupportCard';
import { useLocation, useSearch } from "wouter"
import type { ColumnDef } from "@tanstack/react-table"
import { mt } from "@/i18n/manager"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { KitchenTour, Clock, User, Loader2, CheckCircle, XCircle, AlertTriangle, FileText, Search, X, CalendarClock, ArrowRight, ChevronDown } from "@/components/ui/manager-icons"
import { toast } from "sonner"
import { auth } from "@/lib/firebase"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
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
import { formatTourDate, formatTourClock, formatTourSlotRange } from "@shared/tour-time"
import type { TourBookingOverlap } from "@shared/tour-booking-overlap"
import { isPendingOrUpcomingTour } from "@/lib/chef-viewing-display"
import { useTourClock } from "@/hooks/use-tour-clock"
import { hasTourConfirmation, tourDisruptionReasons } from '@shared/tour-outcome'
import { TourChatButton } from '@/components/chat/TourChatButton'
import { TourFeedbackPanel } from '@/components/tour/TourFeedbackPanel'
import { tourFeedbackOpen } from '@shared/tour-feedback'
import { formatTourWhen } from "@/lib/chef-viewing-display"
import { DateField } from '@/components/ui/date-field'
import { tourAvailableDate, type TourCalendarAvailability } from '@/lib/tour-available-date'
import { canManagerProposeReschedule } from '@shared/tour-reschedule'
import { TourHistoryPanel } from './TourHistoryPanel'
import { tourRequestDecision } from '@shared/tour-request-decision'

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
  reconfirmation?: { reply: string | null; canReply: boolean; needsStaffAttention: boolean };
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
    confirmationVerified?: boolean
    managerFeedbackSubmitted?: boolean
    visitEvidenceState?: string
    outcomeHistory?: Array<{ from: string; to: string; actorRole: string; recordedAt: string; sharedNotes?: string | null }>
    noShowReason: string | null
    intakeData: Record<string, any>
    cancelledBy: string | null
    adminReviewDecision: string | null
    adminReviewedAt?: string | null
    requestExpiredAt?: string | null
    cancellationReason: string | null
    cancelledAt: string | null
    completedAt: string | null
    createdAt: string
    updatedAt: string
    attendance?: TourAttendance
    checkedInAt?: string | null
    checkedOutAt?: string | null
    requestedRescheduleAt: string | null
    rescheduleProposedSlots?: string[]
    rescheduleProposedAt?: string | null
  }
  locationName: string | null
  locationAddress: string | null
  locationTimezone: string | null
  kitchenName: string | null
  arrivalNotes?: string | null
  departureNotes?: string | null
  chefUsername: string | null
  chefEmail: string | null
  chefPhone: string | null
  chefName?: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getStatusBadge(status: string, cancelledBy?: string | null, adminReviewDecision?: string | null, disruptionReason?: string | null) {
  if (disruptionReason === 'outcome_unknown') return <Badge variant="outline">{mt('tourHistory_status_unverified')}</Badge>
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

function canReviewReschedule(viewing: ViewingRecord["viewing"]): boolean {
  return viewing.status === "confirmed" && !!viewing.requestedRescheduleAt && new Date(viewing.scheduledAt).getTime() > Date.now()
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ViewingsDashboardProps {
  tourId?: string
  onOpenTour?: (id: number) => void
  onBackToTours?: () => void
  onConfigureNotes?: (kitchenId: number, locationId: number, tourId: number) => void
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
  const decisionPanel = useRef<HTMLDivElement>(null)
  const proposalTrigger = useRef<HTMLButtonElement>(null)
  const proposalMutationPending = useRef(false)
  const rescheduleReview = useRef<HTMLDivElement>(null)
  const handledDeepLinkAction = useRef<string | null>(null)
  const [selectedViewing, setSelectedViewing] = useState<ViewingRecord | null>(null)
  const [statusAction, setStatusAction] = useState<string>("")
  useEffect(() => { if (['confirm', 'cancel'].includes(statusAction)) decisionPanel.current?.focus({ preventScroll: true }) }, [statusAction])
  const [managerNotes, setManagerNotes] = useState("")
  const [noShowReason, setNoShowReason] = useState("")
  const [disruptionReason, setDisruptionReason] = useState("")
  const [cancellationReason, setCancellationReason] = useState("")
  const [acceptBookingOverlap, setAcceptBookingOverlap] = useState(false)
  const [proposalOpen, setProposalOpen] = useState(false)
  const [feedbackTargetId, setFeedbackTargetId] = useState<number | null>(null)
  const feedbackTrigger = useRef<HTMLButtonElement>(null)
  const [proposalDate, setProposalDate] = useState('')
  const [proposedSlots, setProposedSlots] = useState<string[]>([])
  const [confirmExit, setConfirmExit] = useState(false)
  const [statusFilter, setStatusFilter] = useState("all")
  const [searchQuery, setSearchQuery] = useState("")
  const openedDeepLink = useRef<string | null>(null)
  const selectedDeepLinkLocation = useRef<string | null>(null)
  const tourSearch = useSearch()
  const exactId = tourId || new URLSearchParams(tourSearch).get('viewing')
  const deepLinkAction = new URLSearchParams(tourSearch).get('action')
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
    if (!record || exactQuery.isFetching) return
    openedDeepLink.current = id
    setSelectedViewing(record)
    setStatusAction("view")
    setManagerNotes(record.viewing.sharedManagerNotes ?? "")
  }, [exactRecord, exactId, exactQuery.isFetching])
  useEffect(() => {
    if (exactRecord) setSelectedViewing(current => current?.viewing.id === exactRecord.viewing.id ? exactRecord : current)
  }, [exactRecord])
  useEffect(() => {
    setSelectedViewing(current => current
      ? viewings?.find(record => record.viewing.id === current.viewing.id) ?? current
      : null)
  }, [viewings])

  const correctingOutcome = !!selectedViewing && (["completed", "no_show"].includes(selectedViewing.viewing.status) || !!selectedViewing.viewing.disruptionReason)
  const feedbackAfterEnd = !!selectedViewing && hasTourConfirmation(selectedViewing.viewing) && Date.parse(selectedViewing.viewing.scheduledAt) + selectedViewing.viewing.durationMinutes * 60_000 <= Date.now()
  const canShareFeedback = !!selectedViewing && tourFeedbackOpen(selectedViewing.viewing) && !selectedViewing.viewing.managerFeedbackSubmitted
  const showFeedbackAction = canShareFeedback || feedbackAfterEnd && !!selectedViewing?.viewing.managerFeedbackSubmitted
  const nextStepKey = selectedViewing && ['view', 'confirm', 'cancel', 'complete', 'no_show', 'disrupt'].includes(statusAction)
    ? selectedViewing.viewing.visitEvidenceState === 'review' ? 'tourNextEvidenceReview' : selectedViewing.viewing.status === 'pending'
      ? new Date(selectedViewing.viewing.scheduledAt).getTime() > Date.now() ? selectedViewing.viewing.rescheduleProposedSlots?.length ? 'tourPendingProposalAwaitingHelp' : 'tourNextReview' : 'tourNextExpired'
      : canReviewReschedule(selectedViewing.viewing) ? 'tourNextReschedule'
      : selectedViewing.viewing.status === 'confirmed' && !selectedViewing.viewing.disruptionReason
        ? feedbackAfterEnd ? selectedViewing.viewing.managerFeedbackSubmitted ? 'tourNextFeedbackSubmitted' : 'tourNextFeedback'
          : new Date(selectedViewing.viewing.scheduledAt).getTime() > Date.now() ? 'tourNextPrepare' : 'tourNextHost'
        : feedbackAfterEnd && selectedViewing.viewing.managerFeedbackSubmitted ? 'tourNextFeedbackSubmitted' : null
    : null

  const decisionKind = selectedViewing && canReviewReschedule(selectedViewing.viewing)
    ? "reschedule" : statusAction === "confirm" ? "confirm" : null
  const canProposeChange = !!selectedViewing && !selectedViewing.viewing.disruptionReason && canManagerProposeReschedule(selectedViewing.viewing)
  useEffect(() => {
    if (proposalMutationPending.current) return
    setProposalOpen(false); setProposalDate(''); setProposedSlots([])
  }, [selectedViewing?.viewing.id, selectedViewing?.viewing.updatedAt])

  const canEditTourNotes = !!selectedViewing && ['pending', 'confirmed'].includes(selectedViewing.viewing.status)
    && Date.parse(selectedViewing.viewing.scheduledAt) + selectedViewing.viewing.durationMinutes * 60_000 > Date.now()
    && !!selectedViewing.viewing.targetedKitchenId && !!onConfigureNotes

  useEffect(() => {
    const key = `${exactId}:${deepLinkAction}`
    if (!exactId) { handledDeepLinkAction.current = null; return }
    if (exactQuery.isFetching || !exactRecord || selectedViewing?.viewing.id !== exactRecord.viewing.id || handledDeepLinkAction.current === key) return
    handledDeepLinkAction.current = key
    const current = exactRecord.viewing
    if (deepLinkAction === 'reschedule' && !current.disruptionReason && canManagerProposeReschedule(current)) setProposalOpen(true)
    if (deepLinkAction === 'confirm' && current.status === 'pending' && Date.parse(current.scheduledAt) > Date.now()
      && !current.disruptionReason && !current.rescheduleProposedSlots?.length) setStatusAction('confirm')
    if (deepLinkAction === 'review-reschedule' && canReviewReschedule(current)) rescheduleReview.current?.focus()
    if (deepLinkAction === 'cancel' && ['pending', 'confirmed'].includes(current.status) && Date.parse(current.scheduledAt) > Date.now()
      && !current.disruptionReason && !current.checkedInAt) setStatusAction('cancel')
    if (deepLinkAction === 'result' && current.status === 'confirmed' && hasTourConfirmation(current)
      && Date.parse(current.scheduledAt) + current.durationMinutes * 60_000 <= Date.now()) heading.current?.focus()
  }, [exactId, deepLinkAction, exactRecord, exactQuery.isFetching, selectedViewing?.viewing.id])
  const { data: proposalCalendar, isFetching: proposalCalendarLoading, error: proposalCalendarError } = useQuery<TourCalendarAvailability>({
    queryKey: ['manager-tour-reschedule-calendar', selectedViewing?.viewing.id, selectedViewing?.viewing.updatedAt],
    enabled: proposalOpen && canProposeChange && !!selectedViewing?.viewing.targetedKitchenId,
    queryFn: async () => {
      const response = await fetch(`/api/viewings/calendar-availability/${selectedViewing!.viewing.targetedKitchenId}?viewingId=${selectedViewing!.viewing.id}`, { headers: await getAuthHeaders(), cache: 'no-store' })
      if (!response.ok) throw new Error(mt('tourProposalAvailabilityFailed'))
      return response.json()
    },
  })
  const { data: proposalChoices = [], isFetching: proposalSlotsLoading, error: proposalSlotsError } = useQuery<{ scheduledAt: string }[]>({
    queryKey: ['manager-tour-reschedule-slots', selectedViewing?.viewing.id, selectedViewing?.viewing.updatedAt, proposalDate],
    enabled: proposalOpen && canProposeChange && !!proposalDate && !!selectedViewing?.viewing.targetedKitchenId,
    queryFn: async () => {
      const response = await fetch(`/api/viewings/available-slots/${selectedViewing!.viewing.targetedKitchenId}?date=${proposalDate}&viewingId=${selectedViewing!.viewing.id}&proposal=true`, { headers: await getAuthHeaders(), cache: 'no-store' })
      if (!response.ok) throw new Error(mt('tourProposalAvailabilityFailed'))
      const body = await response.json()
      return (Array.isArray(body) ? body : body.slots || []).filter((item: { scheduledAt: string }) => Date.parse(item.scheduledAt) > Date.now() && Date.parse(item.scheduledAt) !== Date.parse(selectedViewing!.viewing.scheduledAt))
    },
  })
  const proposalTimeOptions = proposalChoices.map(item => {
    const duration = selectedViewing?.viewing.durationMinutes ?? 30
    let full = formatTourSlotRange(item.scheduledAt, duration)
    // Repeated wall-clock slots during the DST rollback still need distinct labels.
    if (proposalChoices.some(other => other.scheduledAt !== item.scheduledAt && formatTourSlotRange(other.scheduledAt, duration) === full)) {
      const offset = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/St_Johns', timeZoneName: 'shortOffset' })
        .formatToParts(new Date(item.scheduledAt)).find(part => part.type === 'timeZoneName')?.value
      full += ` (${offset})`
    }
    return { ...item, full }
  })
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
      queryClient.invalidateQueries({ queryKey: ['/api/viewings/manager', 'exact-tour'] })
      queryClient.invalidateQueries({ queryKey: ["tour-decision-context"] })
      queryClient.invalidateQueries({ queryKey: ['manager-tour-reschedule-calendar'] })
      queryClient.invalidateQueries({ queryKey: ['manager-tour-reschedule-slots'] })
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
  const proposeReschedule = useMutation({
    mutationFn: async (decision: 'propose' | 'withdraw') => {
      const response = await fetch(`/api/viewings/manager/${selectedViewing!.viewing.id}/reschedule-proposal`, { method: decision === 'withdraw' ? 'PATCH' : 'POST', headers: await getAuthHeaders(), body: JSON.stringify({ ...(decision === 'withdraw' ? { decision } : { proposedSlots }), expectedUpdatedAt: selectedViewing!.viewing.updatedAt }) })
      const body = await response.json()
      if (!response.ok) throw Object.assign(new Error(body.error || mt('tourDecisionFailed')), { status: response.status })
      return body
    },
    onSuccess: (updated, decision) => {
      refreshOverview(updated)
      queryClient.setQueryData<ViewingRecord[]>([queryUrl], current => current?.map(record => record.viewing.id === updated.id ? { ...record, viewing: { ...record.viewing, ...updated } } : record))
      setSelectedViewing(current => current && current.viewing.id === updated.id ? { ...current, viewing: { ...current.viewing, ...updated } } : current)
      setProposalOpen(false); setProposalDate(''); setProposedSlots([])
      queryClient.invalidateQueries({ queryKey: [queryUrl] })
      queryClient.invalidateQueries({ queryKey: ['/api/viewings/manager', 'exact-tour'] })
      if (updated.notificationDeliveryFailed) toast.warning(mt('tourSavedDeliveryFailed'))
      else toast.success(mt(decision === 'withdraw' ? 'tourProposalWithdrawn' : 'tourProposalSent'))
    },
    onError: decisionError,
  })

  // Status update mutation
  proposalMutationPending.current = proposeReschedule.isPending
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
    setProposalOpen(false); setProposalDate(''); setProposedSlots([])
    if (exactId) onBackToTours?.()
  }

  const hasUnsavedInput = !!selectedViewing && (managerNotes !== (selectedViewing.viewing.sharedManagerNotes || "") || !!noShowReason || !!disruptionReason || !!cancellationReason.trim() || !!proposalDate || proposedSlots.length > 0)
  const guardNavigation = (navigate: () => void) => {
    if (proposeReschedule.isPending || updateStatusMutation.isPending || reviewReschedule.isPending) return false
    if (!hasUnsavedInput) return true
    pendingNavigation.current = navigate
    setConfirmExit(true)
    return false
  }
  const requestNavigation = (navigate: () => void) => { if (guardNavigation(navigate)) navigate() }
  const requestClose = () => requestNavigation(() => {
    setStatusAction('view'); setManagerNotes(selectedViewing?.viewing.sharedManagerNotes || '');
    setNoShowReason(''); setDisruptionReason(''); setCancellationReason(''); setAcceptBookingOverlap(false);
  })
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
    { id: "status", header: mt("status"), cell: ({ row }) => <div className="flex flex-col items-start gap-1">{row.original.viewing.requestExpiredAt || row.original.viewing.status === "pending" && new Date(row.original.viewing.scheduledAt).getTime() < Date.now() ? <Badge variant="secondary">{mt('tourRequestExpired')}</Badge> : getStatusBadge(row.original.viewing.status, row.original.viewing.cancelledBy, row.original.viewing.adminReviewDecision, row.original.viewing.disruptionReason)}{row.original.viewing.requestedRescheduleAt && <Badge variant="outline">{mt("tourRescheduleRequested")}</Badge>}{!!row.original.viewing.rescheduleProposedSlots?.length && ["pending", "confirmed"].includes(row.original.viewing.status) && Date.parse(row.original.viewing.scheduledAt) > Date.now() && <Badge variant="outline">{mt("tourProposalPendingTitle")}</Badge>}</div> },
    { id: "actions", header: "", meta: { mobileHidden: true }, cell: ({ row }) => <div className="flex gap-2"><TourChatButton tour={row.original.viewing} role="manager" /><Button variant="outline" size="sm" onClick={() => handleStatusAction(row.original, "view")}>{mt("viewDetails")}</Button></div> },
  ]

  const decisionReviewPanel = selectedViewing && (
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
  )

  const decisionActionPanel = selectedViewing && <div ref={decisionPanel} tabIndex={-1} className="space-y-4 outline-none" aria-label={mt("tourNextStep")}>                 {/* Action Forms */}
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
                        <Label htmlFor="tour-cancellation-reason" className="text-sm">{mt(selectedViewing.viewing.status === 'pending' ? 'tourDeclineReason' : 'cancellationReason')}</Label>
                        <Textarea
                          id="tour-cancellation-reason"
                          maxLength={500}
                          required={selectedViewing.viewing.status === 'pending'}
                          value={cancellationReason}
                          onChange={(e) => setCancellationReason(e.target.value)}
                          placeholder={mt("reasonForCancellation")}
                          rows={2}
                        />
                        {selectedViewing.viewing.status === 'pending' && <p className="text-xs text-muted-foreground">{mt('tourDeclineReasonHelp')}</p>}
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
                    {statusAction !== "view" && (
                <div className="flex flex-col-reverse gap-2 rounded-xl border bg-card p-4 sm:flex-row sm:flex-wrap sm:p-6 [&>button]:min-h-11 [&>button]:h-auto [&>button]:whitespace-normal [&>button]:py-2 [&>button]:text-xs sm:[&>button]:min-h-9">
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
                      proposeReschedule.isPending ||
                      reviewReschedule.isPending ||
                      (statusAction === "confirm" && (!acceptanceReady || !!selectedViewing.viewing.rescheduleProposedSlots?.length)) ||
                      (statusAction === "no_show" && !noShowReason) || (statusAction === "disrupt" && !disruptionReason) || ((correctingOutcome || (statusAction === "disrupt" && disruptionReason === "other")) && !managerNotes.trim())
                      || (statusAction === 'cancel' && selectedViewing.viewing.status === 'pending' && !cancellationReason.trim())
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

</div>
  return (
    <>
      {!selectedViewing && <div className="space-y-6">
        {exactId && exactQuery.isLoading && <p role="status">{mt('tourDetailsLoading')}</p>}
        {exactId && !exactQuery.isLoading && (exactQuery.isError || !exactRecord) &&
          <div role="alert"><p>This tour is unavailable. Check your location access or try again.</p><Button variant="outline" onClick={() => void exactQuery.refetch()}>Try again</Button></div>}
        {!exactId && <>
        <TourFunnel role="manager" locationId={locationId} />
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

      {selectedViewing && <section aria-label={mt('sheetViewingDetails')} className="min-w-0 space-y-5 [overflow-wrap:anywhere]">
          {selectedViewing && (
            <>
              <header className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1.5">
                  <h1 ref={heading} tabIndex={-1} className="text-xl font-semibold tracking-tight focus:outline-none sm:text-2xl">TOUR-{selectedViewing.viewing.id} · {selectedViewing.chefName || mt('chef')}</h1>
                  <p className="text-sm font-medium">{selectedViewing.kitchenName || selectedViewing.locationName}{selectedViewing.kitchenName && selectedViewing.locationName && <span className="font-normal text-muted-foreground"> · {selectedViewing.locationName}</span>}</p>
                  {selectedViewing.locationAddress && <p className="text-sm text-muted-foreground">{selectedViewing.locationAddress}</p>}
                  <p className="text-sm text-muted-foreground">{formatTourWhen(selectedViewing.viewing.scheduledAt, selectedViewing.viewing.durationMinutes, selectedViewing.locationTimezone || 'America/St_Johns')}</p>
                </div>
                {selectedViewing.viewing.requestExpiredAt ? <Badge variant="secondary">{mt('tourRequestExpired')}</Badge> : getStatusBadge(selectedViewing.viewing.status, selectedViewing.viewing.cancelledBy, selectedViewing.viewing.adminReviewDecision, selectedViewing.viewing.disruptionReason)}
              </header>
              <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,19rem)] lg:gap-5">
              <div className="contents lg:block lg:min-w-0 lg:space-y-4">
              {nextStepKey && <section className="order-1 overflow-hidden rounded-2xl border bg-card text-sm" aria-label={mt('tourNextStep')}>
              <div className="space-y-2 bg-primary/5 p-4 sm:px-5">
                <h2 className="text-sm font-semibold leading-5">{mt('tourNextStep')}</h2>
                {selectedViewing.reconfirmation?.canReply && <p className="text-xs text-muted-foreground">{mt(selectedViewing.reconfirmation.reply === 'still_coming' ? 'tourVisitorStillComing' : selectedViewing.reconfirmation.reply === 'reschedule' || selectedViewing.reconfirmation.reply === 'cant_make_it' ? 'tourVisitorChangeSignal' : selectedViewing.reconfirmation.needsStaffAttention ? 'tourVisitorReplyOverdue' : 'tourVisitorReplyPending')}</p>}
                {(() => { const decision = tourRequestDecision(selectedViewing.viewing); return decision?.stage === 'manager' && decision.dueAt && Date.parse(selectedViewing.viewing.scheduledAt) > Date.now() ? <p className={cn('text-xs', decision.overdue ? 'text-destructive font-medium' : 'text-muted-foreground')}>{mt(decision.overdue ? 'tourDecisionOverdue' : 'tourDecisionDue')}: {formatTourWhen(decision.dueAt, null, 'America/St_Johns')}</p> : null; })()}
                <p className="max-w-3xl text-sm leading-relaxed">{mt(nextStepKey)}</p>
              </div>
              {(statusAction !== 'view' || selectedViewing.viewing.status === 'pending' || selectedViewing.viewing.status === 'confirmed' && Date.parse(selectedViewing.viewing.scheduledAt) > Date.now() || showFeedbackAction) && <section className="space-y-3 border-t p-4 sm:px-5" aria-label={mt('tourActions')}>
                <h2 className="text-sm font-semibold leading-5">{mt('tourActions')}</h2>
                {statusAction === 'view' && <div className="grid gap-2 sm:flex sm:flex-wrap [&_button]:h-auto [&_button]:min-h-11 [&_button]:whitespace-normal [&_button]:px-4 [&_button]:py-2">
                  {showFeedbackAction && <Button ref={feedbackTrigger} variant={canShareFeedback ? 'default' : 'outline'} aria-haspopup="dialog" onClick={() => setFeedbackTargetId(selectedViewing.viewing.id)}>{mt(canShareFeedback ? 'tourFeedbackOpen' : 'tourFeedbackView', { ns: 'common' })}</Button>}
                  {selectedViewing.viewing.status === 'pending' && Date.parse(selectedViewing.viewing.scheduledAt) <= Date.now() && <Button variant="outline" onClick={() => setStatusAction('cancel')}>{mt('tourCloseExpiredRequest')}</Button>}
                  {selectedViewing.viewing.status === 'pending' && Date.parse(selectedViewing.viewing.scheduledAt) > Date.now() && <Button onClick={() => setStatusAction('confirm')} disabled={updateStatusMutation.isPending || proposeReschedule.isPending || !!selectedViewing.viewing.rescheduleProposedSlots?.length}>{mt('acceptViewing')}</Button>}
                  {canProposeChange && <Button ref={proposalTrigger} variant="outline" disabled={updateStatusMutation.isPending || proposeReschedule.isPending} onClick={() => setProposalOpen(true)}><CalendarClock className="h-4 w-4 shrink-0" />{mt(selectedViewing.viewing.status === 'pending' ? 'tourOfferAlternativeTimes' : 'tourProposeNewTimes')}</Button>}
                  {selectedViewing.viewing.status === 'pending' && Date.parse(selectedViewing.viewing.scheduledAt) > Date.now() && <Button className="text-destructive hover:text-destructive" variant="outline" disabled={proposeReschedule.isPending || updateStatusMutation.isPending} onClick={() => setStatusAction('cancel')}>{mt('declineRequest')}</Button>}
                  {selectedViewing.viewing.status === 'confirmed' && Date.parse(selectedViewing.viewing.scheduledAt) > Date.now() && <Button variant="outline" className="text-destructive hover:text-destructive" disabled={proposeReschedule.isPending || reviewReschedule.isPending || updateStatusMutation.isPending} onClick={() => setStatusAction('cancel')}>{mt('cancelViewing')}</Button>}
                </div>}
                {['confirm', 'cancel'].includes(statusAction) && <div className="space-y-4">{decisionKind === "confirm" && decisionReviewPanel}{decisionActionPanel}</div>}
                {['complete', 'no_show', 'disrupt'].includes(statusAction) && <div className="space-y-4 border-t pt-4">{decisionActionPanel}</div>}
                {!!selectedViewing.viewing.rescheduleProposedSlots?.length && ['pending', 'confirmed'].includes(selectedViewing.viewing.status) && new Date(selectedViewing.viewing.scheduledAt).getTime() > Date.now() && <section className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:p-5" aria-label={mt('tourProposalPendingTitle')}>
                  <div className="space-y-1"><h2 className="text-sm font-semibold leading-5">{mt('tourProposalPendingTitle')}</h2><p className="text-sm text-muted-foreground">{mt(selectedViewing.viewing.status === 'pending' ? 'tourPendingProposalAwaitingHelp' : 'tourProposalPendingHelp')}</p></div>
                  <ul className="space-y-2">{selectedViewing.viewing.rescheduleProposedSlots.map(time => <li key={time} className="rounded-lg border bg-background px-3 py-2 text-sm">{formatTourWhen(time, selectedViewing.viewing.durationMinutes, selectedViewing.locationTimezone || 'America/St_Johns')}</li>)}</ul>
                  {statusAction === 'view' && <Button variant="outline" className="h-auto min-h-11 w-full whitespace-normal py-2 sm:w-auto" disabled={proposeReschedule.isPending || updateStatusMutation.isPending || !!selectedViewing.viewing.checkedInAt} onClick={() => proposeReschedule.mutate('withdraw')}>{mt('tourWithdrawProposal')}</Button>}
                </section>}
                {canReviewReschedule(selectedViewing.viewing) && (
                  <div ref={rescheduleReview} tabIndex={-1} className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4 focus:outline-none">
                    <p className="text-sm font-semibold leading-5">{mt("tourRescheduleRequest")}</p>
                    <p className="text-sm">{mt('tourRequestedTime')}: {formatTourWhen(selectedViewing.viewing.requestedRescheduleAt!, selectedViewing.viewing.durationMinutes, selectedViewing.locationTimezone || "America/St_Johns")}</p>
                    {decisionKind === "reschedule" && decisionReviewPanel}
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Button className="h-auto min-h-11 w-full whitespace-normal py-2" disabled={reviewReschedule.isPending || updateStatusMutation.isPending || !acceptanceReady} onClick={() => reviewReschedule.mutate({ id: selectedViewing.viewing.id, decision: "accept" })}>{mt('tourApproveNewTime')}</Button>
                      <Button variant="outline" className="h-auto min-h-11 w-full whitespace-normal py-2" disabled={reviewReschedule.isPending || updateStatusMutation.isPending} onClick={() => reviewReschedule.mutate({ id: selectedViewing.viewing.id, decision: "decline" })}>{mt('tourKeepOriginalTime')}</Button>
                    </div>
                  </div>
                )}
              </section>}</section>}
                {canEditTourNotes && <section id="tour-visit-notes" aria-label={mt('tourMeetingInstructionsTitle')} className="order-2 space-y-3 rounded-2xl border bg-card p-4 sm:px-5">
                  <div className="flex items-start gap-3"><FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" /><div className="space-y-1"><h2 className="text-sm font-semibold">{mt('tourMeetingInstructionsTitle')}</h2><p className="text-sm leading-relaxed text-muted-foreground">{mt('tourMeetingInstructionsHelp')}</p></div></div>
                  {(selectedViewing.arrivalNotes !== undefined || selectedViewing.departureNotes !== undefined) && <dl className="grid gap-3 sm:grid-cols-2">
                    <div><dt className="text-xs font-medium text-muted-foreground">{mt('arrivalInstructionsTitle')}</dt><dd className="mt-1 whitespace-pre-wrap text-sm">{selectedViewing.arrivalNotes?.trim() || mt('tourInstructionsMissing')}</dd></div>
                    <div><dt className="text-xs font-medium text-muted-foreground">{mt('departureInstructionsTitle')}</dt><dd className="mt-1 whitespace-pre-wrap text-sm">{selectedViewing.departureNotes?.trim() || mt('tourInstructionsMissing')}</dd></div>
                  </dl>}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs leading-relaxed text-muted-foreground">{mt('tourMeetingInstructionsScope')}</p><Button variant="outline" className="h-auto min-h-11 w-full shrink-0 whitespace-normal px-4 py-2 sm:w-auto" title={mt('tourEditVisitNotes')} onClick={() => requestNavigation(() => onConfigureNotes!(selectedViewing.viewing.targetedKitchenId!, selectedViewing.viewing.locationId, selectedViewing.viewing.id))}>{mt('tourVisitNotesButton')}<ArrowRight className="ml-2 h-4 w-4 shrink-0" /></Button></div>
                </section>}
              <div className="order-4 min-w-0 space-y-4">
                <section className="space-y-4 rounded-2xl border bg-card p-4 sm:px-5" aria-label={mt('tourChefRequestDetails')}>
                  <h2 className="text-sm font-semibold leading-5">{mt('tourChefRequestDetails')}</h2>
                  <dl className="grid gap-4 sm:grid-cols-2">
                    <div><dt className="text-xs text-muted-foreground">{mt('tourRequestedTime')}</dt><dd className="mt-1 text-sm">{formatTourWhen(selectedViewing.viewing.scheduledAt, selectedViewing.viewing.durationMinutes, selectedViewing.locationTimezone || 'America/St_Johns')}</dd></div>
                    {selectedViewing.viewing.createdAt && <div><dt className="text-xs text-muted-foreground">{mt('tourRequestSubmitted')}</dt><dd className="mt-1 text-sm">{formatTourWhen(selectedViewing.viewing.createdAt, null, selectedViewing.locationTimezone || 'America/St_Johns')}</dd></div>}
                  </dl>
                  <div className="space-y-1 border-t pt-3"><p className="text-sm font-medium">{mt('chefSNotes')}</p><p className="whitespace-pre-wrap text-sm text-muted-foreground">{selectedViewing.viewing.chefNotes?.trim() || mt('tourNoChefNotes')}</p></div>
                  {!!Object.keys(selectedViewing.viewing.intakeData || {}).length && <div className="space-y-3 border-t pt-3 [&>dl]:grid-cols-2 [&>dl>div:last-child:nth-child(odd)]:col-span-2">
                    <TourIntakeDetails data={selectedViewing.viewing.intakeData} />
                  </div>}
                  {selectedViewing.viewing.status === 'confirmed' && Date.parse(selectedViewing.viewing.scheduledAt) > Date.now() && <details className="group border-t pt-3">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"><h3 className="text-sm font-semibold">{mt('tourPrepareBriefing')}</h3><ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" /></summary>
                    <ul className="list-disc space-y-2 pb-1 pl-4 pt-2 text-sm leading-relaxed text-muted-foreground">
                      <li>{mt('tourPrepareSpace')}</li>
                      <li>{mt('tourPrepareAccess')}</li>
                      <li>{mt('tourPrepareQuestions')}</li>
                    </ul>
                  </details>}
                </section>
                {feedbackAfterEnd && <TourFeedbackPanel key={selectedViewing.viewing.id} id={selectedViewing.viewing.id} role="manager" version={selectedViewing.viewing.updatedAt} open={feedbackTargetId === selectedViewing.viewing.id} onOpenChange={open => setFeedbackTargetId(open ? selectedViewing.viewing.id : null)} triggerRef={feedbackTrigger} />}
                {!nextStepKey && !['confirm', 'cancel'].includes(statusAction) && decisionActionPanel}

                <Dialog open={proposalOpen && (canProposeChange || proposeReschedule.isPending)} onOpenChange={open => {
                  if (proposeReschedule.isPending) return
                  setProposalOpen(open)
                  if (!open) { setProposalDate(''); setProposedSlots([]) }
                }}>
                  <DialogContent className="max-w-xl gap-5 p-4 sm:p-6" onCloseAutoFocus={event => { event.preventDefault(); (proposalTrigger.current || heading.current)?.focus() }}>
                    <DialogHeader className="pr-10 text-left">
                      <DialogTitle>{mt(selectedViewing.viewing.status === 'pending' ? 'tourOfferAlternativeTimes' : 'tourProposeNewTimes')}</DialogTitle>
                      <DialogDescription>{mt(selectedViewing.viewing.status === 'pending' ? 'tourPendingProposalHelp' : 'tourProposalHelp')}</DialogDescription>
                    </DialogHeader>
                    <Button variant="ghost" size="icon" className="absolute right-2 top-2 h-11 w-11" aria-label={mt('close')} disabled={proposeReschedule.isPending} onClick={() => { setProposalOpen(false); setProposalDate(''); setProposedSlots([]) }}><X className="h-4 w-4" /></Button>
                    <p className="text-sm leading-relaxed text-muted-foreground">{mt('tourRescheduleScenarioHelp')}</p>
                    <div className="space-y-1 rounded-xl bg-muted/40 p-4 text-sm"><p className="text-xs font-medium text-muted-foreground">{mt('tourCurrentTime')}</p><p>{formatTourWhen(selectedViewing.viewing.scheduledAt, selectedViewing.viewing.durationMinutes, selectedViewing.locationTimezone || 'America/St_Johns')}</p></div>
                    <div className="space-y-4">
                    {(proposalCalendarError || proposalSlotsError) && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{(proposalCalendarError || proposalSlotsError)?.message}</p><Button variant="outline" size="sm" onClick={() => { void queryClient.invalidateQueries({ queryKey: ['manager-tour-reschedule-calendar'] }); void queryClient.invalidateQueries({ queryKey: ['manager-tour-reschedule-slots'] }) }}>{mt('tourReviewAgain')}</Button></div>}
                    <div className="space-y-1.5"><Label htmlFor="tour-proposal-date">{mt('tourNewDate')}</Label><DateField id="tour-proposal-date" className="min-h-11" value={proposalDate} onChange={setProposalDate} placeholder={mt('tourChooseDate')} disabled={proposeReschedule.isPending || proposalCalendarLoading || !!proposalCalendarError || !proposalCalendar} disabledDate={day => !tourAvailableDate(day, proposalCalendar)} /></div>
                    <p className="text-sm text-muted-foreground">{mt('tourChooseTimesHelp')}</p>
                    {proposalDate && <section className="space-y-3" aria-label={mt('tourAvailableTime')}>
                      <h3 className="text-sm font-semibold">{formatTourDate(new Date(proposalDate + 'T12:00:00Z'))}</h3>
                      <p className="text-xs text-muted-foreground">{mt('tourTimesTimezone')}</p>
                      {proposalSlotsLoading && <p role="status" className="text-sm text-muted-foreground">{mt('tourLoadingTimes')}</p>}
                      {!proposalSlotsLoading && !proposalSlotsError && !proposalChoices.length && <p role="status" className="text-sm text-muted-foreground">{mt('tourNoAvailableTimes')}</p>}
                      {!proposalSlotsLoading && !proposalSlotsError && <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{proposalTimeOptions.map(item => {
                        const selected = proposedSlots.includes(item.scheduledAt)
                        return <Button key={item.scheduledAt} variant={selected ? 'default' : 'outline'} className="h-auto min-h-11 whitespace-normal px-2 py-2 text-sm" aria-pressed={selected} disabled={proposeReschedule.isPending || !!proposalCalendarError || (!selected && proposedSlots.length >= 3)} onClick={() => setProposedSlots(current => current.includes(item.scheduledAt) ? current.filter(time => time !== item.scheduledAt) : [...current, item.scheduledAt].sort())}>{item.full}</Button>
                      })}</div>}
                    </section>}
                    {proposedSlots.length > 0 && <section className="space-y-2" aria-label={mt('tourSelectedTimes')}><h3 className="text-sm font-semibold">{mt('tourSelectedTimes')}</h3><ul className="space-y-2">{proposedSlots.map(time => <li key={time} className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3"><span className="text-sm">{formatTourWhen(time, selectedViewing.viewing.durationMinutes, 'America/St_Johns')}</span><Button variant="ghost" size="icon" aria-label={`${mt('tourRemoveAlternative')}: ${formatTourWhen(time, selectedViewing.viewing.durationMinutes, 'America/St_Johns')}`} disabled={proposeReschedule.isPending} onClick={() => setProposedSlots(current => current.filter(item => item !== time))}><X className="h-4 w-4" /></Button></li>)}</ul></section>}
                    <p className="rounded-xl border p-3 text-sm leading-relaxed text-muted-foreground">{mt(selectedViewing.viewing.status === 'pending' ? 'tourPendingProposalAwaitingHelp' : 'tourProposalOriginalHeld')}</p>
                    <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end"><Button variant="outline" className="h-auto min-h-11 w-full whitespace-normal py-2 sm:w-auto" disabled={proposeReschedule.isPending} onClick={() => { setProposalOpen(false); setProposalDate(''); setProposedSlots([]) }}>{mt('tourKeepCurrentTime')}</Button><Button className="h-auto min-h-11 w-full whitespace-normal py-2 sm:w-auto" disabled={proposeReschedule.isPending || updateStatusMutation.isPending || !proposedSlots.length || proposedSlots.some(time => Date.parse(time) <= Date.now()) || proposalSlotsLoading || !!proposalCalendarError || !!proposalSlotsError} onClick={() => proposeReschedule.mutate('propose')}>{proposeReschedule.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{mt('tourSendProposal')}</Button></div>
                    </div>
                  </DialogContent>
                </Dialog>

                {/* Intake Data */}
                {selectedViewing.viewing.sharedManagerNotes && statusAction === 'view' && <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">{mt('tourManagerNotes')}</p>
                  <p className="rounded bg-muted/50 p-2 text-sm whitespace-pre-wrap">{selectedViewing.viewing.sharedManagerNotes}</p>
                </div>}
                {selectedViewing.viewing.disruptionReason && <p className="text-sm">{selectedViewing.viewing.disruptionReason === 'outcome_unknown' ? mt('tourHistory_status_unverified') : <>{mt('tourDisruptionReason')}: {mt(`tourDisruption_${selectedViewing.viewing.disruptionReason}`)}</>}</p>}
                {!!selectedViewing.viewing.outcomeHistory?.length && statusAction === 'view' && <details className="rounded border p-3 text-sm">
                  <summary>{mt('tourOutcomeHistory')}</summary>
                  {selectedViewing.viewing.outcomeHistory.map((entry, index) => <div key={index} className="border-t py-2">
                    <p>{entry.from} → {entry.to} · {entry.recordedAt ? formatTourWhen(entry.recordedAt, null, 'America/St_Johns') : '—'}</p>
                    {entry.sharedNotes && <p className="whitespace-pre-wrap">{entry.sharedNotes}</p>}
                  </div>)}
                </details>}
              <div data-testid="manager-tour-help" className="[&>section]:rounded-2xl [&>section]:p-4 sm:[&>section]:px-5"><TourSupportCard role="manager" /></div>
              </div>
              </div>
              <aside className="contents lg:block lg:min-w-0 lg:space-y-4">
                <section aria-label={mt('tourVisitorContactTitle')} className="order-3 space-y-3 rounded-2xl border bg-card p-4 text-sm sm:px-5">
                  <h2 className="text-sm font-semibold leading-5">{mt('tourVisitorContactTitle')}</h2>
                  <dl className="space-y-3">
                    <div><dt className="text-xs text-muted-foreground">{mt('chef')}</dt><dd className="mt-1 font-medium">{selectedViewing.chefName || selectedViewing.chefUsername || mt('tourNotShared')}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{mt('tourChefEmail')}</dt><dd className="mt-1 break-all">{selectedViewing.chefEmail ? <a className="text-primary underline underline-offset-2" href={`mailto:${selectedViewing.chefEmail}`}>{selectedViewing.chefEmail}</a> : mt('tourNotShared')}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{mt('tourChefPhone')}</dt><dd className="mt-1">{selectedViewing.chefPhone ? <a className="text-primary underline underline-offset-2" href={`tel:${selectedViewing.chefPhone}`}>{selectedViewing.chefPhone}</a> : mt('tourNotShared')}</dd></div>
                  </dl>
                  <div className="min-w-0 [&_button]:h-auto [&_button]:min-h-11 [&_button]:w-full [&_button]:whitespace-normal [&_button]:py-2">
                    <TourChatButton tour={selectedViewing.viewing} role="manager" openFromLink buttonLabel={mt('tourMessageVisitor', { name: selectedViewing.chefName?.trim().split(/\s+/)[0] || mt('tourHistoryActor_chef') })} />
                  </div>
                </section>
                <div className="order-5 min-w-0 [&>section]:rounded-2xl [&>section]:p-4 sm:[&>section]:px-5"><TourHistoryPanel id={selectedViewing.viewing.id} version={selectedViewing.viewing.updatedAt} /></div>
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
