import { BookingProblemReport } from "./BookingProblemReport"
import { friendlyTimezoneName } from '@shared/timezone-utils';
import { previousVisitTaskAnswers, VisitDutyValidationError, type DutyFieldErrors } from '@shared/visit-duties';
/**
 * KitchenCheckinTracker
 *
 * Full-page kitchen visit: a visible status summary (current state, kitchen-local
 * times, next step), the kitchen's arrival/departure instructions, and the
 * check-in or checkout task when one is available.
 */

import { useState, useEffect, useRef, type ReactNode } from "react"
import { Link } from "wouter"
import { useTranslation } from "react-i18next"
import { Camera, ChevronDown, Lock, Clock, CheckCircle2, Loader2, FileWarning, LogIn, LogOut, XCircle, Info, Ban, MapPin, ArrowUpRight, Phone } from "lucide-react"
import type { InfoChipVariant } from "@/components/chef/info-chip"
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
import { VisitCodeField, VisitCodeLabel, visitCodeGate, type VisitCodeProblem } from "./VisitCodeField"
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
import { StatusPill } from "./BookingNowCard"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import type { BookingPillTone } from "@/lib/booking-header-state"

// ─── Types ────────────────────────────────────────────────────────────────────

interface KitchenCheckinTrackerProps {
  /** Rendered at the start of the day-switcher row (the page\'s back button). */
  leading?: ReactNode
  onSuccess: (kind: "checkin" | "checkout") => void
  /** Kitchen phone, when the booking has one; shown beside "Message kitchen". */
  kitchenPhone?: string | null
  initialVisitId?: number | null
  bookingId: number
  kitchenName?: string
  kitchenAddress?: string | null
  onVisitChange?: (visitId: number) => void
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
  kitchenAddress,
  onVisitChange,
  bookingDate,
  startTime,
  endTime,
  leading,
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

  const [helpContainer, setHelpContainer] = useState<HTMLDivElement | null>(null)
  const [arrivedAt, setArrivedAt] = useState<string | null>(null)
  const [checkinNotes, setCheckinNotes] = useState("")
  const [checkoutOpen, setCheckoutOpen] = useState(false)
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
    setCheckoutOpen(false)
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

  const previousVisit = data?.scheduleRevision && data.visitId ? data.visits?.filter(visit =>
    visit.id !== data.visitId && visit.visitDate && visit.visitDate < data.bookingDate.slice(0, 10))
    .sort((a, b) => b.visitDate!.localeCompare(a.visitDate!))[0] : undefined;
  const copyPreviousTasks = (stage: 'checkin' | 'checkout') => {
    setCheckedItems(new Set(previousVisitTaskAnswers(stage === 'checkin' ? checklist?.checkinItems || [] : checklist?.checkoutItems || [],
      stage === 'checkin' ? previousVisit?.checkinChecklistItems : previousVisit?.checkoutChecklistItems)));
  };

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
  // `date`: a multi-day visit's own operating date (each day in the picker is labelled with its own date).
  const formatVisit = (start: string, end: string, date: string | null | undefined = visitDate) => {
    if (!date) return `${start}–${end}`
    const begins = createBookingDateTime(calendarDateForBookingTime(date, start, data?.operatingWindowStartTime), start, timezone)
    const ends = createBookingDateTime(calendarDateForBookingTime(date, end, data?.operatingWindowStartTime, start), end, timezone)
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
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
  const visitIsToday = visitDate === todayKey
  // Each day of a multi-day booking has its own code; say so wherever the code is asked for.
  const multiDayCodes = (data?.visits?.filter(visit => !!visit.visitDate).length ?? 0) > 1
  // A later day says which day ("Tue, Oct 20, 4:45 p.m."); today says only the time.
  const opensText = checkinOpensAt ? visitIsToday ? formatTime(checkinOpensAt.toISOString())
    : new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(checkinOpensAt) : null
  const visitFinished = clockEnded || ["checked_out", "checkout_claim_filed", "no_show"].includes(checkinStatus)
  // Still checked in after the booked end: checkout stays open until the inspection window closes (the booking may
  // already read "completed"). One clear state: the booking ended, check out now, the kitchen may charge extra time.
  const lateCheckout = !!data && ["confirmed", "completed"].includes(data.status) && checkinStatus === "checked_in" && clockEnded && lateCheckoutOpen(clockVisit)
  const isDeparture = (data?.status === "confirmed" && (canCheckout || checkinStatus === "checked_in")) || lateCheckout
  const showInSessionEarly = !!data && (data.status === "confirmed" || lateCheckout) && checkinStatus === "checked_in" && !!clockVisit
    && (clockVisit.phase !== "ended" || lateCheckout) && !!data.chefId
  const isArrival = !isDeparture && data?.status === "confirmed" && checkinStatus === "not_checked_in"
  const title = checkoutOpen || isDeparture && !showInSessionEarly ? t("kciStageCheckout", "Check out")
    : showInSessionEarly ? t("kciStageCooking", "You’re checked in")
    : isArrival ? t("kciStageArrival", "Check in at {kitchen}", { kitchen: kitchenName || t("kitchenDefault", "Kitchen") })
    : checkinStatus === "checked_out" ? t("kciStageComplete", "Visit complete")
    : checkinStatus === "checkout_requested" ? t("kciStageReview", "Checking out")
    : t("kciVisitTitle", "Kitchen visit")
  const dutiesReady = !!currentDuties || !!currentChecklist
  const isPending = isCheckingIn || isCheckingOut
  const requirementsMessage = t("kciConfiguredTasks", "Only checklist items and photos marked Required must be completed. Everything marked Optional can be skipped.")
  const hasCheckoutTasks = (checklist?.checkoutItems || []).length > 0 || checkoutPhotoReqs.length > 0

  // In session: arrival recorded, departure not yet recorded, and the booked time has not fully closed.
  const showInSession = showInSessionEarly
  const requiredCheckoutTasks = (checklist?.checkoutItems || []).filter(item => item.required !== false).length
    + checkoutPhotoReqs.filter(photo => photo.required).length
  const startCheckout = () => {
    setCheckoutOpen(true)
  }
  useEffect(() => {
    if (arrivedAt) document.getElementById("kitchen-visit-title")?.focus()
  }, [arrivedAt])
  useEffect(() => {
    if (!checkoutOpen) return
    const section = document.getElementById("visit-checkout-section")
    section?.scrollIntoView?.({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" })
    document.getElementById("visit-checkout-title")?.focus()
  }, [checkoutOpen])

  const chip = lateCheckout
    ? { variant: "warning" as InfoChipVariant, icon: <Clock className="h-3 w-3" />, label: t("kciIsTimeEnded", "Your booked time ended") }
    : clockEnded
    ? { variant: "outline" as InfoChipVariant, icon: <CheckCircle2 className="h-3 w-3" />, label: t("clockVisitFinished") }
    : data?.status === "cancelled" && checkinStatus === "not_checked_in"
    ? { variant: "outline" as InfoChipVariant, icon: <Ban className="h-3 w-3" />, label: t("kciCancelled", "Cancelled") }
    : { ...STATUS_CHIPS[checkinStatus], label: t(`visitStatus_${checkinStatus}`, STATUS_CHIPS[checkinStatus].fallback) }
  const overstayEnd = clockVisit ? `${new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(clockVisit.scheduledEndAt))} ${friendlyTimezoneName(timezone, locale)}` : ""
  const pillTone: BookingPillTone = lateCheckout ? "amber" : clockEnded || data?.status === "cancelled" ? "grey"
    : checkinStatus === "checked_in" ? "green" : checkinStatus === "checkout_requested" ? "purple"
    : checkinStatus === "no_show" ? "red" : checkinStatus === "checkout_claim_filed" ? "amber"
    : checkinStatus === "checked_out" ? "neutral" : "blue"
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
  const statusLabel = !clockEnded && data?.status === "confirmed" && checkinStatus === "not_checked_in"
    ? beforeCheckinOpens && checkinOpensAt ? t("kciPillUpcoming", "Upcoming")
      : canCheckin ? t("kciCheckinOpen", "Check-in open") : chip.label
    : checkinStatus === "checked_in" && !clockEnded && visitEndAt
      ? t("kciCheckedInEnds", "Checked in · ends {time}", { time: clockTime(clockVisit?.scheduledEndAt || visitEndAt.toISOString()) })
      // The title already says "Checking out"; the pill says where the chef stands.
      : checkinStatus === "checkout_requested" || checkinStatus === "checked_out" ? t("visitStatus_checked_out", "Checked out") : chip.label
  // A closed visit has every step done (no current step).
  const currentStep = checkinStatus === "checked_out" ? 4 : checkoutOpen || isDeparture && !showInSessionEarly || checkinStatus === "checkout_requested" || visitFinished && checkinStatus !== "no_show" ? 3
    : checkinStatus === "checked_in" ? 2 : canCheckin ? 1 : 0
  const steps = [t("kciStepArrive", "Arrive"), t("kciCheckInHeading", "Check in"), t("kciStepCook", "Cook"), t("kciCheckOutHeading", "Check out")]
  const dayLabel = (date: string) => {
    const at = new Date(`${date.slice(0, 10)}T12:00:00Z`)
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
    const label = new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short", day: "numeric" }).format(at)
    return date.slice(0, 10) === today ? t("kciTodayPill", "Today · {day}", { day: label }) : label
  }
  // Late arrival never moves the end: say so before check-in (once the start has passed) and after it.
  const startedBeforeCheckin = !!visitStartAt && !!bookingEndsText && data?.status === "confirmed" && checkinStatus === "not_checked_in" && liveBooking && Date.now() >= visitStartAt.getTime()
  const checkedInLate = !!visitStartAt && !!bookingEndsText && !!data?.checkedInAt && Date.parse(data.checkedInAt) > visitStartAt.getTime()
  const checkedInStamp = data?.checkedInAt || arrivedAt
  const sentence = data ? visitStatusSentence({
    ...sentenceBase, startedBeforeCheckin, checkedInLate: checkedInLate && !!checkedInStamp,
    checkedInTime: clockTime(checkedInStamp), checkoutTime: clockTime(data.checkoutRequestedAt),
    bookingEnds: lateCheckout ? overstayEnd : bookingEndsText,
  }, t) : { text: "", coversCheckin: false, coversCheckout: false }
  const nextStep = beforeCheckinOpens && opensText && !clockEnded && data?.status === "confirmed" && checkinStatus === "not_checked_in"
    ? t("kciOpensSentence", "Check-in opens {time}. Come back then to check in.", { time: opensText }) : sentence.text
  // Kitchen-local times that matter for this visit, in the order they happen. A time the sentence already
  // states is not repeated, and the kitchen's review deadline is never shown to the chef.
  const times: Array<{ label: string; value: string }> = []
  if (data) {
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
  const instructions = showInSession ? [departureInstructions] : isDeparture ? [departureInstructions] : beforeArrival ? [arrivalInstructions] : [arrivalInstructions, departureInstructions]
  const instructionsShown = liveBooking && !visitFinished && instructionsReleased
  // The saved copy is history: while the visit is live the current instructions above are what matters.
  const recordedLines = instructionsShown ? [] : [
    data?.checkedInAt && duties?.arrival.instructions ? { label: t("kciArrival", "Arrival"), body: duties.arrival.instructions } : null,
    data?.checkoutRequestedAt && duties?.departure.instructions ? { label: t("kciDeparture", "Departure"), body: duties.departure.instructions } : null,
  ].filter((line): line is { label: string; body: string } => !!line)

  const renderChecklist = (items: ChecklistItem[], label: string) => (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      {items.map((item: ChecklistItem, index: number) => (
        <label key={item.id} className="flex min-h-11 items-start gap-3 p-3 rounded-xl border bg-background hover:bg-muted/50 cursor-pointer motion-safe:transition-colors">
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

  const arrivalRequirements = <>
                {!!checklist?.checkinItems?.length && <p className="text-sm text-muted-foreground">{requirementsMessage}</p>}
                {!!previousVisit?.checkinChecklistItems?.length && <Button type="button" variant="outline" onClick={() => copyPreviousTasks('checkin')}>{t("kciSameAsPreviousVisit", "Same as previous visit")}</Button>}
                {(checklist?.checkinItems || []).length > 0 && renderChecklist(checklist?.checkinItems || [], t("kciChecklistLabel"))}

                {fieldErrors.items && <p role="alert" className="text-sm text-destructive">{fieldErrors.items}</p>}

                {checkinPhotoReqs.some(photo => photo.required !== false) && <>
                {/* Per-requirement photo uploader */}
                <PhotoRequirementUploader
                  requirements={checkinPhotoReqs.filter(photo => photo.required !== false)}
                  photos={checkinPhotos}
                  onPhotosChange={setCheckinPhotos}
                  uploadFolder="kitchen-checkin"
                  genericInstruction={t("kciCheckinPhotoInstruction")}
                  disabled={isCheckingIn}
                />

                {fieldErrors.photos && <p role="alert" className="text-sm text-destructive">{fieldErrors.photos}</p>}

                </>}

  </>

  return (
    <section className={cn("mx-auto max-w-2xl space-y-5 pb-6", canCheckin && dutiesReady && "pb-32 sm:pb-6")} aria-labelledby="kitchen-visit-title">
        {/* The page's back control and the day switcher share one row (Shopify-style icon back button). */}
        <div className="flex items-end gap-3">
          {leading}
          {data?.visits && (data.visits.length > 1 || data.visitUnavailable) && (
            <div className="space-y-2" role="group" aria-labelledby="kitchen-visit-choice">
              <p id="kitchen-visit-choice" className="text-[13px] font-medium leading-[18px] text-muted-foreground">{t("kciChooseVisit", "Choose a visit")}</p>
              <div className="inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-muted p-1">
                {data.visits.map((visit, ordinal) => {
                  const status = t(`visitStatus_${visit.checkinStatus}`, visit.checkinStatus.replaceAll("_", " "))
                  const label = visit.visitDate ? dayLabel(visit.visitDate) : `${t("kciVisitNumber", "Visit {number}", { number: visit.blockIndex + 1 })}: ${formatVisit(visit.startTime, visit.endTime)}`
                  const day = t("mdDayOf", "Day {number} of {total}", { number: ordinal + 1, total: data.visits!.length })
                  return <Button key={visit.id} type="button" variant="ghost"
                    className={cn("min-h-11 h-auto max-w-full gap-2 whitespace-normal rounded-lg border border-transparent px-3.5 py-2 text-left text-sm font-medium text-muted-foreground hover:bg-background/50 hover:text-foreground",
                      data.visitId === visit.id && "border-border bg-background font-semibold text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.08),0_1px_3px_rgba(0,0,0,0.06)] hover:bg-background")}
                    aria-label={`${visit.visitDate ? `${day} · ` : ""}${label} · ${status}`} title={status}
                    aria-pressed={data.visitId === visit.id} disabled={isPending}
                    onClick={() => { setSelectedVisitId(visit.id); onVisitChange?.(visit.id) }}>
                    <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", visit.visitDate?.slice(0, 10) === todayKey ? "bg-primary" : visit.checkinStatus === "checked_out" ? "bg-foreground/50" : "bg-muted-foreground/40")} />
                    {label}
                  </Button>
                })}
              </div>
            </div>
          )}

        </div>
        <header className="overflow-hidden rounded-2xl border border-border/70 bg-card">
          {coverUrl && <SmartImage src={coverUrl} alt="" hideOnError className="aspect-[16/9] max-h-52 w-full object-cover sm:hidden" />}
          <div className="space-y-4 p-4 sm:p-6">
            <div className="flex min-w-0 items-start gap-4">
              {coverUrl && <SmartImage src={coverUrl} alt="" hideOnError className="hidden aspect-[16/9] w-36 shrink-0 rounded-xl object-cover sm:block" />}
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <h1 id="kitchen-visit-title" tabIndex={-1} className="break-words rounded-md text-[22px] font-semibold leading-7 tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{title}</h1>
                  {!isLoading && data && <StatusPill tone={pillTone}>{statusLabel}</StatusPill>}
                </div>
                {!isArrival && <p className="text-[13px] leading-[18px] text-muted-foreground">{kitchenLabel}</p>}
                {kitchenAddress && <p className="flex flex-wrap items-center gap-x-3 text-[13px] leading-[18px] text-muted-foreground">
                  <span className="inline-flex min-w-0 items-center gap-1"><MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{kitchenAddress}</span>
                  <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(kitchenAddress)}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-0.5 rounded-sm font-medium text-foreground/80 underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {t("kciDirections", "Directions")}<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                </p>}
              </div>
            </div>
            {data && timeLabel && <p className="text-[15px] font-medium leading-[22px] tabular-nums">{timeLabel} · {friendlyTimezoneName(timezone, locale)}</p>}

            {!isLoading && data && (
              <section aria-label={t("kciVisitStatus", "Visit status")} className="flex flex-col items-start gap-2 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
                <p className={cn("text-[15px] leading-[22px] text-foreground/90", lateCheckout && "font-medium")} data-testid="visit-next-step" role={lateCheckout ? "alert" : undefined}>{nextStep}</p>
                {times.length > 0 && (
                  <dl className="grid w-full grid-cols-1 gap-x-6 gap-y-3 pt-1 sm:grid-cols-2">
                    {times.map(time => (
                      <div key={time.label}>
                        <dt className="text-[13px] leading-[18px] text-muted-foreground">{time.label}</dt>
                        <dd className="mt-0.5 text-[15px] font-medium tabular-nums">{time.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {data.status === "confirmed" && checkinStatus === "not_checked_in" && beforeCheckinOpens && visitIsToday && !data.runningLate && (
                  <MessageKitchenButton link bookingId={bookingId} label={t("rlArrivedEarly", "Arrived early? Message the kitchen")} />
                )}
              </section>
            )}

            {data && <ol aria-label={t("kciVisitProgress", "Visit progress")} className="grid grid-cols-4 gap-2 border-t border-border/70 pt-4">
              {steps.map((step, index) => <li key={step} aria-current={index === currentStep ? "step" : undefined} className="relative flex flex-col items-center gap-1.5 text-center text-[13px] leading-[18px]">
                {index < 3 && <span aria-hidden="true" className={cn("absolute left-[calc(50%+0.875rem)] right-[calc(-50%+0.875rem)] top-3 h-px", index < currentStep ? "bg-foreground/30" : "bg-border")} />}
                <span aria-hidden="true" className={cn("relative flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium tabular-nums",
                  index === currentStep ? "bg-foreground text-background" : index < currentStep ? "bg-muted text-foreground" : "border border-border bg-background text-muted-foreground")}>
                  {index < currentStep ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
                </span>
                <span className={index === currentStep ? "font-medium text-foreground" : "text-muted-foreground"}>{step}</span>
              </li>)}
            </ol>}
          </div>
        </header>
        {data && checkinStatus !== "not_checked_in" && <SessionExtensionsCard bookingId={bookingId} manager={false} chefName=""
          refreshKey={`${checkinStatus}:${data.visitId ?? ""}`} onChanged={() => void refetch()} />}
        {showInSession && clockVisit && data && (
          <InSessionPanel bookingId={bookingId} chefId={data.chefId} kitchenName={kitchenName || t("kitchenDefault", "Kitchen")}
            timezone={timezone} scheduledStartAt={clockVisit.scheduledStartAt} scheduledEndAt={clockVisit.scheduledEndAt}
            canCheckout={canCheckout && dutiesReady} checkoutStarted={checkoutOpen} onStartCheckout={startCheckout} onRefresh={() => void refetch()}
            helpContainer={helpContainer} departureInstructions={checklist?.checkoutInstructions || undefined} requiredTaskCount={requiredCheckoutTasks} />
        )}

        {data?.visitUnavailable && <p role="alert">{t("kciVisitUnavailable", "This visit is no longer in the current schedule. Choose a current visit to continue.")}</p>}
        {submitError && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive space-y-2">
          <p>{submitError}</p>
          <Button variant="outline" disabled={isPending} onClick={() => void refetch()}>{t("kciRetryVisit", "Retry visit details")}</Button>
        </div>}
        {isError && <div role="alert" className="rounded-lg border p-3 text-sm space-y-2">
          <p>{error instanceof Error ? `${error.message} ` : ""}{t("kciStatusLoadFailed", "Anything you've entered is kept. Retry, or contact the kitchen manager.")}</p>
          <Button variant="outline" onClick={() => void refetch()}>{t("kciRetryVisit", "Retry visit details")}</Button>
        </div>}
        {!isLoading && liveBooking && !visitFinished && !instructionsReleased && checkinStatus === "not_checked_in" && <section className="rounded-2xl border border-border/70 bg-card p-4 sm:p-6" aria-labelledby="visit-instructions-title">
          <h2 id="visit-instructions-title" className="sr-only">{t("kciRequiredInstructions", "Visit instructions")}</h2>
          <InstructionsOverview mode={arrivalMode} releaseAt={data?.instructionsReleaseAt} timezone={timezone}
            visitStartAt={visitStartAt} requiredTasks={overviewTasks} />
        </section>}
        {!isLoading && liveBooking && !visitFinished && instructionsReleased && !showInSession && <details role="region" open className="group rounded-2xl border border-border/70 bg-card p-4 sm:p-6" aria-label={t(beforeArrival ? "kciArrivalInstructions" : "kciRequiredInstructions")} >
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"><h2 id="visit-instructions-title" className="inline text-base font-semibold leading-6">{beforeArrival ? t("kciArrivalInstructions", "Arrival instructions") : isDeparture ? t("kciDepartureInstructions", "Departure instructions") : t("kciRequiredInstructions", "Visit instructions")}</h2>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" /></summary>
          <div className="space-y-4 pt-3">
          {updatedSinceBooking && <p className="text-xs text-muted-foreground">{t("kciInstructionsUpdated", "Updated by the kitchen since you booked")}</p>}
          {instructions.map(item => (
            <div key={item.key}>
              {instructions.length > 1 && <h3 className="text-sm font-medium">{item.title}</h3>}
              <p className="mt-1 text-sm whitespace-pre-line">{item.body}</p>
            </div>
          ))}
          {checkinStatus === "not_checked_in" && !codeState?.consumed && <ArrivalModeLine mode={arrivalMode} dailyCode={multiDayCodes} />}
          {canCheckin && dutiesReady && arrivalRequirements}
          {beforeArrival && <p className="text-xs text-muted-foreground" data-testid="departure-after-checkin">{t("kciDepartureAfterCheckin", "Departure instructions appear here after you check in.")}</p>}
          </div>
        </details>}
                {data?.status === "confirmed" && checkinStatus === "not_checked_in" && (
                  <SessionExtensionsCard bookingId={bookingId} manager={false} chefName="" only="early_start" onChanged={() => void refetch()} />
                )}
        {!currentDuties && checklistQuery.isError && <div role="alert" className="rounded-lg border p-3 text-sm">
          <p>{t("kciDutiesLoadFailed", "Could not load your visit requirements. Retry before submitting.")}</p>
          <Button variant="outline" onClick={() => void checklistQuery.refetch()}>{t("kciRetryRequirements", "Retry requirements")}</Button>
        </div>}

        {!isLoading && isArrival && liveBooking && beforeCheckinOpens && checkinOpensAt && <section aria-label={t("kciCheckInHeading", "Check in")} className="rounded-2xl border border-border/70 bg-card p-4 sm:p-6">
          <h2 className="text-base font-semibold leading-6">{t("kciCheckInHeading", "Check in")}</h2>
          {/* The real step, shown locked ahead of time: where the code goes, and when it opens. */}
          <div className="mt-3 space-y-2">
            <VisitCodeLabel htmlFor="visit-code-preview" dailyCode={multiDayCodes} muted />
            <InputOTP id="visit-code-preview" maxLength={VISIT_CODE_LENGTH} value="" disabled containerClassName="w-full has-[:disabled]:opacity-100" aria-describedby="visit-code-preview-hint">
              <InputOTPGroup className="w-full max-w-sm gap-2" aria-hidden="true">
                {Array.from({ length: VISIT_CODE_LENGTH }, (_, index) => <InputOTPSlot key={index} index={index}
                  className="h-14 min-w-0 flex-1 cursor-not-allowed rounded-xl border border-border bg-muted first:rounded-l-xl last:rounded-r-xl" />)}
              </InputOTPGroup>
            </InputOTP>
            <p id="visit-code-preview-hint" className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t("kciCodeOpens", "Opens {time}", { time: opensText })}
            </p>
          </div>
        </section>}
        {isLoading ? (
          <div className="space-y-4 py-3" role="status" aria-label={t("kciLoadingVisit", "Loading visit")}>
            {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-16 w-full rounded-lg" />)}
          </div>
        ) : (
          <>
            {canCheckin && dutiesReady && (
              <section className="rounded-2xl border border-border/70 bg-card p-4 sm:p-6 space-y-2.5 sm:space-y-3" aria-labelledby="visit-checkin-title">
                {!instructionsShown && arrivalRequirements}
                <h2 id="visit-checkin-title" className="text-base font-semibold leading-6">{codeGate === "none" || codeGate === "self" ? t("kciCheckInHeading", "Check in") : t("kciEnterCode", "Enter your check-in code")}</h2>
                {arrivalChanged && <p role="status" className="rounded-lg border bg-muted/30 p-3 text-sm">{t("kciAcModeChanged", "Arrival details changed. Review the current instructions.")}</p>}
                {codeGate !== "none" && codeState && data && (
                  <VisitCodeField gate={codeGate} state={codeState} value={visitCodeInput} onChange={changeVisitCode}
                    helpContainer={helpContainer} canReportProblem={!beforeCheckinOpens && !!checkinOpensAt} problem={codeProblem} disabled={isCheckingIn} bookingId={bookingId} chefId={data.chefId}
                    kitchenName={kitchenName || t("kitchenDefault", "Kitchen")} dailyCode={multiDayCodes} />
                )}
                {(codeGate === "none" || codeGate === "self") && !beforeCheckinOpens && !!checkinOpensAt && <p className="text-sm text-muted-foreground">{t("kciAcNoAccess", "Can’t get inside or find staff? Contact the kitchen. Don’t confirm arrival until you’re at the kitchen.")}</p>}
                <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:px-0">
                <Button
                  className="mx-auto flex h-auto min-h-12 w-full max-w-2xl whitespace-normal rounded-xl py-3 text-base leading-snug shadow-sm"
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
                    <Loader2 className="h-4 w-4 mr-2 motion-safe:animate-spin" />
                  ) : (
                    <LogIn className="h-4 w-4 mr-2" />
                  )}
                  {codeGate === "self" ? t("kciSelfCheckinAction", "I’m at the kitchen. Check in") : t("kciCheckInHeading", "Check in")}
                </Button>
                <p id="arrival-submit-help" className="mx-auto max-w-2xl text-sm text-muted-foreground" role="status">{submitHelp("checkin")}</p>
                </div>
                <details className="text-sm">
                  <summary className="flex min-h-11 cursor-pointer items-center font-medium underline underline-offset-4">{t("wfbArrivalOptional")}</summary>
                  <div className="space-y-3 pt-2">
                    {(!checkinPhotoReqs.length || checkinPhotoReqs.some(photo => photo.required === false)) && <>
                {/* Per-requirement photo uploader */}
                <PhotoRequirementUploader
                  requirements={checkinPhotoReqs.filter(photo => photo.required === false)}
                  photos={checkinPhotos}
                  onPhotosChange={setCheckinPhotos}
                  uploadFolder="kitchen-checkin"
                  genericInstruction={t("kciCheckinPhotoInstruction")}
                  disabled={isCheckingIn}
                />

                {fieldErrors.photos && <p role="alert" className="text-sm text-destructive">{fieldErrors.photos}</p>}

                    </>}
                <Label htmlFor="chef-checkin-message">{t('bookingAttendanceChefMessage')} ({t("kciOptional", "Optional")})</Label>
                <Textarea id="chef-checkin-message"
                  placeholder={bt("optionalCheckinNotesPlaceholder")}
                  disabled={isPending}
                  value={checkinNotes}
                  onChange={(e) => setCheckinNotes(e.target.value)}
                  rows={2}
                />
                  </div>
                </details>
              </section>
            )}

            {canCheckout && dutiesReady && (!showInSession || checkoutOpen) && (
              <section id="visit-checkout-section" className="rounded-2xl border border-border/70 bg-card p-4 sm:p-6 space-y-3" aria-labelledby="visit-checkout-title">
                <h2 id="visit-checkout-title" tabIndex={-1} className="rounded-md text-base font-semibold leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("kciCheckOutHeading", "Check out")}</h2>
                {hasCheckoutTasks && <p className="text-sm text-muted-foreground">{requirementsMessage}</p>}
                {!!previousVisit?.checkoutChecklistItems?.length && <Button type="button" variant="outline" onClick={() => copyPreviousTasks('checkout')}>{t("kciSameAsPreviousVisit", "Same as previous visit")}</Button>}
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
                {/* Before the booked end: said once, right where they confirm. */}
                {!clockEnded && <p className="text-sm text-muted-foreground">{t("kciIsLeaveEarlyNote", "Leaving early does not refund unused booked time.")}</p>}

                <Button
                  className="min-h-12 w-full rounded-xl text-base"
                  aria-describedby="departure-submit-help"
                  onClick={handleCheckout}
                  disabled={
                    isCheckingOut || isError ||
                    !allCheckoutPhotosUploaded ||
                    !allCheckoutItemsChecked
                  }
                >
                  {isCheckingOut ? (
                    <Loader2 className="h-4 w-4 mr-2 motion-safe:animate-spin" />
                  ) : (
                    <LogOut className="h-4 w-4 mr-2" />
                  )}
                  {t("kciCheckOutHeading", "Check out")}
                </Button>
                <p id="departure-submit-help" className="text-sm text-muted-foreground" role="status">{submitHelp("checkout")}</p>
              </section>
            )}

            {duties && recordedLines.length > 0 && <details className="group rounded-2xl border border-border/70 bg-card p-4 sm:px-6" aria-label={t("kciRecordedInstructions", "Instructions you were given")}>
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                {t("kciRecordedInstructions", "Instructions you were given")}
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
              </summary>
              <dl className="space-y-3 pt-2">{recordedLines.map(line => <div key={line.label}>
                <dt className="text-[13px] leading-[18px] text-muted-foreground">{line.label}</dt>
                <dd className="mt-0.5 whitespace-pre-line text-sm">{line.body}</dd>
              </div>)}</dl>
            </details>}
            {/* Recorded checklists stay visible as history after each step. */}
            {data?.checkinChecklistItems && Array.isArray(data.checkinChecklistItems) && data.checkinChecklistItems.length > 0 &&
              renderRecordedChecklist(data.checkinChecklistItems, t("kciCheckInChecklist"))}
            {data?.checkoutChecklistItems && Array.isArray(data.checkoutChecklistItems) && data.checkoutChecklistItems.length > 0 &&
              renderRecordedChecklist(data.checkoutChecklistItems, t("kciCheckoutChecklist"))}
          </>
        )}
        <div ref={setHelpContainer} role="region" aria-label={t("kciVisitHelp", "Visit help")} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/60 pt-4 [&_button]:min-h-11 [&_button]:focus-visible:ring-2 [&_button]:focus-visible:ring-ring">
          {kitchenPhone && liveBooking && !visitFinished && !showInSession && codeGate === "code" && canCheckin && dutiesReady && <Button asChild variant="outline" className="min-h-11"><a href={`tel:${kitchenPhone}`}><Phone className="mr-2 h-4 w-4" aria-hidden="true" />{t("kciCallKitchen", "Call kitchen")}</a></Button>}
                {data?.status === "confirmed" && liveBooking && (
                  <RunningLateCard bookingId={bookingId} visitId={data.visitId} kitchenName={kitchenName} startAt={visitStartAt} endAt={visitEndAt}
                    timezone={timezone} status={data.status} checkedIn={checkinStatus !== "not_checked_in"} runningLate={data.runningLate} onChanged={() => void refetch()} />
                )}
          {!isLoading && liveBooking && !visitFinished && !showInSession && (codeGate === "none" || codeGate === "self" || !canCheckin || !dutiesReady) && <div className="flex flex-wrap items-center gap-2">
            <MessageKitchenButton bookingId={bookingId} phone={kitchenPhone} />
            {canCheckin && dutiesReady && !beforeCheckinOpens && !!checkinOpensAt && <BookingProblemReport bookingId={bookingId} initialCategory="access" />}
          </div>}
        </div>
        {data && (visitFinished || checkinStatus === "checkout_requested") && <Button asChild variant="outline" className="min-h-12 w-full rounded-xl"><Link href={`/booking/${bookingId}`}>{t("kciBackToBooking", "Back to booking")}</Link></Button>}
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
        className="flex min-h-11 items-center gap-1.5 rounded-md focus-visible:ring-2 focus-visible:ring-ring text-xs text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={open}
      >
        <Info className="h-3.5 w-3.5" />
        <span>{t("kciWhatHappensNext")}</span>
      </button>
      {open && (
        <div className="mt-2 rounded-lg border p-3 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-150">
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
