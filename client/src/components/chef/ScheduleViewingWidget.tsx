/**
 * ScheduleViewingWidget
 *
 * Chef-facing component for booking kitchen viewings.
 * Features a calendar date picker, time slot selector, and pre-viewing intake form.
 * Built mobile-first with shadcn/ui components.
 */

import { useState, useCallback, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { KitchenNextStepsDescription } from "@/components/common/KitchenNextStepsDescription"
import {
  KeyRound,
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
import { useFirebaseAuth } from "@/hooks/use-auth"
import { useAuthModal } from "@/components/auth/AuthModalProvider"
import { useLocation } from "wouter"
import { chefDashboardHref } from "@/lib/chef-dashboard-nav"
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
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
  name?: string
  email?: string
  intendedUse?: string
  otherIntendedUse?: string
  estimatedWeeklyHours?: string
  hasLicense?: boolean
  targetStartDate?: string
  additionalInfo?: string
}

// ─── Steps ────────────────────────────────────────────────────────────────────

type BookingStep = "date" | "time" | "intake" | "register" | "confirm" | "success"

// ─── Component ────────────────────────────────────────────────────────────────

interface ScheduleViewingWidgetProps {
  locationId: number
  locationName?: string
  targetedKitchenId?: number
  targetedKitchenName?: string
  mode?: "inline" | "modal"
  onClose?: () => void
  onRequireOpen?: () => void
  open?: boolean
}

export function ScheduleViewingWidget({
  locationId,
  locationName,
  targetedKitchenId,
  targetedKitchenName,
  mode,
  onClose,
  onRequireOpen,
  open = true,
}: ScheduleViewingWidgetProps) {
  const queryClient = useQueryClient()
  const { t } = useTranslation("kitchen")
  const { user, refreshUserData } = useFirebaseAuth()
  const { openAuthModal, showAuthForms } = useAuthModal()
  const [, setLocation] = useLocation()
  const isAuthenticated = !!user
  // Check if user is fully authenticated (verified and accepted terms)
  // For users created by admins/managers, they might not need terms, but regular users do
  const isFullyAuthenticated = isAuthenticated && user?.emailVerified && user?.termsAccepted;

  // Step management
  const [step, setStep] = useState<BookingStep>("date")
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined)
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null)
  const [chefNotes, setChefNotes] = useState("")
  const [intakeData, setIntakeData] = useState<IntakeData>({})
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")

  // Auto-save state to sessionStorage on every change for guests
  useEffect(() => {
    if (!isFullyAuthenticated && (selectedDate || selectedSlot || Object.keys(intakeData).length > 0)) {
      sessionStorage.setItem(`viewing_booking_${locationId}`, JSON.stringify({
        date: selectedDate,
        slot: selectedSlot,
        intake: intakeData,
        step: step
      }))
    }
  }, [isFullyAuthenticated, locationId, selectedDate, selectedSlot, intakeData, step])

  // Restore state from sessionStorage
  useEffect(() => {
    // Only restore once on mount if FULLY authenticated
    if (!isFullyAuthenticated) return

    try {
      const savedData = sessionStorage.getItem(`viewing_booking_${locationId}`)
      if (savedData) {
        const parsed = JSON.parse(savedData)
        if (parsed.date) setSelectedDate(new Date(parsed.date))
        if (parsed.slot) setSelectedSlot(parsed.slot)
        if (parsed.intake) setIntakeData(parsed.intake)
        
        if (isFullyAuthenticated) {
          setStep("confirm")
          onRequireOpen?.() // Open modal if we're in hidden state so user can manually submit
          sessionStorage.removeItem(`viewing_booking_${locationId}`)
        } else if (parsed.step) {
          setStep(parsed.step)
        }
      }
    } catch (e) {
      console.error("Failed to restore booking data", e)
    }
  }, [isAuthenticated, isFullyAuthenticated, locationId, onRequireOpen])

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
          throw new Error(t("timeSlotJustTaken", "This time slot was just taken. Please pick another."))
        }
        throw new Error(err.error || t("failedToBookViewing", "Failed to book viewing"))
      }
      return response.json()
    },
    onSuccess: () => {
      setStep("success")
      queryClient.invalidateQueries({ queryKey: ["/api/viewings/chef"] })
      toast.success(t("kitchenTourBookedSuccess", "Kitchen tour booked!"))
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
      { key: "date", label: t("dateLabel", "Date").replace(":", ""), icon: CalendarDays },
      { key: "time", label: t("timeLabel", "Time").replace(":", ""), icon: Clock },
      { key: "intake", label: t("applyFlowTourDetails", "Details").split(" ")[0], icon: ClipboardList },
      { key: "confirm", label: t("reviewAndConfirm", "Confirm").split(" ")[0] || "Confirm", icon: CheckCircle },
    ]

    const currentIndex = steps.findIndex((s) => s.key === step)

    return (
      <div className="flex items-center justify-center w-full max-w-md mx-auto mb-6 sm:mb-8">
        {steps.map((s, i) => {
          const Icon = s.icon
          const isActive = s.key === step
          const isCompleted = i < currentIndex
          
          return (
            <div key={s.key} className="flex items-center">
              <div
                className={cn(
                  "flex items-center justify-center rounded-full transition-all duration-300 ease-in-out",
                  isActive 
                    ? "bg-primary text-primary-foreground px-3 py-1.5 gap-2" 
                    : "bg-muted text-muted-foreground w-8 h-8",
                  isCompleted && "bg-primary/10 text-primary border border-primary/20"
                )}
              >
                <Icon className={cn("h-4 w-4 shrink-0", isActive && "h-3.5 w-3.5")} />
                {isActive && (
                  <span className="text-xs font-medium whitespace-nowrap">
                    {s.label}
                  </span>
                )}
              </div>
              {i < steps.length - 1 && (
                <div className={cn(
                  "w-4 sm:w-8 h-[2px] mx-1 sm:mx-2 rounded-full transition-colors",
                  i < currentIndex ? "bg-primary/40" : "bg-border"
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
        <h3 className="text-base sm:text-lg font-semibold">{t("pickADate", "Pick a date")}</h3>
        <p className="text-xs sm:text-sm text-muted-foreground">
          {t("chooseWhenToVisitLocation", { defaultValue: "Choose when you'd like to visit {locationName}", locationName: locationName || t("theKitchen", "the kitchen") })}
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
            if (!calMetadata) return true;

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
          <h3 className="text-base sm:text-lg font-semibold">{t("chooseATime", "Choose a time")}</h3>
          <p className="text-xs sm:text-sm text-muted-foreground">
            {selectedDate && format(selectedDate, "EEEE, MMMM d, yyyy")}
          </p>
        </div>
      </div>

      {(slotsLoading || slotsFetching) ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">{t("loadingAvailableTimes", "Loading available times...")}</span>
        </div>
      ) : availability?.slots.length === 0 ? (
        <div className="text-center py-12 space-y-3">
          <Clock className="h-10 w-10 mx-auto text-muted-foreground opacity-40" />
          <p className="text-sm text-muted-foreground">
            {t("noAvailableTimeSlots", "No available time slots on this date.")}
          </p>
          <Button variant="outline" size="sm" onClick={() => setStep("date")}>
            <CalendarDays className="h-4 w-4 mr-2" />
            {t("tryAnotherDate", "Try another date")}
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
                {t("toTime", { defaultValue: "to {endTime}", endTime: slot.endTime })}
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
          <h3 className="text-base sm:text-lg font-semibold">{t("tellUsAboutYourNeeds", "Tell us about your needs")}</h3>
          <p className="text-xs sm:text-sm text-muted-foreground">
            {t("helpsManagerPrepareTour", "This helps the kitchen manager prepare for your kitchen tour.")}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Intended Use */}
        <div className="space-y-2">
          <Label className="text-sm">{t("whatWillYouUseKitchenFor", "What will you use the kitchen for?")}</Label>
          <Select
            value={intakeData.intendedUse || ""}
            onValueChange={(v) => setIntakeData({ ...intakeData, intendedUse: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("selectIntendedUse", "Select intended use")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="catering">{t("catering", "Catering")}</SelectItem>
              <SelectItem value="baking_pastry">{t("bakingPastry", "Baking / Pastry")}</SelectItem>
              <SelectItem value="food_production">{t("foodProduction", "Food Production")}</SelectItem>
              <SelectItem value="other">{t("other", "Other")}</SelectItem>
            </SelectContent>
          </Select>
          {intakeData.intendedUse === "other" && (
            <Input
              placeholder={t("pleaseSpecifyIntendedUse", "Please specify intended use")}
              value={intakeData.otherIntendedUse || ""}
              onChange={(e) =>
                setIntakeData({ ...intakeData, otherIntendedUse: e.target.value })
              }
              className="mt-2"
            />
          )}
        </div>

        {/* Estimated Hours */}
        <div className="space-y-2">
          <Label className="text-sm">{t("estimatedWeeklyHoursNeeded", "Estimated weekly hours needed?")}</Label>
          <Select
            value={intakeData.estimatedWeeklyHours || ""}
            onValueChange={(v) =>
              setIntakeData({ ...intakeData, estimatedWeeklyHours: v })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder={t("selectEstimatedHours", "Select estimated hours")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1-5">{t("hours1to5", "1 – 5 hours")}</SelectItem>
              <SelectItem value="5-10">{t("hours5to10", "5 – 10 hours")}</SelectItem>
              <SelectItem value="10-20">{t("hours10to20", "10 – 20 hours")}</SelectItem>
              <SelectItem value="20+">{t("hours20Plus", "20+ hours")}</SelectItem>
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
            {t("haveValidFoodSafetyLicense", "I have a valid food safety license")}
          </Label>
        </div>

        {/* Notes */}
        <div className="space-y-2">
          <Label className="text-sm">
            {t("anythingSpecificToSee", "Anything specific you want to see or discuss? (optional)")}
          </Label>
          <Textarea
            value={chefNotes}
            onChange={(e) => setChefNotes(e.target.value)}
            placeholder={t("egEquipmentNeeds", "e.g., equipment needs, storage requirements...")}
            maxLength={500}
            rows={3}
          />
          <p className="text-xs text-muted-foreground text-right">
            {chefNotes.length}/500
          </p>
        </div>
      </div>

      <Button 
        className="w-full" 
        onClick={() => {
          if (!isFullyAuthenticated) {
            // Fulfill user request to remember dates when they get to login
            sessionStorage.removeItem('pending_application_modal');
            sessionStorage.removeItem(`kitchen_dates_${locationId}_pending_modal`);
            sessionStorage.setItem(`viewing_booking_${locationId}`, JSON.stringify({
              date: selectedDate,
              slot: selectedSlot,
              step: 3,
              intake: intakeData
            }));
            if (mode === "inline" && showAuthForms) {
              showAuthForms();
            } else {
              openAuthModal({ 
                title: t("authModalScheduleTourTitle", "Almost there!"),
                description: <KitchenNextStepsDescription type="tour" />,
                defaultTab: "register" 
              });
            }
            return;
          }
          setStep("confirm")
        }}
        disabled={intakeData.intendedUse === "other" && !intakeData.otherIntendedUse?.trim()}
      >
        {t("reviewAndConfirm", "Review & Confirm")}
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
        <h3 className="text-base sm:text-lg font-semibold">{t("confirmKitchenTour", "Confirm your kitchen tour")}</h3>
      </div>

      <Card className="border-primary/20">
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-start gap-3">
            <Building2 className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium">{locationName || t("applyFlowKitchenFallbackName", "Kitchen")}</p>
              {targetedKitchenName && (
                <p className="text-xs text-muted-foreground">
                  {t("interestedIn", { defaultValue: "Interested in: {name}", name: targetedKitchenName })}
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
                  <p className="font-medium capitalize">
                    {intakeData.intendedUse === "other"
                      ? intakeData.otherIntendedUse || t("other", "Other")
                      : intakeData.intendedUse === "baking_pastry"
                      ? t("bakingPastry", "Baking / Pastry")
                      : intakeData.intendedUse === "catering"
                      ? t("catering", "Catering")
                      : intakeData.intendedUse === "food_production"
                      ? t("foodProduction", "Food Production")
                      : intakeData.intendedUse?.replace(/_/g, " ")}
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
            {t("bookingStatus", "Booking...")}
          </>
        ) : (
          <>
            <Send className="h-4 w-4 mr-2" />
            {t("bookKitchenTour", "Book Kitchen Tour")}
          </>
        )}
      </Button>

      <p className="text-xs text-center text-muted-foreground">
        {t("receiveConfirmationNotification", "You'll receive a confirmation notification and email.")}
      </p>
    </div>
  )

  const renderSuccessStep = () => (
    <div className="text-center space-y-4 py-4 sm:py-8">
      <div className="mx-auto w-14 h-14 sm:w-16 sm:h-16 rounded-full border flex items-center justify-center">
        <CheckCircle className="h-7 w-7 sm:h-8 sm:w-8 text-success" />
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-center gap-2">
          <h3 className="text-lg sm:text-xl font-semibold">
            {t("kitchenTourRequested", "Kitchen Tour Requested")}
          </h3>
          <Badge variant="success">{t("confirmed", "Confirmed")}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("kitchenTourRequestedAwaitingApproval", { defaultValue: "Your kitchen tour at {locationName} has been requested and is awaiting manager approval.", locationName: locationName || t("theKitchen", "the kitchen") })}
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          {t("kitchenTourWhereToCheck", "You can view your scheduled tours in the Kitchen Tours tab under Discover Kitchens.")}
        </p>
      </div>

      <Card className="bg-muted/50">
        <CardContent className="pt-4 text-sm space-y-1.5">
          <p>
            <span className="text-muted-foreground">{t("dateLabel", "Date:")}</span>{" "}
            <span className="font-medium">
              {selectedDate && format(selectedDate, "EEEE, MMMM d, yyyy")}
            </span>
          </p>
          <p>
            <span className="text-muted-foreground">{t("timeLabel", "Time:")}</span>{" "}
            <span className="font-medium">
              {selectedSlot?.startTime} — {selectedSlot?.endTime}
            </span>
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-col sm:flex-row gap-2 pt-2">
        <Button variant="outline" className="flex-1" onClick={resetForm}>
          {t("bookAnother", "Book Another")}
        </Button>
        <Button 
          className="flex-1" 
          onClick={() => {
            if (onClose) onClose();
            setLocation(chefDashboardHref("viewings"));
          }}
        >
          {t("viewMyTours", "View My Tours")}
        </Button>
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
      <Dialog open={open} onOpenChange={(o) => !o && onClose?.()}>
        <DialogContent className="w-full sm:max-w-lg overflow-y-auto max-h-[90vh] p-4 sm:p-6">
          <DialogHeader className="mb-6">
            <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
              <MapPin className="h-5 w-5 text-primary" />
              {t("scheduleKitchenTour", "Schedule a Kitchen Tour")}
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              {t("bookInPersonKitchenTour", { defaultValue: "Book an in-person kitchen tour of {locationName}", locationName: locationName || t("theKitchenFacility", "the kitchen facility") })}
            </DialogDescription>
          </DialogHeader>
          {content}
        </DialogContent>
      </Dialog>
    )
  }

  // Inline mode
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
          <MapPin className="h-5 w-5 text-primary" />
          {t("scheduleKitchenTour", "Schedule a Kitchen Tour")}
        </CardTitle>
        <CardDescription className="text-xs sm:text-sm">
          {t("bookInPersonKitchenTour", { defaultValue: "Book an in-person kitchen tour of {locationName}", locationName: locationName || t("theKitchenFacility", "the kitchen facility") })}
        </CardDescription>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  )
}

export default ScheduleViewingWidget
