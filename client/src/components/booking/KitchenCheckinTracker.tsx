/**
 * KitchenCheckinTracker
 *
 * Notion-style vertical step tracker showing kitchen check-in/checkout
 * progress to chefs. Renders as a Sheet (side panel).
 *
 * Steps:
 * 1. Check In — chef arrives at kitchen
 * 2. Cooking / In-Progress — chef is using the kitchen
 * 3. Check Out — chef submits photos and requests checkout
 * 4. Outcome — cleared or claim filed
 */

import { useState, useCallback } from "react"
import {
  Camera,
  CheckCircle,
  Clock,
  Loader2,
  ShieldCheck,
  AlertTriangle,
  FileWarning,
  LogIn,
  LogOut,
  ChefHat,
  XCircle,
  Lock,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { format } from "date-fns"
import { toast } from "sonner"
import { useKitchenCheckin, type KitchenCheckinStatus } from "@/hooks/use-kitchen-checkin"
import { useLocationChecklist, type ChecklistItem, type PhotoRequirement } from "@/hooks/use-location-checklist"
import { Checkbox } from "@/components/ui/checkbox"
import {
  PhotoRequirementUploader,
  flattenPhotos,
  areAllRequiredPhotosUploaded,
} from "./PhotoRequirementUploader"

// ─── Types ────────────────────────────────────────────────────────────────────

type StepState = "completed" | "active" | "upcoming" | "error"

interface Step {
  label: string
  description: string
  state: StepState
  timestamp?: string | null
  icon: React.ReactNode
  detail?: React.ReactNode
}

interface KitchenCheckinTrackerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bookingId: number
  kitchenName?: string
  bookingDate?: string
  startTime?: string
  endTime?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return ""
  try {
    return format(new Date(ts), "MMM d, yyyy 'at' h:mm a")
  } catch {
    return ""
  }
}

// ─── Step Icon ────────────────────────────────────────────────────────────────

function StepIcon({ state }: { state: StepState }) {
  const base =
    "flex h-8 w-8 items-center justify-center rounded-full border-2 flex-shrink-0"

  if (state === "completed") {
    return (
      <div className={cn(base, "border-green-500 bg-green-50 text-green-600")}>
        <CheckCircle className="h-4 w-4" />
      </div>
    )
  }
  if (state === "active") {
    return (
      <div
        className={cn(
          base,
          "border-blue-500 bg-blue-50 text-blue-600 ring-4 ring-blue-100"
        )}
      >
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    )
  }
  if (state === "error") {
    return (
      <div className={cn(base, "border-red-500 bg-red-50 text-red-600")}>
        <AlertTriangle className="h-4 w-4" />
      </div>
    )
  }
  return (
    <div
      className={cn(
        base,
        "border-muted-foreground/30 bg-muted/50 text-muted-foreground"
      )}
    >
      <Clock className="h-3.5 w-3.5" />
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function KitchenCheckinTracker({
  open,
  onOpenChange,
  bookingId,
  kitchenName,
  bookingDate,
  startTime,
  endTime,
}: KitchenCheckinTrackerProps) {
  const {
    status: data,
    isLoading,
    canCheckin,
    canCheckout,
    checkin,
    isCheckingIn,
    checkout,
    isCheckingOut,
  } = useKitchenCheckin(open ? bookingId : null)

  // Fetch manager-defined checklist for this location
  const { data: checklist } = useLocationChecklist(data?.locationId)

  const [checkinNotes, setCheckinNotes] = useState("")
  const [checkoutNotes, setCheckoutNotes] = useState("")
  const [showCheckinForm, setShowCheckinForm] = useState(false)
  const [showCheckoutForm, setShowCheckoutForm] = useState(false)
  // Photos keyed by requirement id (or __generic__ when no requirements defined)
  const [checkinPhotos, setCheckinPhotos] = useState<Record<string, string[]>>({})
  const [checkoutPhotos, setCheckoutPhotos] = useState<Record<string, string[]>>({})
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set())

  const checkinStatus: KitchenCheckinStatus =
    (data?.checkinStatus as KitchenCheckinStatus) || "not_checked_in"

  const steps = buildSteps(checkinStatus, data)

  // All checklist items are required by design — chefs must check every one.
  const allCheckinItemsChecked = (checklist?.checkinItems || []).every(
    (i: ChecklistItem) => checkedItems.has(i.id),
  )
  const allCheckoutItemsChecked = (checklist?.checkoutItems || []).every(
    (i: ChecklistItem) => checkedItems.has(i.id),
  )

  const checkinPhotoReqs: PhotoRequirement[] = checklist?.checkinPhotoRequirements || []
  const checkoutPhotoReqs: PhotoRequirement[] = checklist?.checkoutPhotoRequirements || []

  const allCheckinPhotosUploaded = areAllRequiredPhotosUploaded(checkinPhotoReqs, checkinPhotos)
  const allCheckoutPhotosUploaded = areAllRequiredPhotosUploaded(checkoutPhotoReqs, checkoutPhotos)

  const handleCheckin = async () => {
    if (!allCheckinPhotosUploaded) {
      toast.error(
        checkinPhotoReqs.length > 0
          ? "Please upload a photo for each required item before checking in"
          : "Please upload at least one photo of the kitchen condition",
      )
      return
    }
    if (!allCheckinItemsChecked) {
      toast.error("Please complete all checklist items before checking in")
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
      })
      toast.success("Checked in successfully!")
      setCheckinNotes("")
      setCheckinPhotos({})
      setCheckedItems(new Set())
      setShowCheckinForm(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to check in")
    }
  }

  const handleCheckout = async () => {
    if (!allCheckoutPhotosUploaded) {
      toast.error(
        checkoutPhotoReqs.length > 0
          ? "Please upload a photo for each required item before requesting checkout"
          : "Please upload at least one photo of the kitchen condition",
      )
      return
    }
    if (!allCheckoutItemsChecked) {
      toast.error("Please complete all checklist items before requesting checkout")
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
      toast.success("Checkout requested! Manager will review shortly.")
      setCheckoutNotes("")
      setCheckoutPhotos({})
      setCheckedItems(new Set())
      setShowCheckoutForm(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to request checkout")
    }
  }

  const timeLabel =
    bookingDate && startTime && endTime
      ? `${bookingDate} · ${startTime} – ${endTime}`
      : undefined

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ChefHat className="h-5 w-5 text-orange-600" />
            Kitchen Check-In
          </SheetTitle>
          <SheetDescription>
            {kitchenName || "Kitchen"} {timeLabel && `— ${timeLabel}`}
          </SheetDescription>
        </SheetHeader>

        <div className="py-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* No-Show Banner */}
              {checkinStatus === "no_show" && (
                <div className="rounded-lg border bg-red-50 border-red-200 p-4 mb-6">
                  <div className="flex items-center gap-2">
                    <XCircle className="h-5 w-5 text-red-600" />
                    <div>
                      <p className="text-sm font-medium text-red-800">
                        No-Show Detected
                      </p>
                      <p className="text-xs text-red-600 mt-0.5">
                        You did not check in within the grace period. Contact
                        the kitchen manager if this is an error.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Step Timeline */}
              <div className="relative">
                {steps.map((step, index) => (
                  <div key={index} className="flex gap-4 pb-8 last:pb-0">
                    <div className="flex flex-col items-center">
                      <StepIcon state={step.state} />
                      {index < steps.length - 1 && (
                        <div
                          className={cn(
                            "w-0.5 flex-1 mt-2",
                            step.state === "completed"
                              ? "bg-green-300"
                              : step.state === "active"
                                ? "bg-blue-200"
                                : "bg-muted-foreground/20"
                          )}
                        />
                      )}
                    </div>

                    <div className="flex-1 pt-0.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={cn(
                            "text-sm font-medium",
                            step.state === "upcoming" &&
                              "text-muted-foreground",
                            step.state === "error" && "text-red-700"
                          )}
                        >
                          {step.label}
                        </span>
                        {step.state === "active" && (
                          <Badge
                            variant="info"
                            className="text-xs font-normal"
                          >
                            In Progress
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {step.description}
                      </p>
                      {step.timestamp && (
                        <p className="text-xs text-muted-foreground/70 mt-1">
                          {formatTimestamp(step.timestamp)}
                        </p>
                      )}
                      {step.detail && (
                        <div className="mt-2">{step.detail}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <Separator className="my-6" />

              {/* Confirmed Checklist Audit (shown after check-in / checkout) */}
              {data?.checkinChecklistItems && Array.isArray(data.checkinChecklistItems) && data.checkinChecklistItems.length > 0 && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3 mb-4">
                  <p className="text-xs text-green-800 font-medium mb-2">Your Check-In Checklist</p>
                  <div className="space-y-1">
                    {data.checkinChecklistItems.map((item: { id: string; label: string; checked: boolean }, index: number) => (
                      <div key={item.id} className="flex items-center gap-2">
                        <Checkbox checked={item.checked} disabled className="pointer-events-none" />
                        <span className="tabular-nums text-xs font-medium text-muted-foreground">{index + 1}.</span>
                        <span className={cn("text-xs", item.checked ? "text-green-700" : "text-red-600 line-through")}>
                          {item.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {data?.checkoutChecklistItems && Array.isArray(data.checkoutChecklistItems) && data.checkoutChecklistItems.length > 0 && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 mb-4">
                  <p className="text-xs text-blue-800 font-medium mb-2">Your Check-Out Checklist</p>
                  <div className="space-y-1">
                    {data.checkoutChecklistItems.map((item: { id: string; label: string; checked: boolean }, index: number) => (
                      <div key={item.id} className="flex items-center gap-2">
                        <Checkbox checked={item.checked} disabled className="pointer-events-none" />
                        <span className="tabular-nums text-xs font-medium text-muted-foreground">{index + 1}.</span>
                        <span className={cn("text-xs", item.checked ? "text-blue-700" : "text-red-600 line-through")}>
                          {item.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Check-In Action */}
              {canCheckin && !showCheckinForm && (
                <Button
                  className="w-full"
                  size="lg"
                  onClick={() => setShowCheckinForm(true)}
                >
                  <LogIn className="h-4 w-4 mr-2" />
                  Check In Now
                </Button>
              )}

              {canCheckin && showCheckinForm && (
                <div className="space-y-3">
                  {/* Manager Instructions */}
                  {checklist?.checkinInstructions && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                      <p className="text-xs text-blue-800 font-medium mb-1">Instructions from Manager</p>
                      <p className="text-xs text-blue-700 whitespace-pre-line">{checklist.checkinInstructions}</p>
                    </div>
                  )}

                  {/* Smart Lock Instructions + Access Code */}
                  {data?.smartLockEnabled && (() => {
                    const slConfig = data?.smartLockConfig;
                    const accessCode = slConfig?.accessCode as string | undefined;
                    const visibility = (slConfig?.codeVisibility as string) || 'at_checkin';
                    const showCode = accessCode && (
                      visibility === 'on_booking' ||
                      (visibility === 'at_checkin' && canCheckin)
                    );
                    return (accessCode || checklist?.smartLockCheckinInstructions) ? (
                      <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 space-y-2">
                        <div className="flex items-center gap-1.5">
                          <Lock className="size-3.5 text-violet-600" />
                          <p className="text-xs text-violet-800 font-medium">Smart Lock Access</p>
                        </div>
                        {checklist?.smartLockCheckinInstructions && (
                          <p className="text-xs text-violet-700 whitespace-pre-line">{checklist.smartLockCheckinInstructions}</p>
                        )}
                        {showCode ? (
                          <div className="flex items-center gap-2 p-2 rounded-md bg-violet-100 border border-violet-300">
                            <span className="text-lg font-mono font-bold text-violet-900 tracking-[0.2em]">{accessCode}</span>
                          </div>
                        ) : accessCode && visibility === 'at_checkin' && !canCheckin ? (
                          <p className="text-[11px] text-violet-600 italic">Access code will be shown when check-in window opens</p>
                        ) : accessCode && visibility === 'manual' ? (
                          <p className="text-[11px] text-violet-600 italic">Contact your kitchen manager for the access code</p>
                        ) : null}
                      </div>
                    ) : null;
                  })()}

                  {/* Checklist Items */}
                  {(checklist?.checkinItems || []).length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Checklist</Label>
                      {(checklist?.checkinItems || []).map((item: ChecklistItem, index: number) => (
                        <label key={item.id} className="flex items-start gap-2.5 p-2 rounded-lg border bg-background hover:bg-muted/50 cursor-pointer transition-colors">
                          <Checkbox
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
                              {item.required && <span className="text-destructive ml-0.5">*</span>}
                            </span>
                            {item.description && (
                              <p className="text-[11px] text-muted-foreground mt-0.5">{item.description}</p>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  )}

                  {/* Per-requirement photo uploader */}
                  <PhotoRequirementUploader
                    requirements={checkinPhotoReqs}
                    photos={checkinPhotos}
                    onPhotosChange={setCheckinPhotos}
                    uploadFolder="kitchen-checkin"
                    genericInstruction="Take photos of the kitchen before you start. This protects you from pre-existing damage claims."
                    disabled={isCheckingIn}
                  />

                  <Textarea
                    placeholder="Optional check-in notes..."
                    value={checkinNotes}
                    onChange={(e) => setCheckinNotes(e.target.value)}
                    rows={2}
                  />
                  <div className="flex gap-2">
                    <Button
                      className="flex-1"
                      onClick={handleCheckin}
                      disabled={
                        isCheckingIn ||
                        !allCheckinPhotosUploaded ||
                        !allCheckinItemsChecked
                      }
                    >
                      {isCheckingIn ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <LogIn className="h-4 w-4 mr-2" />
                      )}
                      Confirm Check-In
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowCheckinForm(false)
                        setCheckinNotes("")
                        setCheckinPhotos({})
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {/* Check-Out Action */}
              {canCheckout && !showCheckoutForm && (
                <Button
                  className="w-full"
                  variant="outline"
                  size="lg"
                  onClick={() => setShowCheckoutForm(true)}
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Request Checkout
                </Button>
              )}

              {canCheckout && showCheckoutForm && (
                <div className="space-y-3">
                  {/* Manager Checkout Instructions */}
                  {checklist?.checkoutInstructions && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                      <p className="text-xs text-blue-800 font-medium mb-1">Instructions from Manager</p>
                      <p className="text-xs text-blue-700 whitespace-pre-line">{checklist.checkoutInstructions}</p>
                    </div>
                  )}

                  {/* Checkout Checklist Items */}
                  {(checklist?.checkoutItems || []).length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Checkout Checklist</Label>
                      {(checklist?.checkoutItems || []).map((item: ChecklistItem, index: number) => (
                        <label key={item.id} className="flex items-start gap-2.5 p-2 rounded-lg border bg-background hover:bg-muted/50 cursor-pointer transition-colors">
                          <Checkbox
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
                              {item.required && <span className="text-destructive ml-0.5">*</span>}
                            </span>
                            {item.description && (
                              <p className="text-[11px] text-muted-foreground mt-0.5">{item.description}</p>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  )}

                  {/* Per-requirement photo uploader */}
                  <PhotoRequirementUploader
                    requirements={checkoutPhotoReqs}
                    photos={checkoutPhotos}
                    onPhotosChange={setCheckoutPhotos}
                    uploadFolder="kitchen-checkout"
                    genericInstruction="Upload photos showing the kitchen is clean and in good condition. This speeds up manager approval."
                    disabled={isCheckingOut}
                  />

                  <Textarea
                    placeholder="Checkout notes (e.g., kitchen condition)..."
                    value={checkoutNotes}
                    onChange={(e) => setCheckoutNotes(e.target.value)}
                    rows={2}
                  />

                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <Clock className="h-4 w-4 text-blue-600 mt-0.5" />
                      <div className="text-xs text-blue-700">
                        <strong>What happens next?</strong>
                        <ul className="mt-1 space-y-0.5 list-disc list-inside">
                          <li>Manager will review your photos and inspect the kitchen</li>
                          <li>If clear, your session is completed</li>
                          <li>Auto-clears if no issues within the review window</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      className="flex-1"
                      onClick={handleCheckout}
                      disabled={
                        isCheckingOut ||
                        !allCheckoutPhotosUploaded ||
                        !allCheckoutItemsChecked
                      }
                    >
                      {isCheckingOut ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <LogOut className="h-4 w-4 mr-2" />
                      )}
                      Submit Checkout
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowCheckoutForm(false)
                        setCheckoutNotes("")
                        setCheckoutPhotos({})
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ─── Step Builder ─────────────────────────────────────────────────────────────

function buildSteps(
  checkinStatus: KitchenCheckinStatus,
  data:
    | {
        checkedInAt?: string | null
        checkoutRequestedAt?: string | null
        checkedOutAt?: string | null
        checkoutApprovedAt?: string | null
        noShowDetectedAt?: string | null
      }
    | undefined
): Step[] {
  const steps: Step[] = []

  // Step 1: Check In
  const isCheckedIn =
    checkinStatus === "checked_in" ||
    checkinStatus === "checkout_requested" ||
    checkinStatus === "checked_out" ||
    checkinStatus === "checkout_claim_filed"

  const isNoShow = checkinStatus === "no_show"

  steps.push({
    label: "Check In",
    description: isCheckedIn
      ? "You checked in to the kitchen"
      : isNoShow
        ? "You did not check in — marked as no-show"
        : "Arrive at the kitchen and check in",
    state: isCheckedIn ? "completed" : isNoShow ? "error" : "upcoming",
    timestamp: data?.checkedInAt,
    icon: <LogIn className="h-4 w-4" />,
  })

  if (isNoShow) {
    // No-show: skip remaining steps
    steps.push({
      label: "No-Show",
      description:
        "Booking was marked as no-show. Contact kitchen manager for assistance.",
      state: "error",
      timestamp: data?.noShowDetectedAt,
      icon: <XCircle className="h-4 w-4" />,
    })
    return steps
  }

  // Step 2: Cooking / In-Progress
  const isCooking = checkinStatus === "checked_in"
  const cookingDone =
    checkinStatus === "checkout_requested" ||
    checkinStatus === "checked_out" ||
    checkinStatus === "checkout_claim_filed"

  steps.push({
    label: "In Progress",
    description: isCooking
      ? "You're using the kitchen — check out when done"
      : cookingDone
        ? "Kitchen session completed"
        : "Use the kitchen during your booked time",
    state: isCooking ? "active" : cookingDone ? "completed" : "upcoming",
    icon: <ChefHat className="h-4 w-4" />,
  })

  // Step 3: Checkout Requested
  const isCheckoutRequested = checkinStatus === "checkout_requested"
  const checkoutDone =
    checkinStatus === "checked_out" ||
    checkinStatus === "checkout_claim_filed"

  steps.push({
    label: "Checkout Requested",
    description: isCheckoutRequested
      ? "Waiting for manager to review and clear"
      : checkoutDone
        ? "Manager reviewed your checkout"
        : "Submit photos and request checkout when leaving",
    state: isCheckoutRequested
      ? "active"
      : checkoutDone
        ? "completed"
        : "upcoming",
    timestamp: data?.checkoutRequestedAt,
    icon: <Camera className="h-4 w-4" />,
  })

  // Step 4: Outcome
  if (checkinStatus === "checked_out") {
    steps.push({
      label: "Cleared",
      description: "No issues found — your session is complete",
      state: "completed",
      timestamp: data?.checkoutApprovedAt,
      icon: <ShieldCheck className="h-4 w-4" />,
    })
  } else if (checkinStatus === "checkout_claim_filed") {
    steps.push({
      label: "Claim Filed",
      description:
        "The manager filed a damage/cleaning claim. Check your dashboard.",
      state: "error",
      timestamp: data?.checkoutApprovedAt,
      icon: <FileWarning className="h-4 w-4" />,
      detail: (
        <Badge variant="warning" className="text-xs font-normal mt-1">
          <FileWarning className="h-3 w-3 mr-1" />
          Check Damage Claims in your dashboard
        </Badge>
      ),
    })
  } else {
    steps.push({
      label: "Outcome",
      description: "Cleared if no issues, or a claim may be filed",
      state: "upcoming",
      icon: <ShieldCheck className="h-4 w-4" />,
    })
  }

  return steps
}
