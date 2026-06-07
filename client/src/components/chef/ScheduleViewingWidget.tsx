/**
 * ScheduleViewingWidget
 *
 * Chef-facing component for booking kitchen viewings.
 * Features a calendar date picker, time slot selector, and pre-viewing intake form.
 * Built mobile-first with shadcn/ui components.
 */

import { useState, useCallback } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  CalendarDays,
  Clock,
  MapPin,
  ChefHat,
  Loader2,
  CheckCircle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Briefcase,
  ClipboardList,
  Send,
} from "lucide-react"
import { toast } from "sonner"
import { auth } from "@/lib/firebase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
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
import { Calendar } from "@/components/ui/calendar"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { format, addDays, isBefore, startOfDay, endOfDay } from "date-fns"

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

interface TimeSlot {
  startTime: string
  endTime: string
  scheduledAt: string
}

interface AvailabilityResponse {
  locationName: string
  date: string
  timezone: string
  slots: TimeSlot[]
  settings: {
    defaultDurationMinutes: number
    maxAdvanceBookingDays: number
    advanceNoticeHours: number
    isActive: boolean
  } | null
}

interface IntakeData {
  intendedUse?: string
  estimatedWeeklyHours?: string
  hasLicense?: boolean
  targetStartDate?: string
  additionalInfo?: string
}

// ─── Steps ────────────────────────────────────────────────────────────────────

type BookingStep = "date" | "time" | "intake" | "confirm" | "success"

// ─── Component ────────────────────────────────────────────────────────────────

interface ScheduleViewingWidgetProps {
  locationId: number
  locationName?: string
  targetedKitchenId?: number
  targetedKitchenName?: string
  mode?: "inline" | "modal"
  onClose?: () => void
  open?: boolean
}

export function ScheduleViewingWidget({
  locationId,
  locationName,
  targetedKitchenId,
  targetedKitchenName,
  onClose,
  open = true,
}: ScheduleViewingWidgetProps) {
  const queryClient = useQueryClient()

  // Step management
  const [step, setStep] = useState<BookingStep>("date")
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined)
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null)
  const [chefNotes, setChefNotes] = useState("")
  const [intakeData, setIntakeData] = useState<IntakeData>({})

  // Fetch available slots for the selected date
  const dateStr = selectedDate ? format(selectedDate, "yyyy-MM-dd") : ""
  const {
    data: availability,
    isLoading: slotsLoading,
    isFetching: slotsFetching,
  } = useQuery<AvailabilityResponse>({
    queryKey: [`/api/viewings/available-slots/${locationId}?date=${dateStr}`],
    enabled: !!selectedDate && !!dateStr,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
  })

  // Fetch calendar availability metadata (for disabling dates)
  const { data: calMetadata } = useQuery({
    queryKey: [`/api/viewings/calendar-availability/${locationId}`],
    queryFn: async () => {
      const headers = await getAuthHeaders()
      const response = await fetch(`/api/viewings/calendar-availability/${locationId}`, {
        headers,
        credentials: "include",
      })
      if (!response.ok) return null
      return response.json()
    },
    enabled: !!locationId,
  })

  // Booking mutation
  const bookMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSlot) throw new Error("No time slot selected")
      const headers = await getAuthHeaders()
      const response = await fetch("/api/viewings/book", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          locationId,
          targetedKitchenId,
          scheduledAt: selectedSlot.scheduledAt,
          chefNotes: chefNotes || undefined,
          intakeData: Object.keys(intakeData).length > 0 ? intakeData : undefined,
        }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        if (err.code === "SLOT_TAKEN") {
          throw new Error("This time slot was just taken. Please pick another.")
        }
        throw new Error(err.error || "Failed to book viewing")
      }
      return response.json()
    },
    onSuccess: () => {
      setStep("success")
      queryClient.invalidateQueries({ queryKey: ["/api/viewings/chef"] })
      toast.success("Kitchen viewing booked!")
    },
    onError: (error: Error) => {
      toast.error(error.message)
      // If slot was taken, go back to time selection
      if (error.message.includes("slot")) {
        setSelectedSlot(null)
        setStep("time")
      }
    },
  })

  const maxBookingDays = availability?.settings?.maxAdvanceBookingDays || 30
  const today = startOfDay(new Date())

  const handleDateSelect = useCallback(
    (date: Date | undefined) => {
      setSelectedDate(date)
      setSelectedSlot(null)
      if (date) setStep("time")
    },
    []
  )

  const handleSlotSelect = useCallback((slot: TimeSlot) => {
    setSelectedSlot(slot)
    setStep("intake")
  }, [])

  const handleBack = useCallback(() => {
    if (step === "time") setStep("date")
    else if (step === "intake") setStep("time")
    else if (step === "confirm") setStep("intake")
  }, [step])

  const resetForm = useCallback(() => {
    setStep("date")
    setSelectedDate(undefined)
    setSelectedSlot(null)
    setChefNotes("")
    setIntakeData({})
  }, [])

  // ─── Render Steps ─────────────────────────────────────────────────────────

  const renderStepIndicator = () => {
    const steps = [
      { key: "date", label: "Date", icon: CalendarDays },
      { key: "time", label: "Time", icon: Clock },
      { key: "intake", label: "Details", icon: ClipboardList },
      { key: "confirm", label: "Confirm", icon: CheckCircle },
    ]

    const currentIndex = steps.findIndex((s) => s.key === step)

    return (
      <div className="flex items-center justify-center gap-1 sm:gap-2 mb-4 sm:mb-6">
        {steps.map((s, i) => {
          const Icon = s.icon
          const isActive = s.key === step
          const isCompleted = i < currentIndex
          return (
            <div key={s.key} className="flex items-center gap-1">
              <div
                className={cn(
                  "flex items-center gap-1 px-2 py-1 rounded-full text-xs sm:text-sm transition-colors",
                  isActive && "bg-primary text-primary-foreground",
                  isCompleted && "bg-green-100 text-green-700",
                  !isActive && !isCompleted && "bg-muted text-muted-foreground"
                )}
              >
                <Icon className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">{s.label}</span>
              </div>
              {i < steps.length - 1 && (
                <div className={cn(
                  "w-4 sm:w-8 h-0.5",
                  i < currentIndex ? "bg-green-400" : "bg-muted"
                )} />
              )}
            </div>
          )
        })}
      </div>
    )
  }

  const renderDateStep = () => (
    <div className="space-y-4">
      <div className="text-center space-y-1">
        <h3 className="text-base sm:text-lg font-semibold">Pick a date</h3>
        <p className="text-xs sm:text-sm text-muted-foreground">
          Choose when you'd like to visit {locationName || "the kitchen"}
        </p>
      </div>
      <div className="flex justify-center">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={handleDateSelect}
          disabled={(date) => {
            const maxDays = calMetadata?.settings?.maxAdvanceBookingDays || maxBookingDays;
            if (isBefore(date, today) || isBefore(addDays(today, maxDays), date)) return true;
            if (!calMetadata) return false;

            // Check day of week
            const dayOfWeek = date.getDay();
            const availDay = calMetadata.availability?.find((a: any) => a.dayOfWeek === dayOfWeek);
            if (!availDay || !availDay.isAvailable) return true;

            // Check blackouts
            const dStart = startOfDay(date);
            for (const b of calMetadata.blackouts || []) {
              if (dStart >= startOfDay(new Date(b.startDate)) && dStart <= endOfDay(new Date(b.endDate))) {
                return true;
              }
            }

            // Check fully booked dates
            const dateStr = format(date, "yyyy-MM-dd");
            if (calMetadata.fullyBookedDates?.includes(dateStr)) return true;

            return false;
          }}
          className="rounded-md border"
        />
      </div>
    </div>
  )

  const renderTimeStep = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={handleBack} className="h-8 w-8">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h3 className="text-base sm:text-lg font-semibold">Choose a time</h3>
          <p className="text-xs sm:text-sm text-muted-foreground">
            {selectedDate && format(selectedDate, "EEEE, MMMM d, yyyy")}
          </p>
        </div>
      </div>

      {(slotsLoading || slotsFetching) ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading available times...</span>
        </div>
      ) : availability?.slots.length === 0 ? (
        <div className="text-center py-12 space-y-3">
          <Clock className="h-10 w-10 mx-auto text-muted-foreground opacity-40" />
          <p className="text-sm text-muted-foreground">
            No available time slots on this date.
          </p>
          <Button variant="outline" size="sm" onClick={() => setStep("date")}>
            <CalendarDays className="h-4 w-4 mr-2" />
            Try another date
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {availability?.slots.map((slot) => (
            <Button
              key={slot.scheduledAt}
              variant={selectedSlot?.scheduledAt === slot.scheduledAt ? "default" : "outline"}
              className={cn(
                "h-auto py-3 flex flex-col gap-0.5",
                selectedSlot?.scheduledAt === slot.scheduledAt &&
                  "ring-2 ring-primary ring-offset-2"
              )}
              onClick={() => handleSlotSelect(slot)}
            >
              <span className="text-sm font-medium">{slot.startTime}</span>
              <span className="text-[10px] text-muted-foreground">
                to {slot.endTime}
              </span>
            </Button>
          ))}
        </div>
      )}
    </div>
  )

  const renderIntakeStep = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={handleBack} className="h-8 w-8">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h3 className="text-base sm:text-lg font-semibold">Tell us about your needs</h3>
          <p className="text-xs sm:text-sm text-muted-foreground">
            This helps the kitchen manager prepare for your viewing.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Intended Use */}
        <div className="space-y-2">
          <Label className="text-sm">What will you use the kitchen for?</Label>
          <Select
            value={intakeData.intendedUse || ""}
            onValueChange={(v) => setIntakeData({ ...intakeData, intendedUse: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select intended use" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="catering">Catering</SelectItem>
              <SelectItem value="meal_prep">Meal Prep</SelectItem>
              <SelectItem value="baking">Baking / Pastry</SelectItem>
              <SelectItem value="food_truck">Food Truck Prep</SelectItem>
              <SelectItem value="food_production">Food Production</SelectItem>
              <SelectItem value="cooking_class">Cooking Classes</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Estimated Hours */}
        <div className="space-y-2">
          <Label className="text-sm">Estimated weekly hours needed?</Label>
          <Select
            value={intakeData.estimatedWeeklyHours || ""}
            onValueChange={(v) =>
              setIntakeData({ ...intakeData, estimatedWeeklyHours: v })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Select estimated hours" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1-5">1 – 5 hours</SelectItem>
              <SelectItem value="5-10">5 – 10 hours</SelectItem>
              <SelectItem value="10-20">10 – 20 hours</SelectItem>
              <SelectItem value="20+">20+ hours</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Food Safety License */}
        <div className="flex items-center space-x-2">
          <Checkbox
            id="hasLicense"
            checked={intakeData.hasLicense || false}
            onCheckedChange={(checked) =>
              setIntakeData({ ...intakeData, hasLicense: !!checked })
            }
          />
          <Label htmlFor="hasLicense" className="text-sm cursor-pointer">
            I have a valid food safety license
          </Label>
        </div>

        {/* Notes */}
        <div className="space-y-2">
          <Label className="text-sm">
            Anything specific you want to see or discuss? (optional)
          </Label>
          <Textarea
            value={chefNotes}
            onChange={(e) => setChefNotes(e.target.value)}
            placeholder="e.g., equipment needs, storage requirements..."
            maxLength={500}
            rows={3}
          />
          <p className="text-xs text-muted-foreground text-right">
            {chefNotes.length}/500
          </p>
        </div>
      </div>

      <Button className="w-full" onClick={() => setStep("confirm")}>
        Review & Confirm
        <ArrowRight className="h-4 w-4 ml-2" />
      </Button>
    </div>
  )

  const renderConfirmStep = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={handleBack} className="h-8 w-8">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h3 className="text-base sm:text-lg font-semibold">Confirm your viewing</h3>
      </div>

      <Card className="border-primary/20">
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-start gap-3">
            <Building2 className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium">{locationName || "Kitchen"}</p>
              {targetedKitchenName && (
                <p className="text-xs text-muted-foreground">
                  Interested in: {targetedKitchenName}
                </p>
              )}
            </div>
          </div>

          <Separator />

          <div className="flex items-start gap-3">
            <CalendarDays className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium">
                {selectedDate && format(selectedDate, "EEEE, MMMM d, yyyy")}
              </p>
              <p className="text-xs text-muted-foreground">
                {selectedSlot?.startTime} — {selectedSlot?.endTime}
              </p>
            </div>
          </div>

          {intakeData.intendedUse && (
            <>
              <Separator />
              <div className="flex items-start gap-3">
                <Briefcase className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-medium">
                    {intakeData.intendedUse?.replace(/_/g, " ")}
                  </p>
                  {intakeData.estimatedWeeklyHours && (
                    <p className="text-xs text-muted-foreground">
                      ~{intakeData.estimatedWeeklyHours} hours/week
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Button
        className="w-full"
        size="lg"
        onClick={() => bookMutation.mutate()}
        disabled={bookMutation.isPending}
      >
        {bookMutation.isPending ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Booking...
          </>
        ) : (
          <>
            <Send className="h-4 w-4 mr-2" />
            Book Viewing
          </>
        )}
      </Button>

      <p className="text-xs text-center text-muted-foreground">
        You'll receive a confirmation notification and email.
      </p>
    </div>
  )

  const renderSuccessStep = () => (
    <div className="text-center space-y-4 py-4 sm:py-8">
      <div className="mx-auto w-14 h-14 sm:w-16 sm:h-16 bg-green-100 rounded-full flex items-center justify-center">
        <CheckCircle className="h-7 w-7 sm:h-8 sm:w-8 text-green-600" />
      </div>
      <div className="space-y-1">
        <h3 className="text-lg sm:text-xl font-semibold text-green-700">
          Viewing Requested!
        </h3>
        <p className="text-sm text-muted-foreground">
          Your kitchen viewing at {locationName || "the kitchen"} has been requested and is awaiting manager approval.
        </p>
      </div>

      <Card className="bg-muted/50">
        <CardContent className="pt-4 text-sm space-y-1.5">
          <p>
            <span className="text-muted-foreground">Date:</span>{" "}
            <span className="font-medium">
              {selectedDate && format(selectedDate, "EEEE, MMMM d, yyyy")}
            </span>
          </p>
          <p>
            <span className="text-muted-foreground">Time:</span>{" "}
            <span className="font-medium">
              {selectedSlot?.startTime} — {selectedSlot?.endTime}
            </span>
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-col sm:flex-row gap-2 pt-2">
        <Button variant="outline" className="flex-1" onClick={resetForm}>
          Book Another
        </Button>
        {onClose && (
          <Button className="flex-1" onClick={onClose}>
            Done
          </Button>
        )}
      </div>
    </div>
  )

  // ─── Main Render ──────────────────────────────────────────────────────────

  const content = (
    <div className="w-full max-w-lg mx-auto">
      {step !== "success" && renderStepIndicator()}

      {step === "date" && renderDateStep()}
      {step === "time" && renderTimeStep()}
      {step === "intake" && renderIntakeStep()}
      {step === "confirm" && renderConfirmStep()}
      {step === "success" && renderSuccessStep()}
    </div>
  )

  // If used as a modal (with open/onClose props)
  if (onClose !== undefined) {
    return (
      <Sheet open={open} onOpenChange={(o) => !o && onClose?.()}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto p-4 sm:p-6">
          <SheetHeader className="mb-6">
            <SheetTitle className="flex items-center gap-2 text-base sm:text-lg">
              <MapPin className="h-5 w-5 text-primary" />
              Schedule a Kitchen Viewing
            </SheetTitle>
            <SheetDescription className="text-xs sm:text-sm">
              Book an in-person viewing of {locationName || "the kitchen facility"}
            </SheetDescription>
          </SheetHeader>
          {content}
        </SheetContent>
      </Sheet>
    )
  }

  // Inline mode
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
          <MapPin className="h-5 w-5 text-primary" />
          Schedule a Kitchen Viewing
        </CardTitle>
        <CardDescription className="text-xs sm:text-sm">
          Book an in-person viewing of {locationName || "the kitchen facility"}
        </CardDescription>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  )
}

export default ScheduleViewingWidget
