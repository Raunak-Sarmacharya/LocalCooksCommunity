/**
 * CheckinStatusTracker
 *
 * Notion-style vertical step tracker showing storage check-in (move-in inspection)
 * progress to chefs. Symmetric with `CheckoutStatusTracker`.
 *
 * Steps:
 * 1. Check-In Completed — chef submitted photos & checklist
 * 2. Recorded — move-in baseline is established
 * 3. Approved / Skipped — final outcome
 */

import { useQuery } from "@tanstack/react-query";
import {
  Camera,
  CheckCircle,
  Clock,
  Loader2,
  ShieldCheck,
  AlertTriangle,
  LogIn,
} from "lucide-react";
import { auth } from "@/lib/firebase";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CheckinStatusData {
  storageBookingId: number;
  checkinStatus: string | null;
  checkinRequestedAt: string | null;
  checkinCompletedAt: string | null;
  checkinPhotoUrls: string[];
  checkinNotes: string | null;
  checkinChecklistItems: Array<{ id: string; label: string; checked: boolean }> | null;
}

type StepState = "completed" | "active" | "upcoming" | "error";

interface Step {
  label: string;
  description: string;
  state: StepState;
  timestamp?: string | null;
  icon: React.ReactNode;
  detail?: React.ReactNode;
}

interface CheckinStatusTrackerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storageBookingId: number;
  storageName?: string;
  checkinStatus?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getAuthHeaders(): Promise<HeadersInit> {
  const currentUser = auth.currentUser;
  if (currentUser) {
    const token = await currentUser.getIdToken();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  }
  return { "Content-Type": "application/json" };
}

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return "";
  try {
    return format(new Date(ts), "MMM d, yyyy 'at' h:mm a");
  } catch {
    return "";
  }
}

// ─── Step Icon ────────────────────────────────────────────────────────────────

function StepIcon({ state }: { state: StepState }) {
  const base = "flex h-8 w-8 items-center justify-center rounded-full border-2 flex-shrink-0";

  if (state === "completed") {
    return (
      <div className={cn(base, "border-green-500 bg-green-50 text-green-600")}>
        <CheckCircle className="h-4 w-4" />
      </div>
    );
  }
  if (state === "active") {
    return (
      <div className={cn(base, "border-blue-500 bg-blue-50 text-blue-600 ring-4 ring-blue-100")}>
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className={cn(base, "border-amber-500 bg-amber-50 text-amber-600")}>
        <AlertTriangle className="h-4 w-4" />
      </div>
    );
  }
  return (
    <div className={cn(base, "border-muted-foreground/30 bg-muted/50 text-muted-foreground")}>
      <Clock className="h-3.5 w-3.5" />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function CheckinStatusTracker({
  open,
  onOpenChange,
  storageBookingId,
  storageName,
  checkinStatus: propCheckinStatus,
}: CheckinStatusTrackerProps) {
  const { data, isLoading } = useQuery<CheckinStatusData>({
    queryKey: ["/api/chef/storage-bookings", storageBookingId, "checkin-status"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `/api/chef/storage-bookings/${storageBookingId}/checkin-status`,
        { headers, credentials: "include" }
      );
      if (!response.ok) throw new Error("Failed to fetch check-in status");
      return response.json();
    },
    enabled: open && !!storageBookingId,
    refetchInterval: open ? 30_000 : false,
  });

  const status = data?.checkinStatus || propCheckinStatus || "not_checked_in";
  const steps: Step[] = buildSteps(status, data);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <LogIn className="h-5 w-5 text-emerald-600" />
            Check-In Status
          </SheetTitle>
          <SheetDescription>
            {storageName || "Storage Unit"} — Move-In Inspection Progress
          </SheetDescription>
        </SheetHeader>

        <div className="py-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="relative">
              {steps.map((step, index) => (
                <div key={index} className="flex gap-4 pb-8 last:pb-0">
                  {/* Timeline line + icon */}
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

                  {/* Step content */}
                  <div className="flex-1 pt-0.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={cn(
                          "text-sm font-medium",
                          step.state === "upcoming" && "text-muted-foreground",
                          step.state === "error" && "text-amber-700"
                        )}
                      >
                        {step.label}
                      </span>
                      {step.state === "active" && (
                        <Badge variant="info" className="text-xs font-normal">
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
                    {step.detail && <div className="mt-2">{step.detail}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Photo count summary */}
          {data && data.checkinPhotoUrls && data.checkinPhotoUrls.length > 0 && (
            <>
              <Separator className="my-4" />
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Camera className="h-4 w-4" />
                <span>
                  {data.checkinPhotoUrls.length} photo{data.checkinPhotoUrls.length !== 1 ? "s" : ""} submitted
                </span>
              </div>
            </>
          )}

          {/* Checklist summary */}
          {data && data.checkinChecklistItems && data.checkinChecklistItems.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <CheckCircle className="h-4 w-4" />
                <span>
                  {data.checkinChecklistItems.filter(i => i.checked).length}/{data.checkinChecklistItems.length} checklist items completed
                </span>
              </div>
              <div className="space-y-1">
                {data.checkinChecklistItems.map((item, index) => (
                  <div key={item.id} className="flex items-center gap-2 text-xs">
                    <div className={cn(
                      "h-3.5 w-3.5 rounded-sm border flex items-center justify-center flex-shrink-0",
                      item.checked
                        ? "bg-green-100 border-green-300 text-green-600"
                        : "bg-muted border-muted-foreground/30 text-muted-foreground"
                    )}>
                      {item.checked && <CheckCircle className="h-2.5 w-2.5" />}
                    </div>
                    <span className="tabular-nums font-medium text-muted-foreground">{index + 1}.</span>
                    <span className={cn(!item.checked && "text-muted-foreground line-through")}>
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {data && data.checkinNotes && (
            <div className="mt-3">
              <Separator className="my-4" />
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">Notes:</span>{" "}
                {data.checkinNotes}
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Step Builder ─────────────────────────────────────────────────────────────

function buildSteps(
  status: string,
  data: CheckinStatusData | undefined
): Step[] {
  const steps: Step[] = [];

  // Step 1: Check-In Completed
  const isCompleted =
    status === "checkin_requested" ||
    status === "checkin_completed" ||
    status === "skipped";

  steps.push({
    label: "Check-In Completed",
    description: isCompleted
      ? "You submitted your move-in inspection photos and checklist"
      : "Submit photos and checklist documenting the storage unit condition",
    state: isCompleted ? "completed" : "upcoming",
    timestamp: data?.checkinCompletedAt || data?.checkinRequestedAt,
    icon: <Camera className="h-4 w-4" />,
  });

  // Step 2: Baseline Recorded
  const isUnderReview = status === "checkin_requested";
  const reviewDone = status === "checkin_completed" || status === "skipped";

  steps.push({
    label: "Baseline Recorded",
    description: isUnderReview
      ? "Move-in inspection is submitted and awaiting finalisation"
      : reviewDone
        ? "Your move-in baseline is recorded and protects you from unfair damage claims"
        : "Submit your move-in inspection to establish the baseline condition",
    state: isUnderReview ? "active" : reviewDone ? "completed" : "upcoming",
    icon: <ShieldCheck className="h-4 w-4" />,
  });

  // Step 3: Outcome
  if (status === "checkin_completed") {
    steps.push({
      label: "Check-In Approved",
      description: "Your move-in baseline is recorded — this protects you from unfair damage claims at checkout",
      state: "completed",
      timestamp: data?.checkinCompletedAt,
      icon: <CheckCircle className="h-4 w-4" />,
      detail: data?.checkinNotes ? (
        <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2 mt-1">
          {data.checkinNotes}
        </p>
      ) : null,
    });
  } else if (status === "skipped") {
    steps.push({
      label: "Check-In Skipped",
      description: "The move-in inspection step was skipped",
      state: "completed",
      timestamp: data?.checkinCompletedAt,
      icon: <CheckCircle className="h-4 w-4" />,
    });
  } else if (status === "not_checked_in") {
    steps.push({
      label: "Awaiting Inspection",
      description: "Submit your move-in inspection to establish the baseline condition",
      state: "upcoming",
      icon: <LogIn className="h-4 w-4" />,
    });
  } else {
    // checkin_requested — legacy status, still awaiting manager review
    steps.push({
      label: "Awaiting Review",
      description: "Your move-in inspection is awaiting final confirmation",
      state: "active",
      icon: <Clock className="h-4 w-4" />,
    });
  }

  return steps;
}
