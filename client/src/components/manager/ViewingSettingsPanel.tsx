/**
 * ViewingSettingsPanel
 *
 * Manager-facing component for configuring kitchen viewing availability.
 * Allows managers to: toggle viewings, set duration/buffers/notice,
 * configure weekly availability hours, and manage blackout dates.
 * Built mobile-first with shadcn/ui components.
 */

import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Settings,
  Clock,
  Calendar as CalendarIcon,
  Loader2,
  Plus,
  Trash2,
  Save,
  Eye,
  EyeOff,
  Shield,
  AlertCircle,
  AlertTriangle
} from "lucide-react"
import { toast } from "sonner"
import { auth } from "@/lib/firebase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Calendar } from "@/components/ui/calendar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "@/components/ui/dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { format, isBefore, startOfDay, isWithinInterval, addDays } from "date-fns"

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
  locationId: number
  isActive: boolean
  defaultDurationMinutes: number
  bufferBeforeMinutes: number
  bufferAfterMinutes: number
  advanceNoticeHours: number
  maxAdvanceBookingDays: number
}

interface AvailabilitySlot {
  id?: number
  locationId: number
  dayOfWeek: number
  startTime: string
  endTime: string
  isAvailable: boolean
}

interface Blackout {
  id: number
  locationId: number
  startDate: string
  endDate: string
  reason: string | null
  createdAt: string
}

interface SettingsResponse {
  settings: ViewingSettings | null
  availability: AvailabilitySlot[]
  blackouts: Blackout[]
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

// ─── Component ────────────────────────────────────────────────────────────────

interface ViewingSettingsPanelProps {
  locationId: number
  locationName?: string
}

export function ViewingSettingsPanel({ locationId, locationName }: ViewingSettingsPanelProps) {
  const queryClient = useQueryClient()

  // Local state for settings form
  const [isActive, setIsActive] = useState(false)
  const [duration, setDuration] = useState(30)
  const [bufferBefore, setBufferBefore] = useState(0)
  const [bufferAfter, setBufferAfter] = useState(15)
  const [advanceNotice, setAdvanceNotice] = useState(24)
  const [maxDays, setMaxDays] = useState(30)

  // Layout tabs
  const [activeTab, setActiveTab] = useState("weekly")

  // Weekly availability editing - map to exactly 1 per day
  const [weeklySchedule, setWeeklySchedule] = useState<Record<number, AvailabilitySlot>>({})

  // Blackout Dialog form
  const [isBlackoutDialogOpen, setIsBlackoutDialogOpen] = useState(false)
  const [blackoutStart, setBlackoutStart] = useState<Date>()
  const [blackoutEnd, setBlackoutEnd] = useState<Date>()
  const [blackoutReason, setBlackoutReason] = useState("")

  // Fetch current settings
  const { data, isLoading } = useQuery<SettingsResponse>({
    queryKey: [`/api/viewings/settings/${locationId}`],
    staleTime: 10000,
  })

  // Initialize local state from fetched data
  useEffect(() => {
    if (data?.settings) {
      setIsActive(data.settings.isActive)
      setDuration(data.settings.defaultDurationMinutes)
      setBufferBefore(data.settings.bufferBeforeMinutes)
      setBufferAfter(data.settings.bufferAfterMinutes)
      setAdvanceNotice(data.settings.advanceNoticeHours)
      setMaxDays(data.settings.maxAdvanceBookingDays)
    }
    if (data?.availability) {
      const scheduleMap: Record<number, AvailabilitySlot> = {}
      // Pre-fill with defaults
      for (let i = 0; i < 7; i++) {
        scheduleMap[i] = {
          locationId,
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
    }
  }, [data, locationId])

  // Save settings mutation
  const saveSettingsMutation = useMutation({
    mutationFn: async () => {
      const headers = await getAuthHeaders()
      const response = await fetch(`/api/viewings/settings/${locationId}`, {
        method: "PUT",
        headers,
        credentials: "include",
        body: JSON.stringify({
          isActive,
          defaultDurationMinutes: duration,
          bufferBeforeMinutes: bufferBefore,
          bufferAfterMinutes: bufferAfter,
          advanceNoticeHours: advanceNotice,
          maxAdvanceBookingDays: maxDays,
        }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || "Failed to save settings")
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/viewings/settings/${locationId}`] })
      toast.success("Viewing settings saved!")
    },
    onError: (error: Error) => toast.error(error.message),
  })

  // Save availability mutation
  const saveAvailabilityMutation = useMutation({
    mutationFn: async () => {
      const slotsToSave = Object.values(weeklySchedule).filter((s) => s.isAvailable)
      const headers = await getAuthHeaders()
      const response = await fetch(`/api/viewings/availability/${locationId}`, {
        method: "PUT",
        headers,
        credentials: "include",
        body: JSON.stringify({
          slots: slotsToSave,
        }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || "Failed to save availability")
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/viewings/settings/${locationId}`] })
      toast.success("Weekly availability saved!")
    },
    onError: (error: Error) => toast.error(error.message),
  })

  // Add blackout mutation
  const addBlackoutMutation = useMutation({
    mutationFn: async () => {
      if (!blackoutStart || !blackoutEnd) throw new Error("Select start and end dates")
      const headers = await getAuthHeaders()
      const response = await fetch(`/api/viewings/blackouts/${locationId}`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          startDate: blackoutStart.toISOString(),
          endDate: blackoutEnd.toISOString(),
          reason: blackoutReason || undefined,
        }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || "Failed to add blackout")
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/viewings/settings/${locationId}`] })
      setIsBlackoutDialogOpen(false)
      setBlackoutStart(undefined)
      setBlackoutEnd(undefined)
      setBlackoutReason("")
      toast.success("Blackout period added!")
    },
    onError: (error: Error) => toast.error(error.message),
  })

  // Delete blackout mutation
  const deleteBlackoutMutation = useMutation({
    mutationFn: async (blackoutId: number) => {
      const headers = await getAuthHeaders()
      const response = await fetch(`/api/viewings/blackouts/${blackoutId}`, {
        method: "DELETE",
        headers,
        credentials: "include",
      })
      if (!response.ok) throw new Error("Failed to delete blackout")
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/viewings/settings/${locationId}`] })
      toast.success("Blackout removed!")
    },
    onError: (error: Error) => toast.error(error.message),
  })


  // ─── Render ─────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Determine modifiers for the calendar
  const blackoutModifiers = {
    blackout: (date: Date) => {
      if (!data?.blackouts) return false;
      return data.blackouts.some((b) => {
        const start = startOfDay(new Date(b.startDate));
        const end = startOfDay(new Date(b.endDate));
        // Add 1 day to end if we want inclusive, but let's assume it's already inclusive
        return date >= start && date <= end; // inclusive check
      });
    }
  }

  return (
    <div className="space-y-6">
      {/* Section 1: General Settings */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <Settings className="h-5 w-5" />
                Tour Settings
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Configure how chefs can book tours at {locationName || "your location"}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {isActive ? (
                <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                  <Eye className="h-3 w-3 mr-1" /> Active
                </Badge>
              ) : (
                <Badge variant="secondary">
                  <EyeOff className="h-3 w-3 mr-1" /> Inactive
                </Badge>
              )}
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs sm:text-sm">Tour Duration (minutes)</Label>
              <Select
                value={String(duration)}
                onValueChange={(v) => setDuration(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[15, 20, 30, 45, 60, 90].map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m} min
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs sm:text-sm">Advance Notice (hours)</Label>
              <Select
                value={String(advanceNotice)}
                onValueChange={(v) => setAdvanceNotice(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[2, 4, 8, 12, 24, 48, 72].map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {h < 24 ? `${h} hours` : `${h / 24} day${h > 24 ? "s" : ""}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs sm:text-sm">Buffer Before (minutes)</Label>
              <Select
                value={String(bufferBefore)}
                onValueChange={(v) => setBufferBefore(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[0, 5, 10, 15, 30].map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m === 0 ? "None" : `${m} min`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs sm:text-sm">Buffer After (minutes)</Label>
              <Select
                value={String(bufferAfter)}
                onValueChange={(v) => setBufferAfter(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[0, 5, 10, 15, 30].map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m === 0 ? "None" : `${m} min`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs sm:text-sm">Max Advance Booking (days)</Label>
            <Select
              value={String(maxDays)}
              onValueChange={(v) => setMaxDays(Number(v))}
            >
              <SelectTrigger className="sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[7, 14, 30, 60, 90].map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d} days
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            onClick={() => saveSettingsMutation.mutate()}
            disabled={saveSettingsMutation.isPending}
            className="w-full sm:w-auto"
          >
            {saveSettingsMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Settings
          </Button>
        </CardContent>
      </Card>

      {/* Tabs for Schedule vs Exceptions */}
      <Tabs defaultValue="weekly" value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="weekly">Weekly Schedule</TabsTrigger>
          <TabsTrigger value="calendar">Exceptions & Calendar</TabsTrigger>
        </TabsList>

        <TabsContent value="weekly" className="space-y-4 mt-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <div className="space-y-1">
                <CardTitle className="text-lg">Recurring Weekly Hours</CardTitle>
                <CardDescription>Default hours available for kitchen tours.</CardDescription>
              </div>
              <Button
                onClick={() => saveAvailabilityMutation.mutate()}
                disabled={saveAvailabilityMutation.isPending}
              >
                {saveAvailabilityMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save Schedule
              </Button>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[100px]">Day</TableHead>
                      <TableHead className="w-[100px]">Status</TableHead>
                      <TableHead>Hours</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {DAY_NAMES.map((dayName, index) => {
                      const schedule = weeklySchedule[index] || { isAvailable: false, startTime: "09:00", endTime: "17:00", dayOfWeek: index, locationId };
                      return (
                        <TableRow key={index}>
                          <TableCell className="font-medium">{dayName}</TableCell>
                          <TableCell>
                            <div className="flex items-center space-x-2">
                              <Switch
                                checked={schedule.isAvailable}
                                onCheckedChange={(checked) => {
                                  setWeeklySchedule((prev) => ({
                                    ...prev,
                                    [index]: { ...prev[index], isAvailable: checked },
                                  }))
                                }}
                              />
                              <Badge
                                variant={schedule.isAvailable ? "outline" : "secondary"}
                                className={cn("w-16 justify-center", !schedule.isAvailable && "opacity-50")}
                              >
                                {schedule.isAvailable ? "Open" : "Closed"}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell>
                            {schedule.isAvailable ? (
                              <div className="flex items-center gap-2">
                                <Input
                                  type="time"
                                  className="w-28 h-8 text-sm"
                                  value={schedule.startTime || "09:00"}
                                  onChange={(e) => {
                                    setWeeklySchedule((prev) => ({
                                      ...prev,
                                      [index]: { ...prev[index], startTime: e.target.value },
                                    }))
                                  }}
                                />
                                <span className="text-muted-foreground text-xs">–</span>
                                <Input
                                  type="time"
                                  className="w-28 h-8 text-sm"
                                  value={schedule.endTime || "17:00"}
                                  onChange={(e) => {
                                    setWeeklySchedule((prev) => ({
                                      ...prev,
                                      [index]: { ...prev[index], endTime: e.target.value },
                                    }))
                                  }}
                                />
                              </div>
                            ) : (
                              <div className="h-8 flex items-center">
                                <span className="text-sm text-muted-foreground italic">Unavailable</span>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calendar" className="mt-6">
          <div className="grid gap-6 xl:grid-cols-2">
            <Card className="overflow-hidden flex flex-col justify-between">
              <CardHeader>
                <CardTitle>Calendar Overview</CardTitle>
                <CardDescription>View dates blocked from receiving tour bookings.</CardDescription>
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
                    <span>Blackout Dates</span>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setIsBlackoutDialogOpen(true)}>
                    <Plus className="h-4 w-4 mr-1" /> Add Blackout
                  </Button>
                </div>
              </div>
            </Card>

            <Card className="flex flex-col h-full">
              <CardHeader>
                <CardTitle>Upcoming Blackouts</CardTitle>
                <CardDescription>Periods where tours are completely disabled</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 overflow-auto p-0">
                {!data?.blackouts || data.blackouts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <CalendarIcon className="h-10 w-10 mb-2 opacity-20" />
                    <p>No active blackouts.</p>
                  </div>
                ) : (
                  <div className="rounded-md border overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                    <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Dates</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.blackouts.map((blackout) => (
                        <TableRow key={blackout.id}>
                          <TableCell className="font-medium whitespace-nowrap">
                            <div className="flex flex-col">
                              <span>{format(new Date(blackout.startDate), "MMM d")} - {format(new Date(blackout.endDate), "MMM d, yyyy")}</span>
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
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Remove blackout?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will make these dates available for tours again.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => deleteBlackoutMutation.mutate(blackout.id)}
                                    className="bg-destructive hover:bg-destructive/90"
                                  >
                                    Remove
                                  </AlertDialogAction>
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

      {/* Info callout */}
      <Card className="bg-blue-50/50 border-blue-200">
        <CardContent className="pt-4">
          <div className="flex gap-3">
            <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs sm:text-sm text-blue-800 space-y-1">
              <p className="font-medium">How it works</p>
              <p>
                When you enable tours, chefs will see a "Schedule a Tour" button
                on your kitchen listing. They'll pick a date and time from the availability
                you set here. Bookings are automatically confirmed in real-time.
              </p>
              <p>
                Adding a blackout will automatically cancel any existing tours in that
                period and notify the affected chefs.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Blackout Dialog */}
      <Dialog open={isBlackoutDialogOpen} onOpenChange={setIsBlackoutDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Blackout Period</DialogTitle>
            <DialogDescription>Block off dates when tours are completely unavailable.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 flex flex-col">
                <Label>Start Date</Label>
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
                      onSelect={setBlackoutStart}
                      disabled={(date) => isBefore(date, startOfDay(new Date()))}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2 flex flex-col">
                <Label>End Date</Label>
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
                      onSelect={setBlackoutEnd}
                      disabled={(date) => isBefore(date, blackoutStart || startOfDay(new Date()))}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Reason (optional)</Label>
              <Input
                value={blackoutReason}
                onChange={(e) => setBlackoutReason(e.target.value)}
                placeholder="e.g., Holiday, Facility Maintenance"
                maxLength={200}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBlackoutDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => addBlackoutMutation.mutate()} disabled={addBlackoutMutation.isPending || !blackoutStart || !blackoutEnd}>
              {addBlackoutMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Blackout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}

export default ViewingSettingsPanel
