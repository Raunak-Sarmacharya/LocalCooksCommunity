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
import { Calendar as CalendarIcon, Loader2, Plus, Trash2, Save } from "@/components/ui/manager-icons"
import { toast } from "sonner"
import { auth } from "@/lib/firebase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ViewingSettingsPanelProps {
  hideSaveActions?: boolean
  kitchenId: number
  kitchenName?: string
  facilityKitchenCount?: number
  onDirtyChange?: (dirty: boolean) => void
}

export interface ViewingSettingsPanelHandle {
  saveChanges: () => Promise<boolean>
}

export const ViewingSettingsPanel = forwardRef<ViewingSettingsPanelHandle, ViewingSettingsPanelProps>(function ViewingSettingsPanel({ kitchenId, kitchenName, facilityKitchenCount = 1, onDirtyChange, hideSaveActions = false }, ref) {
  
  const queryClient = useQueryClient()

  // Local state for settings form
  const [duration, setDuration] = useState(30)
  const [bufferBefore, setBufferBefore] = useState(0)
  const [bufferAfter, setBufferAfter] = useState(15)
  const [advanceNotice, setAdvanceNotice] = useState(24)
  const [maxDays, setMaxDays] = useState(30)

  // Layout tabs
  const [activeTab, setActiveTab] = useState("weekly")

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
    }
    // Refetching one section must not discard unsaved edits in the other.
    if (!dirtyFields.current.settings) {
      setDuration(settings.defaultDurationMinutes)
      setBufferBefore(settings.bufferBeforeMinutes)
      setBufferAfter(settings.bufferAfterMinutes)
      setAdvanceNotice(settings.advanceNoticeHours)
      setMaxDays(settings.maxAdvanceBookingDays)
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
  }
  const isSettingsDirty = !!savedSettings && JSON.stringify(currentSettings) !== savedSettings
  const isScheduleDirty = !!savedWeeklySchedule && JSON.stringify(weeklySchedule) !== savedWeeklySchedule
  dirtyFields.current = { settings: isSettingsDirty, schedule: isScheduleDirty }

  // Save settings mutation
  const saveSettingsMutation = useMutation({
    mutationFn: async () => {
      const headers = await getAuthHeaders()
      const response = await fetch(`/api/viewings/settings/${kitchenId}`, {
        method: "PUT",
        headers,
        credentials: "include",
        body: JSON.stringify(currentSettings),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || mt("viewingSettingsSaveFailed"))
      }
      return response.json()
    },
    onSuccess: () => {
      setSavedSettings(JSON.stringify(currentSettings))
      queryClient.invalidateQueries({ queryKey: [`/api/viewings/settings/${kitchenId}`] })
      toast.success(mt("viewingSettingsSaved"))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  // Save availability mutation
  const saveAvailabilityMutation = useMutation({
    mutationFn: async () => {
      const slotsToSave = Object.values(weeklySchedule).filter((s) => s.isAvailable)
      const headers = await getAuthHeaders()
      const response = await fetch(`/api/viewings/availability/${kitchenId}`, {
        method: "PUT",
        headers,
        credentials: "include",
        body: JSON.stringify({
          slots: slotsToSave,
        }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || mt("weeklyAvailabilitySaveFailed"))
      }
      return response.json()
    },
    onSuccess: () => {
      setSavedWeeklySchedule(JSON.stringify(weeklySchedule))
      queryClient.invalidateQueries({ queryKey: [`/api/viewings/settings/${kitchenId}`] })
      toast.success(mt("weeklyAvailabilitySaved"))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  useEffect(() => {
    onDirtyChange?.(isSettingsDirty || isScheduleDirty)
  }, [isScheduleDirty, isSettingsDirty, onDirtyChange])

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  useImperativeHandle(ref, () => ({
    saveChanges: async () => {
      try {
        if (isSettingsDirty) await saveSettingsMutation.mutateAsync()
        if (isScheduleDirty) await saveAvailabilityMutation.mutateAsync()
        return true
      } catch {
        return false
      }
    },
  }), [isScheduleDirty, isSettingsDirty, saveAvailabilityMutation, saveSettingsMutation])

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
    <div className="space-y-6">
      <Tabs defaultValue="weekly" value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="h-auto w-full justify-start gap-6 overflow-x-auto rounded-none border-b border-border bg-transparent p-0 text-muted-foreground">
          <TabsTrigger value="weekly" className={TAB_TRIGGER}>
            {mt("weeklySchedule")}
          </TabsTrigger>
          <TabsTrigger value="calendar" className={TAB_TRIGGER}>
            {mt("exceptionsCalendar")}
          </TabsTrigger>
          <TabsTrigger value="settings" className={TAB_TRIGGER}>{mt("viewingSettings")}</TabsTrigger>
        </TabsList>

      <TabsContent value="settings" className="mt-6">
      <Card>
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
              onClick={() => saveSettingsMutation.mutate()}
              disabled={saveSettingsMutation.isPending || !isSettingsDirty}
              size="sm"
              className="w-full sm:w-auto"
            >
              {saveSettingsMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Settings
            </Button>
          </div>}

      </Card>
      </TabsContent>

        <TabsContent value="weekly" className="space-y-6 mt-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4">
              <div className="space-y-1">
                <CardTitle className="text-lg">{mt("recurringWeeklyHours")}</CardTitle>
                <CardDescription>{mt("defaultHoursAvailableForKitchenViewings")}</CardDescription>
              </div>
              {!hideSaveActions && (isScheduleDirty || saveAvailabilityMutation.isPending) && <Button
                onClick={() => saveAvailabilityMutation.mutate()}
                disabled={saveAvailabilityMutation.isPending || !isScheduleDirty}
              >
                {saveAvailabilityMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                {mt("saveSchedule")}
              </Button>}
            </CardHeader>
            <p className="px-4 pb-3 text-sm text-muted-foreground">{mt("tourHoursOvernightHelp")}</p>
            <CardContent className="divide-y p-0">
              {DAY_NAMES.map((dayName, index) => {
                const schedule = weeklySchedule[index] || { isAvailable: false, startTime: "09:00", endTime: "17:00", dayOfWeek: index, kitchenId };
                return (
                  <div key={index} className="grid grid-cols-1 items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/30 sm:grid-cols-[7rem_1fr_auto]">
                    <Label className="text-sm font-medium text-foreground">{dayName}</Label>
                    <div className="order-3 col-span-2 flex items-center gap-2 sm:order-2 sm:col-span-1 sm:justify-end">
                      {schedule.isAvailable ? (
                        <>
                          <Input type="time" aria-label={dayName + " " + mt("open")} className="h-9 min-w-0 flex-1 text-sm sm:w-28 sm:flex-none" value={schedule.startTime || "09:00"}
                            onChange={(e) => setWeeklySchedule((prev) => ({ ...prev, [index]: { ...schedule, startTime: e.target.value } }))} />
                          <span className="select-none text-muted-foreground" aria-hidden>–</span>
                          <Input type="time" aria-label={dayName + " " + mt("closed")} className="h-9 min-w-0 flex-1 text-sm sm:w-28 sm:flex-none" value={schedule.endTime || "17:00"}
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
                  </div>
                )
              })}
            </CardContent>
          </Card>
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
                  className="p-3 w-full"
                  modifiers={blackoutModifiers}
                  modifiersClassNames={{
                    blackout: "bg-destructive/10 text-destructive font-bold rounded-full after:content-['•'] after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:text-destructive after:text-lg"
                  }}
                />
              </CardContent>
              <div className="p-4 border-t bg-muted/10">
                <div className="flex items-center justify-between">
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
                    <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{mt("dates")}</TableHead>
                        <TableHead>{mt("reason")}</TableHead>
                        <TableHead className="text-right">{mt("actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.blackouts.map((blackout) => (
                        <TableRow key={blackout.id}>
                          <TableCell className="font-medium whitespace-nowrap">
                            <div className="flex flex-col">
                              <span>{formatTourDate(new Date(blackout.startDate))} - {formatTourDate(new Date(blackout.endDate))}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs text-muted-foreground">{blackout.reason || "—"}</span>
                          </TableCell>
                          <TableCell className="text-right">
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
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


      {/* Exception Dialog */}
      <Dialog open={isBlackoutDialogOpen} onOpenChange={(open) => { setIsBlackoutDialogOpen(open); if (!open) setAffectedBookingIds([]) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mt("addExceptionPeriod")}</DialogTitle>
            <DialogDescription>{mt("blockOffDatesWhenViewingsAreCompletelyUnavailable")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 flex flex-col">
                <Label>{mt("startDate")}</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("w-full justify-start text-left font-normal", !blackoutStart && "text-muted-foreground")}
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
                      className={cn("w-full justify-start text-left font-normal", !blackoutEnd && "text-muted-foreground")}
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
          <DialogFooter>
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
