/**
 * ViewingSettingsPanel
 *
 * Manager-facing component for configuring kitchen viewing availability.
 * Allows managers to: toggle viewings, set duration/buffers/notice,
 * configure weekly availability hours, and manage blackout dates.
 * Built mobile-first with shadcn/ui components.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import { mt } from "@/i18n/manager"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Calendar as CalendarIcon, Loader2, Plus, Trash2, Save, CheckCircle, ArrowRight } from "@/components/ui/manager-icons"
import { toast } from "sonner"
import { auth } from "@/lib/firebase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { NumericInput } from "@/components/ui/numeric-input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Calendar } from "@/components/ui/calendar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { SettingsRow } from "./settings/SettingsRow"
import { cn } from "@/lib/utils"
import { format, isBefore } from "date-fns"
import { formatTourDate, tourDateKey } from "@shared/tour-time"
import { tourToday } from "@/lib/tour-available-date"
import { AvailabilitySkeleton } from "./AvailabilitySkeleton"
import { journeyCalendarClassNames } from "@/components/kitchen-application/journey-calendar-style"
import { tourReadiness } from '@shared/tour-readiness'
import { copyableTourHours } from '@shared/tour-schedule'

const TAB_TRIGGER = "group gap-2 rounded-none border-b-2 border-transparent px-0.5 py-2.5 font-normal text-muted-foreground transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:shadow-none"

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

interface ViewingSettings {
  id: number
  kitchenId: number
  isActive: boolean
  defaultDurationMinutes: number
  bufferBeforeMinutes: number
  bufferAfterMinutes: number
  advanceNoticeHours: number
  maxAdvanceBookingDays: number
  arrivalNotes?: string | null
  departureNotes?: string | null
}

interface AvailabilitySlot {
  id?: number
  kitchenId: number
  dayOfWeek: number
  startTime: string
  endTime: string
  isAvailable: boolean
}

interface Blackout {
  id: number
  kitchenId: number
  startDate: string
  endDate: string
  reason: string | null
  createdAt: string
}

export interface ViewingSettingsResponse {
  settings: ViewingSettings | null
  availability: AvailabilitySlot[]
  blackouts: Blackout[]
  timezone?: string
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]

const DEFAULT_SETTINGS = {
  isActive: false,
  defaultDurationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 15,
  advanceNoticeHours: 24,
  maxAdvanceBookingDays: 30,
  arrivalNotes: "",
  departureNotes: "",
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ViewingSettingsPanelProps {
  hideSaveActions?: boolean
  kitchenId: number
  kitchenName?: string
  kitchenIsListed?: boolean
  disabled?: boolean
  onSavingChange?: (saving: boolean) => void
  onReturnToTour?: () => void
  onPrepareSchedule?: () => void
  onPauseTours?: () => void
  initialSection?: 'weekly' | 'instructions'
  facilityKitchenCount?: number
  onDirtyChange?: (dirty: boolean) => void
}

export interface ViewingSettingsPanelHandle {
  saveChanges: () => Promise<boolean>
  activateTours: () => Promise<boolean>
}

export const ViewingSettingsPanel = forwardRef<ViewingSettingsPanelHandle, ViewingSettingsPanelProps>(function ViewingSettingsPanel({ kitchenId, kitchenName, kitchenIsListed = true, disabled = false, onSavingChange, onReturnToTour, onPrepareSchedule, onPauseTours, initialSection, facilityKitchenCount = 1, onDirtyChange, hideSaveActions = false }, ref) {
  
  const queryClient = useQueryClient()

  // Local state for settings form
  const [duration, setDuration] = useState(30)
  const [bufferBefore, setBufferBefore] = useState(0)
  const [bufferAfter, setBufferAfter] = useState(15)
  const [advanceNotice, setAdvanceNotice] = useState(24)
  const [maxDays, setMaxDays] = useState(30)
  const [arrivalNotes, setArrivalNotes] = useState("")
  const [departureNotes, setDepartureNotes] = useState("")
  const [showRequiredErrors, setShowRequiredErrors] = useState(false)

  // Layout tabs
  const [activeTab, setActiveTab] = useState<string>(() => new URLSearchParams(window.location.search).get('focus') === 'tour-notes' ? 'instructions' : initialSection ?? 'weekly')
  useEffect(() => { if (initialSection) setActiveTab(initialSection) }, [initialSection])

  // Weekly availability editing - map to exactly 1 per day
  const [weeklySchedule, setWeeklySchedule] = useState<Record<number, AvailabilitySlot>>({})
  const [savedWeeklySchedule, setSavedWeeklySchedule] = useState('')
  const [savedSettings, setSavedSettings] = useState('')
  const dirtyFields = useRef({ settings: false, schedule: false })

  // Blackout Dialog form
  const [isBlackoutDialogOpen, setIsBlackoutDialogOpen] = useState(false)
  const [blackoutStart, setBlackoutStart] = useState<Date>()
  const [blackoutEnd, setBlackoutEnd] = useState<Date>()
  const [blackoutReason, setBlackoutReason] = useState("")
  const [blackoutScope, setBlackoutScope] = useState<"tour-kitchen" | "kitchen" | "facility">("tour-kitchen")
  const [affectedBookingIds, setAffectedBookingIds] = useState<number[]>([])
  const scopeChoices: Array<"tour-kitchen" | "kitchen" | "facility"> = facilityKitchenCount > 1
    ? ["tour-kitchen", "kitchen", "facility"] : ["tour-kitchen", "kitchen"]
  const scopeSelector = (name: string, removing = false) => (
    <fieldset className="space-y-2 border-t pt-4">
      <legend className="text-sm font-medium">{mt("exceptionScopeQuestion")}</legend>
      <div className="grid gap-2">
        {scopeChoices.map((scope) => (
          <label key={scope} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm ${blackoutScope === scope ? "border-primary" : "border-border"}`}>
            <input type="radio" name={name} checked={blackoutScope === scope} onChange={() => { setBlackoutScope(scope); setAffectedBookingIds([]) }} className="accent-primary" />
            {mt(scope === "tour-kitchen" ? "tourScopeOnly" : scope === "kitchen" ? "tourScopeKitchen" : "tourScopeFacility")}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{mt(removing ? "tourScopeRemovalDetail" : "tourScopeDetail")}</p>
    </fieldset>
  )

  // Fetch current settings
  const { data, isLoading, isError, refetch } = useQuery<ViewingSettingsResponse>({
    queryKey: [`/api/viewings/settings/${kitchenId}`],
    staleTime: 10000,
  })
  useEffect(() => {
    if (isLoading || isError || new URLSearchParams(window.location.search).get('focus') !== 'tour-notes') return
    const notes = document.getElementById('tour-visit-notes')
    notes?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    notes?.focus({ preventScroll: true })
  }, [kitchenId, isLoading, isError])

  // Initialize local state from fetched data
  useEffect(() => {
    if (!data) {
      setSavedSettings('')
      setSavedWeeklySchedule('')
      return
    }

    const source = data.settings ?? DEFAULT_SETTINGS
    const settings = {
      defaultDurationMinutes: source.defaultDurationMinutes,
      bufferBeforeMinutes: source.bufferBeforeMinutes,
      bufferAfterMinutes: source.bufferAfterMinutes,
      advanceNoticeHours: source.advanceNoticeHours,
      maxAdvanceBookingDays: source.maxAdvanceBookingDays,
      arrivalNotes: source.arrivalNotes ?? "",
      departureNotes: source.departureNotes ?? "",
    }
    // Refetching one section must not discard unsaved edits in the other.
    if (!dirtyFields.current.settings) {
      setDuration(settings.defaultDurationMinutes)
      setBufferBefore(settings.bufferBeforeMinutes)
      setBufferAfter(settings.bufferAfterMinutes)
      setAdvanceNotice(settings.advanceNoticeHours)
      setMaxDays(settings.maxAdvanceBookingDays)
      setArrivalNotes(settings.arrivalNotes)
      setDepartureNotes(settings.departureNotes)
      setSavedSettings(JSON.stringify(settings))
    }

    if (data.availability && !dirtyFields.current.schedule) {
      const scheduleMap: Record<number, AvailabilitySlot> = {}
      // Pre-fill with defaults
      for (let i = 0; i < 7; i++) {
        scheduleMap[i] = {
          kitchenId,
          dayOfWeek: i,
          startTime: "09:00",
          endTime: "17:00",
          isAvailable: false
        }
      }
      
      // Override with actual data. Take the first slot for each day.
      data.availability.forEach((slot) => {
        // If we haven't processed an available slot for this day yet, use this one
        if (!scheduleMap[slot.dayOfWeek].isAvailable && slot.isAvailable) {
           scheduleMap[slot.dayOfWeek] = { ...slot }
        }
      })
      
      setWeeklySchedule(scheduleMap)
      setSavedWeeklySchedule(JSON.stringify(scheduleMap))
    }
  }, [data, kitchenId])

  const currentSettings = {
    defaultDurationMinutes: duration,
    bufferBeforeMinutes: bufferBefore,
    bufferAfterMinutes: bufferAfter,
    advanceNoticeHours: advanceNotice,
    maxAdvanceBookingDays: maxDays,
    arrivalNotes,
    departureNotes,
  }
  const isSettingsDirty = !!savedSettings && JSON.stringify(currentSettings) !== savedSettings
  const isScheduleDirty = !!savedWeeklySchedule && JSON.stringify(weeklySchedule) !== savedWeeklySchedule
  dirtyFields.current = { settings: isSettingsDirty, schedule: isScheduleDirty }
  const readiness = tourReadiness(currentSettings, isScheduleDirty ? Object.values(weeklySchedule) : data?.availability ?? [])
  const savedReadiness = tourReadiness(data?.settings, data?.availability ?? [])
  const activated = data?.settings?.isActive === true && savedReadiness.ready
  const live = activated && kitchenIsListed
  const focusSetup = (part: 'arrival' | 'departure' | 'schedule') => {
    setActiveTab(part === 'schedule' ? 'weekly' : 'instructions')
    requestAnimationFrame(() => {
      const target = document.getElementById(part === 'schedule' ? 'tour-weekly-hours' : `tour-${part}-notes-${kitchenId}`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target?.focus({ preventScroll: true })
    })
  }

  // Save settings mutation
  const saveSettingsMutation = useMutation({
    mutationFn: async (activate: boolean) => {
      const headers = await getAuthHeaders()
      const response = await fetch(`/api/viewings/settings/${kitchenId}`, {
        method: "PUT",
        headers,
        credentials: "include",
        body: JSON.stringify({ ...currentSettings,
          ...(activate ? { isActive: true } : data?.settings?.isActive && !savedReadiness.ready ? { isActive: false } : {}),
          ...(isScheduleDirty ? { slots: Object.values(weeklySchedule).filter(s => s.isAvailable) } : {}),
        }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || mt("viewingSettingsSaveFailed"))
      }
      return response.json()
    },
    onSuccess: (settings: ViewingSettings, activate) => {
      setSavedSettings(JSON.stringify(currentSettings))
      setSavedWeeklySchedule(JSON.stringify(weeklySchedule))
      queryClient.setQueryData<ViewingSettingsResponse>([`/api/viewings/settings/${kitchenId}`], old => ({
        settings, availability: isScheduleDirty ? Object.values(weeklySchedule).filter(s => s.isAvailable) : old?.availability ?? [],
        blackouts: old?.blackouts ?? [], timezone: old?.timezone,
      }))
      queryClient.invalidateQueries({ queryKey: [`/api/viewings/settings/${kitchenId}`] })
      queryClient.invalidateQueries({ queryKey: [`/api/viewings/kitchen/${kitchenId}/is-active`] })
      queryClient.invalidateQueries({ queryKey: ['kitchen-listing-readiness', kitchenId] })
      queryClient.invalidateQueries({ predicate: query => String(query.queryKey[0]).startsWith('/api/viewings/manager') })
      queryClient.invalidateQueries({ queryKey: ['tour-decision-context'] })
      setShowRequiredErrors(false)
      toast.success(mt(activate ? kitchenIsListed ? 'tourActivatedToast' : 'tourActivatedUnlistedToast' : activated ? 'tourChangesSavedToast' : 'tourDraftSavedToast'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const saveChanges = async (activate = false) => {
    if (disabled || saveSettingsMutation.isPending || isLoading || isError || !data) return false
    if ((activate || activated) && !readiness.ready) {
      setShowRequiredErrors(true)
      focusSetup(!readiness.arrival ? 'arrival' : !readiness.departure ? 'departure' : 'schedule')
      return false
    }
    try {
      if (activate || isSettingsDirty || isScheduleDirty) await saveSettingsMutation.mutateAsync(activate)
      return true
    } catch { return false }
  }

  useEffect(() => {
    onDirtyChange?.(isSettingsDirty || isScheduleDirty)
  }, [isScheduleDirty, isSettingsDirty, onDirtyChange])

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])
  useEffect(() => { onSavingChange?.(saveSettingsMutation.isPending) }, [onSavingChange, saveSettingsMutation.isPending])
  useEffect(() => () => onSavingChange?.(false), [onSavingChange])

  useImperativeHandle(ref, () => ({
    saveChanges: () => saveChanges(),
    activateTours: () => saveChanges(true),
  }))

  // Add blackout mutation
  const addBlackoutMutation = useMutation({
    mutationFn: async (acknowledgedBookingIds?: number[]) => {
      if (!blackoutStart || !blackoutEnd) throw new Error(mt("selectStartAndEndDates"))
      const headers = await getAuthHeaders()
      const response = await fetch(`/api/viewings/blackouts/${kitchenId}`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          startDate: format(blackoutStart, "yyyy-MM-dd"),
          endDate: format(blackoutEnd, "yyyy-MM-dd"),
          reason: blackoutReason || undefined,
          scope: facilityKitchenCount > 1 ? blackoutScope : blackoutScope === "facility" ? "kitchen" : blackoutScope,
          acknowledgedBookingIds,
        }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        if (response.status === 409 && err.code === "BOOKINGS_AFFECTED") {
          throw Object.assign(new Error(err.error), { bookingIds: err.bookingIds })
        }
        throw new Error(err.error || mt("blackoutAddFailed"))
      }
      return response.json()
    },
    onSuccess: (result: { skippedBookingDates?: number }) => {
      queryClient.invalidateQueries({ predicate: query => String(query.queryKey[0]).startsWith("/api/viewings/settings/") })
      queryClient.invalidateQueries({ queryKey: ["/api/manager/kitchens/date-overrides"] })
      setIsBlackoutDialogOpen(false)
      setBlackoutStart(undefined)
      setBlackoutEnd(undefined)
      setBlackoutReason("")
      setAffectedBookingIds([])
      toast.success(result.skippedBookingDates
        ? mt("tourExceptionSavedWithSkippedDates")
        : mt("exceptionPeriodAdded"))
    },
    onError: (error: Error & { bookingIds?: number[] }) => {
      if (Array.isArray(error.bookingIds)) { setAffectedBookingIds(error.bookingIds); return }
      toast.error(error.message)
    },
  })

  // Delete blackout mutation
  const deleteBlackoutMutation = useMutation({
    mutationFn: async ({ blackoutId, scope }: { blackoutId: number; scope: "tour-kitchen" | "kitchen" | "facility" }) => {
      const headers = await getAuthHeaders()
      const response = await fetch(`/api/viewings/blackouts/${blackoutId}?scope=${scope}`, {
        method: "DELETE",
        headers,
        credentials: "include",
      })
      if (!response.ok) throw new Error(mt("blackoutDeleteFailed"))
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: query => String(query.queryKey[0]).startsWith("/api/viewings/settings/") })
      queryClient.invalidateQueries({ queryKey: ["/api/manager/kitchens/date-overrides"] })
      toast.success(mt("exceptionRemoved"))
    },
    onError: (error: Error) => toast.error(error.message),
  })


  // ─── Render ─────────────────────────────────────────────────────────────

  if (isError) {
    return <Button variant="outline" onClick={() => refetch()}>{mt("retry")}</Button>
  }

  if (isLoading) {
    return <AvailabilitySkeleton />
  }

  // Determine modifiers for the calendar
  const blackoutModifiers = {
    blackout: (date: Date) => {
      if (!data?.blackouts) return false;
      const dateKey = format(date, "yyyy-MM-dd")
      return data.blackouts.some((b) => {
        const start = tourDateKey(new Date(b.startDate))
        const end = tourDateKey(new Date(b.endDate))
        return dateKey >= start && dateKey <= end
      });
    }
  }

  return (
    <div className="min-w-0 space-y-6 [overflow-wrap:anywhere]">
      <header className="space-y-3 border-b pb-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2"><h2 className="text-xl font-semibold tracking-tight">{mt(activated ? 'tourManageTitle' : 'tourSetUpTitle')}</h2><p role="status" className="max-w-2xl text-sm leading-6 text-muted-foreground">{mt(live ? 'tourLiveHelp' : activated ? 'tourUnlistedHelp' : 'tourSetupHelp')}</p></div>
          <div className="flex shrink-0 flex-wrap items-center gap-3"><Badge variant={live ? 'success' : 'outline'}>{mt(live ? 'tourStateLive' : activated ? 'tourStateUnlisted' : savedReadiness.ready ? 'tourStateReady' : data?.settings?.isActive ? 'tourStateIncomplete' : 'tourStateOff')}</Badge>
            {data?.settings?.isActive && onPauseTours && <Button variant="outline" size="sm" disabled={disabled || saveSettingsMutation.isPending} onClick={onPauseTours}>{mt('tourPauseAction')}</Button>}
          </div>
        </div>
        {!activated && <p className="text-xs text-muted-foreground">{mt('tourSetupStepsProgress', { count: Number(readiness.schedule) + Number(readiness.arrival && readiness.departure) })}{(isSettingsDirty || isScheduleDirty) && <span className="ml-2">· {mt('tourUnsavedSetup')}</span>}</p>}
        {activated && (isSettingsDirty || isScheduleDirty) && <p className="text-xs text-muted-foreground">{mt('tourUnsavedSetup')}</p>}
        {showRequiredErrors && !readiness.ready && <p role="alert" className="text-sm text-destructive">{mt(activated ? 'tourLiveRequiredSummary' : 'tourRequiredSummary')}</p>}
      </header>
      <fieldset disabled={disabled || saveSettingsMutation.isPending} className="min-w-0 space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList aria-label={mt('tourSetupSections')} className="h-auto w-full justify-start gap-6 overflow-x-auto rounded-none border-b border-border bg-transparent p-0 text-muted-foreground">
          <TabsTrigger value="weekly" className={TAB_TRIGGER}><span aria-hidden className="flex size-5 items-center justify-center rounded-full bg-muted text-xs">{readiness.schedule ? <CheckCircle className="size-3.5" /> : '1'}</span>{mt('tourScheduleTab')}</TabsTrigger>
          <TabsTrigger value="instructions" className={TAB_TRIGGER}><span aria-hidden className="flex size-5 items-center justify-center rounded-full bg-muted text-xs">{readiness.arrival && readiness.departure ? <CheckCircle className="size-3.5" /> : '2'}</span>{mt('tourInstructionsTab')}</TabsTrigger>
          <TabsTrigger value="calendar" className={TAB_TRIGGER}>{mt('exceptionsCalendar')}</TabsTrigger>
        </TabsList>
        <TabsContent value="instructions" className="mt-6 space-y-5">
      <Card id="tour-visit-notes" tabIndex={-1} className="scroll-mt-6 focus:outline-none focus:ring-2 focus:ring-primary/30">
        <CardHeader className="p-4 pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-lg">{mt("tourVisitNotesTitle")}</CardTitle>
            {onReturnToTour && <Button variant="outline" onClick={onReturnToTour} className="shrink-0">{mt('tourReturnToDetails')}</Button>}
          </div>
          {onReturnToTour && <p className="text-sm text-muted-foreground">{mt('tourEditingFromDetailsHelp')}</p>}
          <CardDescription>{mt("tourVisitNotesDescription", { kitchen: kitchenName ?? mt("kitchenScopeFallback") })}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 p-4 pt-0 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`tour-arrival-notes-${kitchenId}`}>{mt("arrivalInstructionsTitle")}</Label>
            <span className="ml-2 text-xs text-muted-foreground">{mt('tourRequiredLabel')}</span>
            <p id={`tour-arrival-help-${kitchenId}`} className="text-xs text-muted-foreground">{mt("tourArrivalNotesHelp")}</p>
            <Textarea id={`tour-arrival-notes-${kitchenId}`} aria-required aria-invalid={showRequiredErrors && !readiness.arrival} aria-describedby={`tour-arrival-help-${kitchenId}${showRequiredErrors && !readiness.arrival ? ` tour-arrival-error-${kitchenId}` : ''}`} rows={4} maxLength={2000}
              value={arrivalNotes} onChange={event => setArrivalNotes(event.target.value)} placeholder={mt("tourArrivalNotesPlaceholder")} />
            {showRequiredErrors && !readiness.arrival && <p id={`tour-arrival-error-${kitchenId}`} className="text-xs text-destructive">{mt('tourArrivalRequired')}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`tour-departure-notes-${kitchenId}`}>{mt("departureInstructionsTitle")}</Label>
            <span className="ml-2 text-xs text-muted-foreground">{mt('tourRequiredLabel')}</span>
            <p id={`tour-departure-help-${kitchenId}`} className="text-xs text-muted-foreground">{mt("tourDepartureNotesHelp")}</p>
            <Textarea id={`tour-departure-notes-${kitchenId}`} aria-required aria-invalid={showRequiredErrors && !readiness.departure} aria-describedby={`tour-departure-help-${kitchenId}${showRequiredErrors && !readiness.departure ? ` tour-departure-error-${kitchenId}` : ''}`} rows={4} maxLength={2000}
              value={departureNotes} onChange={event => setDepartureNotes(event.target.value)} placeholder={mt("tourDepartureNotesPlaceholder")} />
            {showRequiredErrors && !readiness.departure && <p id={`tour-departure-error-${kitchenId}`} className="text-xs text-destructive">{mt('tourDepartureRequired')}</p>}
          </div>
        </CardContent>
        {(!hideSaveActions || onReturnToTour) && isSettingsDirty && <div className="flex justify-end border-t p-4">
          <Button size="sm" disabled={saveSettingsMutation.isPending} onClick={() => void saveChanges()}>{mt("saveChanges")}</Button>
        </div>}
      </Card>
      <details className="rounded-xl border bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{mt('tourPreviewInstructions')}</summary>
        <p className="mt-3 text-xs text-muted-foreground">{mt('tourPreviewHelp')}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">{(['arrival', 'departure'] as const).map(part => <div key={part} className="rounded-lg bg-muted/30 p-3"><h3 className="text-sm font-medium">{mt(part === 'arrival' ? 'arrivalInstructionsTitle' : 'departureInstructionsTitle')}</h3><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{currentSettings[`${part}Notes`].trim() || mt('tourPreviewEmpty')}</p></div>)}</div>
      </details>
        {!activated && <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">{mt(readiness.ready ? kitchenIsListed ? 'tourActivateHelp' : 'tourActivateUnlistedHelp' : !readiness.schedule ? 'tourInstructionsNeedSchedule' : 'tourInstructionsNextHelp')}</p>
          {readiness.ready ? <Button disabled={disabled || saveSettingsMutation.isPending} className="h-auto min-h-11 shrink-0 whitespace-normal py-2" onClick={() => void saveChanges(true)}>{saveSettingsMutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}{mt('tourActivateAction')}</Button>
            : !readiness.schedule && <Button variant="outline" onClick={() => focusSetup('schedule')}>{mt('tourSetScheduleAction')}<ArrowRight aria-hidden className="ml-2 size-4" /></Button>}
        </div>}
        </TabsContent>
        <TabsContent value="weekly" className="space-y-6 mt-6">
          <Card id="tour-weekly-hours" tabIndex={-1} className="scroll-mt-6 focus:outline-none focus:ring-2 focus:ring-primary/30">
            <CardHeader className="flex flex-col items-stretch justify-between gap-3 space-y-0 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 space-y-1">
                <CardTitle className="text-lg">{mt("recurringWeeklyHours")}</CardTitle>
                <CardDescription>{mt("defaultHoursAvailableForKitchenViewings")}</CardDescription>
              </div>
              {!hideSaveActions && (isScheduleDirty || saveSettingsMutation.isPending) && <Button
                onClick={() => void saveChanges()}
                disabled={saveSettingsMutation.isPending || !isScheduleDirty}
                className="h-auto min-h-11 whitespace-normal py-2 sm:shrink-0"
              >
                {saveSettingsMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                {mt("saveSchedule")}
              </Button>}
            </CardHeader>
            {!savedReadiness.schedule && onPrepareSchedule && <div className="mx-4 mb-4 flex flex-col gap-2 rounded-lg bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-muted-foreground">{mt('tourCopySchedulePrompt')}</p><Button variant="outline" size="sm" disabled={isScheduleDirty} onClick={onPrepareSchedule}>{mt('tourChooseScheduleSource')}</Button></div>}
            <p className="px-4 pb-3 text-sm text-muted-foreground">{mt("tourHoursOvernightHelp")}</p>
            <p className="px-4 pb-3 text-xs text-muted-foreground">{mt('tourScheduleRequirement', { minutes: duration + bufferBefore + bufferAfter, timezone: data?.timezone ?? 'America/St_Johns' })}</p>
            {showRequiredErrors && !readiness.schedule && <p className="px-4 pb-3 text-sm text-destructive">{mt('tourScheduleRequired')}</p>}
            <CardContent className="divide-y p-0">
              {DAY_NAMES.map((dayName, index) => {
                const schedule = weeklySchedule[index] || { isAvailable: false, startTime: "09:00", endTime: "17:00", dayOfWeek: index, kitchenId };
                return (
                  <div key={index} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/30 sm:grid-cols-[7rem_minmax(0,1fr)_auto]">
                    <Label className="text-sm font-medium text-foreground">{dayName}</Label>
                    <div className="order-3 col-span-2 flex min-w-0 items-center gap-2 sm:order-2 sm:col-span-1 sm:justify-end">
                      {schedule.isAvailable ? (
                        <>
                          <Input type="time" aria-label={dayName + " " + mt("open")} className="min-h-11 min-w-0 flex-1 text-base sm:w-28 sm:flex-none sm:text-sm" value={schedule.startTime || "09:00"}
                            onChange={(e) => setWeeklySchedule((prev) => ({ ...prev, [index]: { ...schedule, startTime: e.target.value } }))} />
                          <span className="select-none text-muted-foreground" aria-hidden>–</span>
                          <Input type="time" aria-label={dayName + " " + mt("closed")} className="min-h-11 min-w-0 flex-1 text-base sm:w-28 sm:flex-none sm:text-sm" value={schedule.endTime || "17:00"}
                            onChange={(e) => setWeeklySchedule((prev) => ({ ...prev, [index]: { ...schedule, endTime: e.target.value } }))} />
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                          <span className="size-1.5 rounded-full bg-muted-foreground/40" aria-hidden />
                          {mt("closed")}
                        </span>
                      )}
                    </div>
                    <Switch className="order-2 justify-self-end sm:order-3 sm:justify-self-auto" aria-label={dayName} checked={schedule.isAvailable}
                      onCheckedChange={(checked) => setWeeklySchedule((prev) => ({ ...prev, [index]: { ...schedule, isAvailable: checked } }))} />
                    {schedule.isAvailable && !copyableTourHours([schedule], duration, bufferBefore, bufferAfter).length && <p className="order-4 col-span-2 text-xs text-muted-foreground sm:col-span-3">{mt('tourWindowTooShort', { minutes: duration + bufferBefore + bufferAfter })}</p>}
                  </div>
                )
              })}
            </CardContent>
          </Card>
      <details className="group rounded-xl border bg-card">
        <summary className="cursor-pointer px-4 py-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{mt('tourTimingRules')}<span className="mt-1 block text-xs font-normal text-muted-foreground">{mt('tourTimingSummary', { duration, notice: advanceNotice, buffer: bufferBefore + bufferAfter })}</span></summary>
      <div className="border-t">
        <CardHeader className="p-4 pb-3">
          <CardTitle className="text-lg">{mt("viewingSettings")}</CardTitle>
          <CardDescription>{mt("tourSettingsKitchenScope", { kitchen: kitchenName ?? mt("kitchenScopeFallback") })}</CardDescription>
        </CardHeader>
        <CardContent className="divide-y p-0">
          <SettingsRow id="tour-setting-0" label={mt("viewingDuration")} hint={mt("theLengthOfEachViewingAppointment")} help={mt("tourDurationHelp")}>
            <NumericInput id="tour-setting-0" value={String(duration)} suffix={mt("minutesUnit")} className="w-32" onValueChange={(value) => setDuration(Number(value) || 0)} onBlur={() => setDuration(Math.min(120, Math.max(10, duration)))} />
          </SettingsRow>
          <SettingsRow id="tour-setting-1" label={mt("advanceNotice")} hint={mt("theMinimumLeadTimeRequiredBeforeAChefCanBookAViewing")} help={mt("tourAdvanceNoticeHelp")}>
            <NumericInput id="tour-setting-1" value={String(advanceNotice)} suffix={mt("hoursSuffix")} className="w-32" onValueChange={(value) => setAdvanceNotice(Number(value) || 0)} onBlur={() => setAdvanceNotice(Math.min(168, Math.max(0, advanceNotice)))} />
          </SettingsRow>
          <SettingsRow id="tour-setting-2" label={mt("bufferBefore")} hint={mt("preparationTimeAutomaticallyBlockedBeforeEachViewing")} help={mt("tourBufferBeforeHelp")}>
            <NumericInput id="tour-setting-2" value={String(bufferBefore)} suffix={mt("minutesUnit")} className="w-32" onValueChange={(value) => setBufferBefore(Number(value) || 0)} onBlur={() => setBufferBefore(Math.min(60, Math.max(0, bufferBefore)))} />
          </SettingsRow>
          <SettingsRow id="tour-setting-3" label={mt("bufferAfter")} hint={mt("bufferTimeAutomaticallyBlockedAfterEachViewing")} help={mt("tourBufferAfterHelp")}>
            <NumericInput id="tour-setting-3" value={String(bufferAfter)} suffix={mt("minutesUnit")} className="w-32" onValueChange={(value) => setBufferAfter(Number(value) || 0)} onBlur={() => setBufferAfter(Math.min(60, Math.max(0, bufferAfter)))} />
          </SettingsRow>
          <SettingsRow id="tour-setting-4" label={mt("maxAdvanceBooking")} hint={mt("howFarInAdvanceViewingsCanBeScheduled")} help={mt("tourMaxAdvanceHelp")}>
            <NumericInput id="tour-setting-4" value={String(maxDays)} suffix={mt("daysUnit")} className="w-32" onValueChange={(value) => setMaxDays(Number(value) || 0)} onBlur={() => setMaxDays(Math.min(90, Math.max(1, maxDays)))} />
          </SettingsRow>
        </CardContent>
          {!hideSaveActions && (isSettingsDirty || saveSettingsMutation.isPending) && <div className="flex justify-end border-t p-4">
            <Button
              onClick={() => void saveChanges()}
              disabled={saveSettingsMutation.isPending || !isSettingsDirty}
              size="sm"
              className="w-full sm:w-auto"
            >
              {saveSettingsMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {mt('saveChanges')}
            </Button>
          </div>}

      </div>
      </details>


          {!activated && <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">{mt(readiness.schedule ? 'tourScheduleNextHelp' : 'tourScheduleRequired')}</p>
            <Button disabled={!readiness.schedule} onClick={() => focusSetup('arrival')} className="h-auto min-h-11 whitespace-normal py-2">{mt('tourContinueInstructions')}<ArrowRight aria-hidden className="ml-2 size-4" /></Button>
          </div>}
        </TabsContent>

        <TabsContent value="calendar" className="mt-6">
          <div className="grid gap-6 xl:grid-cols-2">
            <Card className="overflow-hidden flex flex-col justify-between">
              <CardHeader className="p-4 pb-3">
                <CardTitle className="text-lg">{mt("calendarOverview")}</CardTitle>
                <CardDescription>{mt("viewDatesBlockedFromReceivingViewingBookings")}</CardDescription>
              </CardHeader>
              <CardContent className="p-4 flex justify-center items-center">
                <Calendar
                  mode="single"
                  className="w-full min-w-0 p-0"
                  classNames={journeyCalendarClassNames(false)}
                  modifiers={blackoutModifiers}
                  modifiersClassNames={{
                    blackout: "bg-destructive/10 text-destructive font-bold rounded-full after:content-['•'] after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:text-destructive after:text-lg"
                  }}
                />
              </CardContent>
              <div className="p-4 border-t bg-muted/10">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="destructive" className="h-2 w-2 p-0 rounded-full" />
                    <span>{mt("exceptionDates")}</span>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => { setBlackoutScope("tour-kitchen"); setAffectedBookingIds([]); setIsBlackoutDialogOpen(true) }}>
                    <Plus className="h-4 w-4 mr-1" />{mt("addException")}</Button>
                </div>
              </div>
            </Card>

            <Card className="flex flex-col h-full">
              <CardHeader className="p-4 pb-3">
                <CardTitle className="text-lg">{mt("upcomingExceptions")}</CardTitle>
                <CardDescription>{mt("periodsWhereViewingsAreCompletelyDisabled")}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 overflow-auto p-0">
                {!data?.blackouts || data.blackouts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <CalendarIcon className="h-10 w-10 mb-2 opacity-20" />
                    <p>{mt("noActiveExceptions")}</p>
                  </div>
                ) : (
                  <div className="w-full overflow-x-auto">
                    <Table className="block sm:table">
                    <TableHeader className="hidden sm:table-header-group">
                      <TableRow>
                        <TableHead>{mt("dates")}</TableHead>
                        <TableHead>{mt("reason")}</TableHead>
                        <TableHead className="text-right">{mt("actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="block sm:table-row-group">
                      {data.blackouts.map((blackout) => (
                        <TableRow key={blackout.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 p-4 sm:table-row sm:p-0">
                          <TableCell className="block min-w-0 p-0 font-medium sm:table-cell sm:p-4">
                            <div className="flex flex-col">
                              <span>{formatTourDate(new Date(blackout.startDate))} - {formatTourDate(new Date(blackout.endDate))}</span>
                            </div>
                          </TableCell>
                          <TableCell className="col-span-2 row-start-2 block min-w-0 p-0 sm:table-cell sm:p-4">
                            <span className="text-xs text-muted-foreground">{blackout.reason || "—"}</span>
                          </TableCell>
                          <TableCell className="col-start-2 row-start-1 block p-0 text-right sm:table-cell sm:p-4">
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-11 w-11 p-0 text-muted-foreground hover:text-destructive sm:h-8 sm:w-8"
                                  aria-label={mt("removeException2")}
                                  onClick={() => setBlackoutScope("tour-kitchen")}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>{mt("removeException2")}</AlertDialogTitle>
                                  <AlertDialogDescription>{mt("thisWillMakeTheseDatesAvailableForViewingsAgain")}</AlertDialogDescription>
                                </AlertDialogHeader>
                                {scopeSelector(`remove-blackout-scope-${blackout.id}`, true)}
                                <AlertDialogFooter>
                                  <AlertDialogCancel>{mt("cancel")}</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => deleteBlackoutMutation.mutate({ blackoutId: blackout.id, scope: blackoutScope })}
                                    className="bg-destructive hover:bg-destructive/90"
                                  >{mt("remove")}</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
      </fieldset>


      {/* Exception Dialog */}
      <Dialog open={isBlackoutDialogOpen} onOpenChange={(open) => { setIsBlackoutDialogOpen(open); if (!open) setAffectedBookingIds([]) }}>
        <DialogContent className="min-w-0 [overflow-wrap:anywhere]">
          <DialogHeader>
            <DialogTitle>{mt("addExceptionPeriod")}</DialogTitle>
            <DialogDescription>{mt("blockOffDatesWhenViewingsAreCompletelyUnavailable")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 flex flex-col">
                <Label>{mt("startDate")}</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("h-auto min-h-11 w-full justify-start whitespace-normal py-2 text-left font-normal", !blackoutStart && "text-muted-foreground")}
                    >
                      <CalendarIcon className="h-4 w-4 mr-2" />
                      {blackoutStart ? format(blackoutStart, "MMM d, yyyy") : "Start"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={blackoutStart}
                      onSelect={(value) => { setBlackoutStart(value); if (value && blackoutEnd && value > blackoutEnd) setBlackoutEnd(undefined); setAffectedBookingIds([]) }}
                      disabled={(date) => isBefore(date, tourToday())}
                      className="w-[280px] p-3"
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2 flex flex-col">
                <Label>{mt("endDate")}</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("h-auto min-h-11 w-full justify-start whitespace-normal py-2 text-left font-normal", !blackoutEnd && "text-muted-foreground")}
                    >
                      <CalendarIcon className="h-4 w-4 mr-2" />
                      {blackoutEnd ? format(blackoutEnd, "MMM d, yyyy") : "End"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={blackoutEnd}
                      onSelect={(value) => { setBlackoutEnd(value); setAffectedBookingIds([]) }}
                      disabled={(date) => isBefore(date, blackoutStart || tourToday())}
                      className="w-[280px] p-3"
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{mt("reasonOptional")}</Label>
              <Input
                value={blackoutReason}
                onChange={(e) => { setBlackoutReason(e.target.value); setAffectedBookingIds([]) }}
                placeholder={mt("eGHolidayFacilityMaintenance")}
                maxLength={200}
              />
            </div>
            {scopeSelector("new-blackout-scope")}
            {affectedBookingIds.length > 0 && <p role="alert" className="rounded-lg border border-amber-500/40 px-3 py-2 text-sm text-foreground">
              {mt("exceptionExistingBookingsStay")}
            </p>}
          </div>
          <DialogFooter className="gap-2 sm:space-x-0 [&>button]:h-auto [&>button]:min-h-11 [&>button]:whitespace-normal [&>button]:py-2">
            <Button variant="ghost" onClick={() => setIsBlackoutDialogOpen(false)}>{mt("cancel")}</Button>
            <Button onClick={() => addBlackoutMutation.mutate(affectedBookingIds.length ? affectedBookingIds : undefined)} disabled={addBlackoutMutation.isPending || !blackoutStart || !blackoutEnd}>
              {addBlackoutMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {mt(affectedBookingIds.length ? "exceptionConfirmKeepBookings" : "saveChanges")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
})

export default ViewingSettingsPanel
