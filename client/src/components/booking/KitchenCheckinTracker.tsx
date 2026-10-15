import { friendlyTimezoneName } from '@shared/timezone-utils';
import { VisitDutyValidationError, type DutyFieldErrors } from '@shared/visit-duties';
/**
 * KitchenCheckinTracker
 *
 * Full-page kitchen visit: a visible status summary (current state, kitchen-local
 * times, next step), the kitchen's arrival/departure instructions, and the
 * check-in or checkout task when one is available.
 */

import { useState, useEffect, useRef, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Camera, Clock, CheckCircle2, Loader2, FileWarning, LogIn, LogOut, Calendar, XCircle, Info, Ban } from "lucide-react"
import { InfoChip, type InfoChipVariant } from "@/components/chef/info-chip"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createBookingDateTime, DEFAULT_TIMEZONE } from "@shared/timezone-utils"
import { calendarDateForBookingTime } from "@shared/operating-hours"
import { lateCheckoutOpen } from "@shared/clock-closeout"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { useKitchenCheckin, VisitCodeError, type KitchenCheckinStatus } from "@/hooks/use-kitchen-checkin"
import { VisitCodeField, visitCodeGate, type VisitCodeProblem } from "./VisitCodeField"
import { useLocationChecklist, type ChecklistItem, type PhotoRequirement } from "@/hooks/use-location-checklist"
import { Checkbox } from "@/components/ui/checkbox"
import { bt } from "@/i18n/booking-ns";
import { PhotoRequirementUploader, flattenPhotos, areAllRequiredPhotosUploaded } from "./PhotoRequirementUploader"
import { InSessionPanel } from "./InSessionPanel"
import { VISIT_CODE_LENGTH } from "@shared/visit-code"
import { ArrivalModeLine, InstructionsOverview } from "./BookingPreparation"
import { MessageKitchenButton } from "./MessageKitchenButton"
import { RunningLateCard } from "./RunningLateCard"
import { SessionExtensionsCard } from "./SessionExtensionsCard"
import { formatVisitWhen } from "@/lib/visit-when"
import { visitStatusSentence } from "@/lib/visit-status-sentence"
import { SmartImage } from "@/components/ui/smart-image"
import { getR2ProxyUrl } from "@/utils/r2-url-helper"

// ─── Types ────────────────────────────────────────────────────────────────────

interface KitchenCheckinTrackerProps {
  onSuccess: (kind: "checkin" | "checkout") => void
  /** Kitchen phone, when the booking has one; shown beside "Message kitchen". */
  kitchenPhone?: string | null
  initialVisitId?: number | null
  bookingId: number
  kitchenName?: string
  /** Cover photo of the kitchen, when it has one. */
  kitchenImageUrl?: string | null
  bookingDate?: string
  startTime?: string
  endTime?: string
}

type Translate = (key: string, defaultText?: string, vars?: Record<string, unknown>) => string

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTimestamp(ts: string | null | undefined, timezone: string, locale: string): string {
  if (!ts) return ""
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: timezone, dateStyle: "medium", timeStyle: "short", hour12: true }).format(new Date(ts))
  } catch {
    return ""
  }
}

const STATUS_CHIPS: Record<KitchenCheckinStatus, { variant: InfoChipVariant; icon: ReactNode; fallback: string }> = {
  not_checked_in: { variant: "outline", icon: <Clock className="h-3 w-3" />, fallback: "Not checked in" },
  checked_in: { variant: "success", icon: <LogIn className="h-3 w-3" />, fallback: "Checked in" },
  checkout_requested: { variant: "info", icon: <Camera className="h-3 w-3" />, fallback: "Checkout requested" },
  checked_out: { variant: "success", icon: <LogOut className="h-3 w-3" />, fallback: "Checked out" },
  no_show: { variant: "destructive", icon: <XCircle className="h-3 w-3" />, fallback: "No-show reported" },
  checkout_claim_filed: { variant: "warning", icon: <FileWarning className="h-3 w-3" />, fallback: "Claim filed" },
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function KitchenCheckinTracker({
  onSuccess,
  kitchenPhone,
  initialVisitId,
  bookingId,
  kitchenName,
  kitchenImageUrl,
  bookingDate,
  startTime,
  endTime,
}: KitchenCheckinTrackerProps) {
  const { t: tStrict, i18n } = useTranslation("chef");
  const t: Translate = (key, defaultText, vars) => {
    const val = tStrict(key as any, { ...vars, defaultValue: defaultText || key }) as string;
    return val !== key ? val : (defaultText || key);
  };

  const [selectedVisitId, setSelectedVisitId] = useState<number | null>(initialVisitId ?? null)
  const {
    status: data,
    isLoading,
    isError,
    error,
    refetch,
    canCheckin,
    canCheckout,
    checkin,
    isCheckingIn,
    checkout,
    isCheckingOut,
  } = useKitchenCheckin(bookingId, selectedVisitId)

  // Current requirements drive the live form; the saved snapshot is evidence only.
  const checklistQuery = useLocationChecklist(data?.currentVisitDuties ? null : data?.locationId, data?.kitchenId)
  const currentChecklist = checklistQuery.data
  const duties = data?.visitDuties
  const currentDuties = data?.currentVisitDuties
  const checklist = currentDuties ? {
    checkinItems: currentDuties.arrival.items as ChecklistItem[],
    checkoutItems: currentDuties.departure.items as ChecklistItem[],
    checkinPhotoRequirements: currentDuties.arrival.photos as PhotoRequirement[],
    checkoutPhotoRequirements: currentDuties.departure.photos as PhotoRequirement[],
    checkinInstructions: currentDuties.arrival.instructions, checkoutInstructions: currentDuties.departure.instructions,
  } : currentChecklist
  const updatedSinceBooking = !!duties && !!checklist && JSON.stringify([
    checklist.checkinInstructions, checklist.checkoutInstructions, checklist.checkinItems, checklist.checkoutItems,
    checklist.checkinPhotoRequirements, checklist.checkoutPhotoRequirements,
  ]) !== JSON.stringify([duties.arrival.instructions, duties.departure.instructions, duties.arrival.items,
    duties.departure.items, duties.arrival.photos, duties.departure.photos])

  const [arrivedAt, setArrivedAt] = useState<string | null>(null)
  const [checkinNotes, setCheckinNotes] = useState("")
  const [checkoutNotes, setCheckoutNotes] = useState("")
  const [submitError, setSubmitError] = useState("")
  const [fieldErrors, setFieldErrors] = useState<DutyFieldErrors>({})
  // Photos keyed by requirement id (or __generic__ when no requirements defined)
  const [checkinPhotos, setCheckinPhotos] = useState<Record<string, string[]>>({})
  const [checkoutPhotos, setCheckoutPhotos] = useState<Record<string, string[]>>({})
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set())
  // Visit code: kept in memory only. The request key is fixed for one attempt and reused on retry;
  // it changes only when the entered code changes (a different operation).
  const [visitCodeInput, setVisitCodeInput] = useState("")
  const [codeProblem, setCodeProblem] = useState<VisitCodeProblem | null>(null)
  const requestKeyRef = useRef<string>("")
  if (!requestKeyRef.current) requestKeyRef.current = crypto.randomUUID()

  useEffect(() => { setSelectedVisitId(initialVisitId ?? null) }, [bookingId, initialVisitId])
  useEffect(() => {
    setCheckinNotes("")
    setCheckoutNotes("")
    setCheckinPhotos({})
    setCheckoutPhotos({})
    setCheckedItems(new Set())
    setSubmitError("")
    setFieldErrors({})
    setVisitCodeInput("")
    setCodeProblem(null)
    setArrivalChanged(false)
    requestKeyRef.current = crypto.randomUUID()
  }, [bookingId, data?.visitId])

  const checkinStatus: KitchenCheckinStatus =
    (data?.checkinStatus as KitchenCheckinStatus) || "not_checked_in"

  // Only configured mandatory items block submission.
  const allCheckinItemsChecked = (checklist?.checkinItems || []).every(
    (i: ChecklistItem) => i.required === false || checkedItems.has(i.id),
  )
  const allCheckoutItemsChecked = (checklist?.checkoutItems || []).every(
    (i: ChecklistItem) => i.required === false || checkedItems.has(i.id),
  )

  const checkinPhotoReqs: PhotoRequirement[] = checklist?.checkinPhotoRequirements || []
  const checkoutPhotoReqs: PhotoRequirement[] = checklist?.checkoutPhotoRequirements || []

  const remainingTasks = (stage: 'checkin' | 'checkout') => (stage === 'checkin' ? checklist?.checkinItems : checklist?.checkoutItems)?.filter(item => item.required !== false && !checkedItems.has(item.id)).length || 0;
  const submitHelp = (stage: 'checkin' | 'checkout') => remainingTasks(stage) > 0
    ? t('kciCompleteRequiredTasks', `Complete ${remainingTasks(stage)} required ${remainingTasks(stage) === 1 ? 'task' : 'tasks'} to continue`, { count: remainingTasks(stage) })
    : !(stage === 'checkin' ? allCheckinPhotosUploaded : allCheckoutPhotosUploaded) ? t('kciCompleteRequiredPhotos') : '';
  const allCheckinPhotosUploaded = areAllRequiredPhotosUploaded(checkinPhotoReqs, checkinPhotos)
  const allCheckoutPhotosUploaded = areAllRequiredPhotosUploaded(checkoutPhotoReqs, checkoutPhotos)

  const codeState = data?.visitCode
  const codeGate = visitCodeGate(codeState, codeProblem?.code === "VISIT_CODE_WRONG" && codeProblem.attemptsLeft === 0 ? "VISIT_CODE_LOCKED" : codeProblem?.code)
  const codeMissing = codeGate === "code" && visitCodeInput.length !== VISIT_CODE_LENGTH
  // The kitchen unlocked, reissued or switched the mode while the chef waited: drop only the stale code and
  // error (tasks, photos and notes are kept) and tell them the arrival details changed.
  const [arrivalChanged, setArrivalChanged] = useState(false)
  const previousCodeState = useRef(codeState)
  useEffect(() => {
    const before = previousCodeState.current
    previousCodeState.current = codeState
    if (!before || !codeState || before.visitId !== codeState.visitId) return
    const modeChanged = before.mode !== codeState.mode
    if (modeChanged || (before.locked && !codeState.locked) || codeState.attemptsLeft > before.attemptsLeft) {
      setVisitCodeInput("")
      setCodeProblem(null)
      requestKeyRef.current = crypto.randomUUID()
      setArrivalChanged(true)
    }
  }, [codeState])
  const changeVisitCode = (digits: string) => {
    setVisitCodeInput(digits)
    setCodeProblem(null)
    requestKeyRef.current = crypto.randomUUID()
  }

  const handleCheckin = async () => {
    setSubmitError("")
    setFieldErrors({})
    setCodeProblem(null)
    setArrivalChanged(false)
    if (codeGate === "locked" || codeGate === "revoked") return
    if (codeMissing) {
      setCodeProblem({ code: "VISIT_CODE_REQUIRED" })
      return
    }
    if (!allCheckinPhotosUploaded) {
      toast.error(
        t("kciErrUploadPhotos", "Please upload a photo for each required item before checking in"),
      )
      return
    }
    if (!allCheckinItemsChecked) {
      toast.error(t("kciErrCompleteChecklist", "Please complete all checklist items before checking in"))
      return
    }
    // Build checklist audit trail from checked items
    const checkinChecklistItems = (checklist?.checkinItems || []).map((i: ChecklistItem) => ({
      id: i.id,
      label: i.label,
      checked: checkedItems.has(i.id),
    }))
    try {
      await checkin({
        checkinNotes: checkinNotes || undefined,
        checkinPhotoUrls: flattenPhotos(checkinPhotos),
        checkinChecklistItems: checkinChecklistItems.length > 0 ? checkinChecklistItems : undefined,
        ...(codeGate === "code" ? { visitCode: visitCodeInput, requestKey: requestKeyRef.current } : {}),
      })
      toast.success(t("kciCheckedInSuccess"))
      setVisitCodeInput("")
      setCheckinNotes("")
      setCheckinPhotos({})
      setCheckedItems(new Set())
      setArrivedAt(new Date().toISOString())
      void refetch()
      onSuccess("checkin")
    } catch (error) {
      if (error instanceof VisitCodeError) {
        // Code problems stay beside the field; the code, tasks, photos and notes are all kept.
        setCodeProblem({ code: error.code, attemptsLeft: error.attemptsLeft })
        void refetch()
        return
      }
      // fetch() rejects with a TypeError when the network is down; the arrival may or may not have been saved.
      const message = error instanceof TypeError
        ? t("kciAcNetwork", "Arrival hasn't been confirmed yet. Your details are kept while this page stays open. Try again when you're connected, or ask the kitchen to record your arrival.")
        : error instanceof Error ? error.message : t("kciCheckInFailed")
      setSubmitError(message)
      if (error instanceof VisitDutyValidationError) setFieldErrors(error.fieldErrors)
      void refetch()
      toast.error(message)
    }
  }

  const handleCheckout = async () => {
    setSubmitError("")
    setFieldErrors({})
    if (!allCheckoutPhotosUploaded) {
      toast.error(
        t("kciUploadPhotosCheckout"),
      )
      return
    }
    if (!allCheckoutItemsChecked) {
      toast.error(t("kciCompleteChecklistCheckout"))
      return
    }
    // Build checklist audit trail from checked items
    const checkoutChecklistItems = (checklist?.checkoutItems || []).map((i: ChecklistItem) => ({
      id: i.id,
      label: i.label,
      checked: checkedItems.has(i.id),
    }))
    try {
      await checkout({
        checkoutNotes: checkoutNotes || undefined,
        checkoutPhotoUrls: flattenPhotos(checkoutPhotos),
        checkoutChecklistItems: checkoutChecklistItems.length > 0 ? checkoutChecklistItems : undefined,
      })
      toast.success(t("kciCheckoutRequestedToast"))
      setCheckoutNotes("")
      setCheckoutPhotos({})
      setCheckedItems(new Set())
      onSuccess("checkout")
    } catch (error) {
      const message = error instanceof Error ? error.message : t("kciCheckoutRequestFailed")
      setSubmitError(message)
      if (error instanceof VisitDutyValidationError) setFieldErrors(error.fieldErrors)
      void refetch()
      toast.error(message)
    }
  }

  const timezone = data?.timezone || DEFAULT_TIMEZONE
  const locale = i18n.resolvedLanguage || i18n.language || "en-CA"
  const visitDate = (data?.bookingDate || bookingDate)?.split("T")[0]
  // The header already carries the visit date: same-day times show the time only, others drop the year.
  const formatTime = (ts: string | null | undefined) => {
    if (!ts) return formatTimestamp(ts, timezone, locale)
    const at = new Date(ts)
    const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at)
    return new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: "numeric", minute: "2-digit",
      ...(dayKey === visitDate ? {} : { month: "short", day: "numeric" }) }).format(at)
  }
  const formatVisit = (start: string, end: string) => {
    if (!visitDate) return `${start}–${end}`
    const begins = createBookingDateTime(calendarDateForBookingTime(visitDate, start, data?.operatingWindowStartTime), start, timezone)
    const ends = createBookingDateTime(calendarDateForBookingTime(visitDate, end, data?.operatingWindowStartTime, start), end, timezone)
    return formatVisitWhen(begins, ends, timezone, locale)
  }
  const visitStart = data?.startTime || startTime
  const visitEnd = data?.endTime || endTime
  const timeLabel = visitDate && visitStart && visitEnd ? formatVisit(visitStart, visitEnd) : undefined
  // Same window the hook uses to enable check-in, so the shown time matches the button.
  const checkinOpensAt = data && visitDate && visitStart
    ? new Date(createBookingDateTime(calendarDateForBookingTime(visitDate, visitStart, data.operatingWindowStartTime), visitStart, timezone).getTime()
      - (data.checkinWindowMinutesBefore ?? 15) * 60_000)
    : null
  const clockVisit = data?.visitCloseout || data?.closeout?.visits[0]
  const clockEnded = !!clockVisit && ["booked_time_ended", "ended"].includes(clockVisit.phase)
  const liveBooking = !clockEnded && !!data && ["confirmed", "cancellation_requested"].includes(data.status)
  const beforeCheckinOpens = !!checkinOpensAt && Date.now() < checkinOpensAt.getTime()
  const visitFinished = clockEnded || ["checked_out", "checkout_claim_filed", "no_show"].includes(checkinStatus)
  // Still checked in after the booked end: checkout stays open until the inspection window closes (the booking may
  // already read "completed"). One clear state: the booking ended, check out now, the kitchen may charge extra time.
  const lateCheckout = !!data && ["confirmed", "completed"].includes(data.status) && checkinStatus === "checked_in" && clockEnded && lateCheckoutOpen(clockVisit)
  const isDeparture = (data?.status === "confirmed" && (canCheckout || checkinStatus === "checked_in")) || lateCheckout
  const showInSessionEarly = !!data && (data.status === "confirmed" || lateCheckout) && checkinStatus === "checked_in" && !!clockVisit
    && (clockVisit.phase !== "ended" || lateCheckout) && !!data.chefId
  const isArrival = !isDeparture && data?.status === "confirmed" && checkinStatus === "not_checked_in"
  const title = showInSessionEarly ? t("kciInSessionTitle", "Your visit")
    : isDeparture ? t("kciDepartureTitle", "Kitchen departure")
    : isArrival ? t("kciArrivalTitle", "Kitchen arrival")
      : t("kciVisitTitle", "Kitchen visit")
  const dutiesReady = !!currentDuties || !!currentChecklist
  const isPending = isCheckingIn || isCheckingOut
  const requirementsMessage = t("kciConfiguredTasks", "Only checklist items and photos marked Required must be completed. Everything marked Optional can be skipped.")
  const hasCheckinTasks = (checklist?.checkinItems || []).length > 0 || checkinPhotoReqs.length > 0
  const hasCheckoutTasks = (checklist?.checkoutItems || []).length > 0 || checkoutPhotoReqs.length > 0

  // In session: arrival recorded, departure not yet recorded, and the booked time has not fully closed.
  const showInSession = showInSessionEarly
  const requiredCheckoutTasks = (checklist?.checkoutItems || []).filter(item => item.required !== false).length
    + checkoutPhotoReqs.filter(photo => photo.required).length
  const startCheckout = () => {
    const section = document.getElementById("visit-checkout-section")
    section?.scrollIntoView?.({ behavior: "smooth", block: "start" })
    document.getElementById("visit-checkout-title")?.focus()
  }

  const hideIdleChip = !clockEnded && data?.status === "confirmed" && checkinStatus === "not_checked_in"
  const chip = lateCheckout
    ? { variant: "warning" as InfoChipVariant, icon: <Clock className="h-3 w-3" />, label: t("kciIsTimeEnded", "Your booked time ended") }
    : clockEnded
    ? { variant: "outline" as InfoChipVariant, icon: <CheckCircle2 className="h-3 w-3" />, label: t("clockVisitFinished") }
    : data?.status === "cancelled" && checkinStatus === "not_checked_in"
    ? { variant: "outline" as InfoChipVariant, icon: <Ban className="h-3 w-3" />, label: t("kciCancelled", "Cancelled") }
    : { ...STATUS_CHIPS[checkinStatus], label: t(`visitStatus_${checkinStatus}`, STATUS_CHIPS[checkinStatus].fallback) }
  const overstayEnd = clockVisit ? `${new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(clockVisit.scheduledEndAt))} ${friendlyTimezoneName(timezone, locale)}` : ""
  const coverUrl = kitchenImageUrl?.trim() ? (getR2ProxyUrl(kitchenImageUrl) || kitchenImageUrl) : null
  const kitchenLabel = kitchenName || t("kitchenDefault", "Kitchen")
  // The chip already says "Visit finished"; the sentence below says what that means for this visit, once, and carries the time.
  const clockTime = (ts: string | null | undefined) => {
    if (!ts) return ""
    try { return new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(ts)) } catch { return "" }
  }
  const sentenceBase = {
    bookingStatus: data?.status, checkinStatus, canCheckin, canCheckout, beforeCheckinOpens, clockEnded, lateCheckout,
    inspectionOutcome: clockVisit?.inspection?.outcome, kitchen: kitchenLabel,
  }
  // Missing = released, so the page keeps working against a server that predates the gate.
  const instructionsReleased = data?.instructionsReleased !== false
  const arrivalMode = codeState ? codeState.mode : "legacy"
  const visitStartAt = data && visitDate && visitStart
    ? createBookingDateTime(calendarDateForBookingTime(visitDate, visitStart, data.operatingWindowStartTime), visitStart, timezone) : null
  const visitEndAt = data && visitDate && visitEnd && visitStart
    ? createBookingDateTime(calendarDateForBookingTime(visitDate, visitEnd, data.operatingWindowStartTime, visitStart), visitEnd, timezone) : null
  const bookingEndsText = visitEndAt
    ? `${new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true }).format(visitEndAt)} ${friendlyTimezoneName(timezone, locale)}` : ""
  // Late arrival never moves the end: say so before check-in (once the start has passed) and after it.
  const startedBeforeCheckin = !!visitStartAt && !!bookingEndsText && data?.status === "confirmed" && checkinStatus === "not_checked_in" && liveBooking && Date.now() >= visitStartAt.getTime()
  const checkedInLate = !!visitStartAt && !!bookingEndsText && !!data?.checkedInAt && Date.parse(data.checkedInAt) > visitStartAt.getTime()
  const checkedInStamp = data?.checkedInAt || arrivedAt
  const sentence = data ? visitStatusSentence({
    ...sentenceBase, startedBeforeCheckin, checkedInLate: checkedInLate && !!checkedInStamp,
    checkedInTime: clockTime(checkedInStamp), checkoutTime: clockTime(data.checkoutRequestedAt),
    bookingEnds: lateCheckout ? overstayEnd : bookingEndsText,
  }, t) : { text: "", coversCheckin: false, coversCheckout: false }
  const nextStep = sentence.text
  // Kitchen-local times that matter for this visit, in the order they happen. A time the sentence already
  // states is not repeated, and the kitchen's review deadline is never shown to the chef.
  const times: Array<{ label: string; value: string }> = []
  if (data) {
    if (data.status === "confirmed" && checkinStatus === "not_checked_in" && beforeCheckinOpens && checkinOpensAt) {
      times.push({ label: t("bdCheckinOpens", "Check-in opens"), value: formatTime(checkinOpensAt.toISOString()) })
    }
    if (data.checkedInAt && !sentence.coversCheckin) times.push({ label: t("kciTimeCheckedIn", "Check-in time"), value: formatTime(data.checkedInAt) })
    if (data.checkoutRequestedAt && !sentence.coversCheckout) times.push({ label: t("kciTimeCheckoutSubmitted", "Checkout time"), value: formatTime(data.checkoutRequestedAt) })
    if (checkinStatus === "checked_out" && data.checkoutApprovedAt) times.push({ label: t("kciTimeReviewed", "Checkout closed"), value: formatTime(data.checkoutApprovedAt) })
    if (checkinStatus === "checkout_claim_filed" && data.checkoutApprovedAt) times.push({ label: t("kciTimeIssueReported", "Issue reported"), value: formatTime(data.checkoutApprovedAt) })
    if (data.noShowDetectedAt) times.push({ label: t("kciTimeNoShow", "Reported"), value: formatTime(data.noShowDetectedAt) })
  }

  const overviewTasks = [...(checklist?.checkinItems || []), ...(checklist?.checkoutItems || [])].filter(item => item.required !== false).map(item => item.label)
    .concat([...checkinPhotoReqs, ...checkoutPhotoReqs].filter(photo => photo.required).map(photo => photo.label))
  const arrivalInstructions = {
    key: "arrival",
    title: t("kciArrivalInstructions", "Arrival instructions"),
    body: checklist?.checkinInstructions || t("kciNoArrivalInstructions", "No arrival instructions provided. Use your booking contact details if you need help getting in."),
  }
  const departureInstructions = {
    key: "departure",
    title: t("kciDepartureInstructions", "Departure instructions"),
    body: checklist?.checkoutInstructions || t("kciNoDepartureInstructions", "No departure instructions provided. Contact the kitchen manager if you need help leaving the kitchen ready."),
  }
  // Only the step the chef is on: arrival before check-in, departure once checked in.
  const beforeArrival = checkinStatus === "not_checked_in" && !isDeparture
  const instructions = showInSession ? [departureInstructions] : isDeparture ? [departureInstructions, arrivalInstructions] : beforeArrival ? [arrivalInstructions] : [arrivalInstructions, departureInstructions]
  const instructionsShown = liveBooking && !visitFinished && instructionsReleased
  // The saved copy is history: while the visit is live the current instructions above are what matters.
  const recordedLines = instructionsShown ? [] : [
    data?.checkedInAt ? duties?.arrival.instructions : null,
    data?.checkoutRequestedAt ? duties?.departure.instructions : null,
  ].filter((line): line is string => !!line)

  const renderChecklist = (items: ChecklistItem[], label: string) => (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      {items.map((item: ChecklistItem, index: number) => (
        <label key={item.id} className="flex items-start gap-2.5 p-2 rounded-lg border bg-background hover:bg-muted/50 cursor-pointer transition-colors">
          <Checkbox
            aria-label={item.label}
            disabled={isPending}
            checked={checkedItems.has(item.id)}
            onCheckedChange={(checked) => {
              setCheckedItems(prev => {
                const next = new Set(prev)
                if (checked) next.add(item.id)
                else next.delete(item.id)
                return next
              })
            }}
            className="mt-0.5"
          />
          <div className="flex-1 min-w-0">
            <span className="text-sm">
              <span className="tabular-nums font-medium text-muted-foreground mr-1.5">{index + 1}.</span>
              {item.label}
              <span className="ml-2 text-xs text-muted-foreground">{item.required !== false ? t("kciRequired", "Required") : t("kciOptional", "Optional")}</span>
            </span>
            {item.description && (
              <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
            )}
          </div>
        </label>
      ))}
    </div>
  )

  const renderRecordedChecklist = (items: Array<{ id: string; label: string; checked: boolean }>, label: string) => (
    <div className="rounded-lg border p-3">
      <p className="text-xs font-medium mb-2">{label}</p>
      <div className="space-y-1">
        {items.map((item, index) => (
          <div key={item.id} className="flex items-center gap-2">
            <Checkbox aria-label={item.label} checked={item.checked} disabled className="pointer-events-none" />
            <span className="tabular-nums text-xs font-medium text-muted-foreground">{index + 1}.</span>
            <span className={cn("text-xs", item.checked ? "text-foreground" : "text-destructive line-through")}>
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <section className="space-y-5" aria-labelledby="kitchen-visit-title">
        <header className="overflow-hidden rounded-2xl border bg-card [@media(hover:hover)]:shadow-sm sm:flex sm:flex-row-reverse">
          {coverUrl && <SmartImage src={coverUrl} alt="" hideOnError className="h-36 w-full object-cover sm:h-auto sm:w-56 sm:shrink-0" />}
          <div className="min-w-0 flex-1 p-4 sm:p-6">
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <h1 id="kitchen-visit-title" className="flex items-center gap-2 text-[22px] font-semibold leading-7 tracking-tight">
                  <Calendar className="h-5 w-5 shrink-0 text-muted-foreground" />
                  {title}
                </h1>
                <p className="mt-2 text-[15px] font-medium leading-snug">{kitchenName || t("kitchenDefault", "Kitchen")}</p>
                {/* Wait for the kitchen's timezone so times never flash in a default zone. */}
                {data && timeLabel && <p className="mt-1 text-[13px] leading-[18px] tabular-nums text-muted-foreground">{timeLabel} · {friendlyTimezoneName(timezone, locale)}</p>}
              </div>
            </div>

            {!isLoading && data && (
              <section aria-label={t("kciVisitStatus", "Visit status")} className="mt-5 space-y-3 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
                {!hideIdleChip && <InfoChip variant={chip.variant} icon={chip.icon}>{chip.label}</InfoChip>}
                <p className={cn("text-[15px] leading-[22px]", lateCheckout && "font-medium")} data-testid="visit-next-step" role={lateCheckout ? "alert" : undefined}>{nextStep}</p>
                {times.length > 0 && (
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                    {times.map(time => (
                      <div key={time.label}>
                        <dt className="text-[13px] leading-[18px] text-muted-foreground">{time.label}</dt>
                        <dd className="mt-0.5 text-[15px] font-medium tabular-nums">{time.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {data.status === "confirmed" && checkinStatus === "not_checked_in" && beforeCheckinOpens && (
                  <MessageKitchenButton link bookingId={bookingId} label={t("rlArrivedEarly", "Arrived early? Message the kitchen")} />
                )}
                {data.status === "confirmed" && checkinStatus === "not_checked_in" && (
                  <SessionExtensionsCard bookingId={bookingId} manager={false} chefName="" only="early_start" onChanged={() => void refetch()} />
                )}
                {data.status === "confirmed" && liveBooking && (
                  <RunningLateCard bookingId={bookingId} visitId={data.visitId} kitchenName={kitchenName} startAt={visitStartAt} endAt={visitEndAt}
                    timezone={timezone} status={data.status} checkedIn={checkinStatus !== "not_checked_in"} runningLate={data.runningLate} onChanged={() => void refetch()} />
                )}
              </section>
            )}
          </div>
        </header>
        {showInSession && clockVisit && data && (
          <InSessionPanel bookingId={bookingId} chefId={data.chefId} kitchenName={kitchenName || t("kitchenDefault", "Kitchen")}
            timezone={timezone} scheduledStartAt={clockVisit.scheduledStartAt} scheduledEndAt={clockVisit.scheduledEndAt}
            canCheckout={canCheckout && dutiesReady} onStartCheckout={startCheckout} onRefresh={() => void refetch()}
            departureInstructions={checklist?.checkoutInstructions || undefined} requiredTaskCount={requiredCheckoutTasks} />
        )}

        {data?.visits && data.visits.length > 1 && (
          <div className="space-y-2" role="group" aria-labelledby="kitchen-visit-choice">
            <p id="kitchen-visit-choice" className="text-sm font-medium">{t("kciChooseVisit", "Choose a visit")}</p>
            {data.visits.map(visit => (
              <Button key={visit.id} type="button" size="sm"
                variant={data.visitId === visit.id ? 'default' : 'outline'}
                className="w-full h-auto whitespace-normal flex-wrap gap-2 justify-between text-left"
                aria-pressed={data.visitId === visit.id}
                disabled={isPending}
                onClick={() => setSelectedVisitId(visit.id)}>
                <span>{t("kciVisitNumber", `Visit ${visit.blockIndex + 1}`, { number: visit.blockIndex + 1 })}: {formatVisit(visit.startTime, visit.endTime)}</span>
                <span>{t(`visitStatus_${visit.checkinStatus}`, visit.checkinStatus.replaceAll("_", " "))}</span>
              </Button>
            ))}
          </div>
        )}

        {submitError && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive space-y-2">
          <p>{submitError}</p>
          <Button variant="outline" disabled={isPending} onClick={() => void refetch()}>{t("kciRetryVisit", "Retry visit details")}</Button>
        </div>}
        {isError && <div role="alert" className="rounded-lg border p-3 text-sm space-y-2">
          <p>{error instanceof Error ? `${error.message} ` : ""}{t("kciStatusLoadFailed", "Anything you've entered is kept. Retry, or contact the kitchen manager.")}</p>
          <Button variant="outline" onClick={() => void refetch()}>{t("kciRetryVisit", "Retry visit details")}</Button>
        </div>}
        {!isLoading && liveBooking && !visitFinished && !instructionsReleased && checkinStatus === "not_checked_in" && <section className="rounded-2xl border bg-card p-5 sm:p-6" aria-labelledby="visit-instructions-title">
          <h2 id="visit-instructions-title" className="sr-only">{t("kciRequiredInstructions", "Visit instructions")}</h2>
          <InstructionsOverview mode={arrivalMode} releaseAt={data?.instructionsReleaseAt} timezone={timezone}
            visitStartAt={visitStartAt} requiredTasks={overviewTasks} />
        </section>}
        {!isLoading && liveBooking && !visitFinished && instructionsReleased && !showInSession && <section className="rounded-2xl border bg-card p-5 sm:p-6 space-y-4" aria-labelledby="visit-instructions-title">
          <h2 id="visit-instructions-title" className="font-semibold">{t("kciRequiredInstructions", "Visit instructions")}</h2>
          {checkinStatus === "not_checked_in" && !codeState?.consumed && <ArrivalModeLine mode={arrivalMode} />}
          {updatedSinceBooking && <p className="text-xs text-muted-foreground">{t("kciInstructionsUpdated", "Updated by the kitchen since you booked")}</p>}
          {instructions.map(item => (
            <div key={item.key}>
              <h3 className="text-sm font-medium">{item.title}</h3>
              <p className="mt-1 text-sm whitespace-pre-line">{item.body}</p>
            </div>
          ))}
          {beforeArrival && <p className="text-xs text-muted-foreground" data-testid="departure-after-checkin">{t("kciDepartureAfterCheckin", "Departure instructions appear here after you check in.")}</p>}
          {/* In session the panel above already offers Message kitchen. */}
          {!showInSession && codeGate !== "locked" && codeGate !== "revoked" && <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{t("kciHelpActions", "Having trouble getting in or submitting? Reach the kitchen:")}</p>
            <MessageKitchenButton bookingId={bookingId} phone={kitchenPhone} />
          </div>}
        </section>}
        {!currentDuties && checklistQuery.isError && <div role="alert" className="rounded-lg border p-3 text-sm">
          <p>{t("kciDutiesLoadFailed", "Could not load your visit requirements. Retry before submitting.")}</p>
          <Button variant="outline" onClick={() => void checklistQuery.refetch()}>{t("kciRetryRequirements", "Retry requirements")}</Button>
        </div>}

        {isLoading ? (
          <div className="space-y-4 py-3" role="status" aria-label={t("kciLoadingVisit", "Loading visit")}>
            {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-16 w-full rounded-lg" />)}
          </div>
        ) : (
          <>
            {canCheckin && dutiesReady && (
              <section className="rounded-2xl border bg-card p-5 sm:p-6 space-y-3" aria-labelledby="visit-checkin-title">
                <h2 id="visit-checkin-title" className="font-semibold">{t("kciCheckInHeading", "Check in")}</h2>
                {hasCheckinTasks && <p className="text-sm text-muted-foreground">{requirementsMessage}</p>}
                {(checklist?.checkinItems || []).length > 0 && renderChecklist(checklist?.checkinItems || [], t("kciChecklistLabel"))}

                {fieldErrors.items && <p role="alert" className="text-sm text-destructive">{fieldErrors.items}</p>}

                {/* Per-requirement photo uploader */}
                <PhotoRequirementUploader
                  requirements={checkinPhotoReqs}
                  photos={checkinPhotos}
                  onPhotosChange={setCheckinPhotos}
                  uploadFolder="kitchen-checkin"
                  genericInstruction={t("kciCheckinPhotoInstruction")}
                  disabled={isCheckingIn}
                />

                {fieldErrors.photos && <p role="alert" className="text-sm text-destructive">{fieldErrors.photos}</p>}

                <Label htmlFor="chef-checkin-message">{t('bookingAttendanceChefMessage')} ({t("kciOptional", "Optional")})</Label>
                <Textarea id="chef-checkin-message"
                  placeholder={bt("optionalCheckinNotesPlaceholder")}
                  disabled={isPending}
                  value={checkinNotes}
                  onChange={(e) => setCheckinNotes(e.target.value)}
                  rows={2}
                />
                {arrivalChanged && <p role="status" className="rounded-lg border bg-muted/30 p-3 text-sm">{t("kciAcModeChanged", "Arrival details changed. Review the current instructions.")}</p>}
                {codeGate !== "none" && codeState && data && (
                  <VisitCodeField gate={codeGate} state={codeState} value={visitCodeInput} onChange={changeVisitCode}
                    problem={codeProblem} disabled={isCheckingIn} bookingId={bookingId} chefId={data.chefId}
                    kitchenName={kitchenName || t("kitchenDefault", "Kitchen")} />
                )}
                <Button
                  className="w-full"
                  aria-describedby="arrival-submit-help"
                  onClick={handleCheckin}
                  disabled={
                    isCheckingIn || isError ||
                    !allCheckinPhotosUploaded ||
                    !allCheckinItemsChecked ||
                    codeGate === "locked" || codeGate === "revoked" || codeMissing
                  }
                >
                  {isCheckingIn ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <LogIn className="h-4 w-4 mr-2" />
                  )}
                  {t("kciConfirmCheckin", "Confirm check-in")}
                </Button>
                <p id="arrival-submit-help" className="text-sm text-muted-foreground" role="status">{submitHelp("checkin")}</p>
              </section>
            )}

            {canCheckout && dutiesReady && (
              <section id="visit-checkout-section" className="rounded-2xl border bg-card p-5 sm:p-6 space-y-3" aria-labelledby="visit-checkout-title">
                <h2 id="visit-checkout-title" tabIndex={-1} className="font-semibold outline-none">{t("kciCheckOutHeading", "Check out")}</h2>
                {hasCheckoutTasks && <p className="text-sm text-muted-foreground">{requirementsMessage}</p>}
                {(checklist?.checkoutItems || []).length > 0 && renderChecklist(checklist?.checkoutItems || [], t("coChecklistLabel"))}

                {fieldErrors.items && <p role="alert" className="text-sm text-destructive">{fieldErrors.items}</p>}

                {/* Per-requirement photo uploader */}
                <PhotoRequirementUploader
                  requirements={checkoutPhotoReqs}
                  photos={checkoutPhotos}
                  onPhotosChange={setCheckoutPhotos}
                  uploadFolder="kitchen-checkout"
                  genericInstruction={t("kciGenericCheckoutInstruction")}
                  disabled={isCheckingOut}
                />

                {fieldErrors.photos && <p role="alert" className="text-sm text-destructive">{fieldErrors.photos}</p>}

                <Label htmlFor="chef-checkout-message">{t('bookingAttendanceChefMessage')} ({t("kciOptional", "Optional")})</Label>
                <Textarea id="chef-checkout-message"
                  placeholder={bt("checkoutNotesPlaceholder")}
                  disabled={isPending}
                  value={checkoutNotes}
                  onChange={(e) => setCheckoutNotes(e.target.value)}
                  rows={2}
                />

                <WhatHappensNextInfo items={[t("kvNextStep", "The kitchen may review the space within 24 hours.")]} />

                <Button
                  className="w-full"
                  aria-describedby="departure-submit-help"
                  onClick={handleCheckout}
                  disabled={
                    isCheckingOut || isError ||
                    !allCheckoutPhotosUploaded ||
                    !allCheckoutItemsChecked
                  }
                >
                  {isCheckingOut ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <LogOut className="h-4 w-4 mr-2" />
                  )}
                  {t("kciSubmitCheckout", "Submit checkout")}
                </Button>
                <p id="departure-submit-help" className="text-sm text-muted-foreground" role="status">{submitHelp("checkout")}</p>
              </section>
            )}

            {duties && recordedLines.length > 0 && <section className="rounded-xl border p-4 space-y-2" aria-label={t("kciRecordedInstructions", "Instructions saved with your booking")}>
              <h2 className="text-sm font-medium">{t("kciRecordedInstructions", "Instructions saved with your booking")}</h2>
              {recordedLines.map(line => <p key={line} className="text-sm whitespace-pre-line">{line}</p>)}
            </section>}
            {/* Recorded checklists stay visible as history after each step. */}
            {data?.checkinChecklistItems && Array.isArray(data.checkinChecklistItems) && data.checkinChecklistItems.length > 0 &&
              renderRecordedChecklist(data.checkinChecklistItems, t("kciCheckInChecklist"))}
            {data?.checkoutChecklistItems && Array.isArray(data.checkoutChecklistItems) && data.checkoutChecklistItems.length > 0 &&
              renderRecordedChecklist(data.checkoutChecklistItems, t("kciCheckoutChecklist"))}
          </>
        )}
    </section>
  )
}

// ─── Info Popover ─────────────────────────────────────────────────────────────

function WhatHappensNextInfo({ items }: { items: string[] }) {
  const { t } = useTranslation("chef");
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={open}
      >
        <Info className="h-3.5 w-3.5" />
        <span>{t("kciWhatHappensNext")}</span>
      </button>
      {open && (
        <div className="mt-2 rounded-lg border p-3 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="flex items-start gap-2">
            <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
              {items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
