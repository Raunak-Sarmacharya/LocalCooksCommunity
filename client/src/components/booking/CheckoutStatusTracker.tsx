/**
 * CheckoutStatusTracker
 * 
 * Notion-style vertical step tracker showing checkout progress to chefs.
 * Renders as a Sheet (side panel) with a clean timeline visualization.
 * 
 * Steps:
 * 1. Checkout Requested — chef submitted photos
 * 2. Under Review — kitchen is reviewing the storage unit
 * 3. Cleared / Claim Filed — final outcome
 */

import { useQuery } from "@tanstack/react-query";
import {
  Camera,
  CheckCircle,
  Clock,
  Loader2,
  ShieldCheck,
  AlertTriangle,
  FileWarning,
  Timer,
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
import { formatDistanceToNow, format, isPast } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CheckoutStatusData {
  storageBookingId: number;
  checkoutStatus: string | null;
  checkoutRequestedAt: string | null;
  checkoutApprovedAt: string | null;
  checkoutNotes: string | null;
  checkoutPhotoUrls: string[];
  reviewDeadline: string | null;
  isReviewExpired: boolean;
  extendedClaimDeadline: string | null;
  canFileExtendedClaim: boolean;
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

interface CheckoutStatusTrackerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storageBookingId: number;
  storageName?: string;
  checkoutStatus?: string;
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

// ─── Step Icon (timeline node) ────────────────────────────────────────────────

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
  // upcoming
  return (
    <div className={cn(base, "border-muted-foreground/30 bg-muted/50 text-muted-foreground")}>
      <Clock className="h-3.5 w-3.5" />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function CheckoutStatusTracker({
  open,
  onOpenChange,
  storageBookingId,
  storageName,
  checkoutStatus: propCheckoutStatus,
}: CheckoutStatusTrackerProps) {
  const { data, isLoading } = useQuery<CheckoutStatusData>({
    queryKey: ["/api/chef/storage-bookings", storageBookingId, "checkout-status"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `/api/chef/storage-bookings/${storageBookingId}/checkout-status`,
        { headers, credentials: "include" }
      );
      if (!response.ok) throw new Error("Failed to fetch checkout status");
      return response.json();
    },
    enabled: open && !!storageBookingId,
    refetchInterval: open ? 30_000 : false,
  });

  // Build steps from status data
  const status = data?.checkoutStatus || propCheckoutStatus || "active";

  const steps: Step[] = buildSteps(status, data);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-green-600" />
            Checkout Status
          </SheetTitle>
          <SheetDescription>
            {storageName || "Storage Unit"} — Checkout Progress
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
                    {step.detail && <div className="mt-2">{step.detail}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Photo count summary */}
          {data && data.checkoutPhotoUrls && data.checkoutPhotoUrls.length > 0 && (
            <>
              <Separator className="my-4" />
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Camera className="h-4 w-4" />
                <span>
                  {data.checkoutPhotoUrls.length} photo{data.checkoutPhotoUrls.length !== 1 ? "s" : ""} submitted
                </span>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Step Builder ─────────────────────────────────────────────────────────────

function buildSteps(
  status: string,
  data: CheckoutStatusData | undefined
): Step[] {
  const steps: Step[] = [];

  // Step 1: Checkout Requested
  const isRequested =
    status === "checkout_requested" ||
    status === "checkout_approved" ||
    status === "completed" ||
    status === "checkout_claim_filed";

  steps.push({
    label: "Checkout Requested",
    description: isRequested
      ? "You submitted photos and requested checkout"
      : "Submit photos of the empty storage unit",
    state: isRequested ? "completed" : "upcoming",
    timestamp: data?.checkoutRequestedAt,
    icon: <Camera className="h-4 w-4" />,
  });

  // Step 2: Under Review
  const isUnderReview = status === "checkout_requested";
  const reviewDone =
    status === "completed" ||
    status === "checkout_approved" ||
    status === "checkout_claim_filed";

  let reviewDetail: React.ReactNode = null;
  if (isUnderReview && data?.reviewDeadline) {
    const deadlineDate = new Date(data.reviewDeadline);
    const expired = data.isReviewExpired || isPast(deadlineDate);
    reviewDetail = (
      <Badge
        variant="outline"
        className={cn(
          "text-xs font-normal",
          expired
            ? "bg-amber-50 text-amber-700 border-amber-200"
            : "bg-blue-50 text-blue-700 border-blue-200"
        )}
      >
        <Timer className="h-3 w-3 mr-1" />
        {expired
          ? "Auto-clearing soon — no issues reported"
          : `${formatDistanceToNow(deadlineDate, { addSuffix: false })} remaining`}
      </Badge>
    );
  }

  steps.push({
    label: "Under Review",
    description: isUnderReview
      ? "The kitchen is reviewing the storage unit"
      : reviewDone
        ? "Kitchen reviewed the storage unit"
        : "Kitchen will review your photos and inspect the unit",
    state: isUnderReview ? "active" : reviewDone ? "completed" : "upcoming",
    icon: <Clock className="h-4 w-4" />,
    detail: reviewDetail,
  });

  // Step 3: Outcome
  if (status === "completed") {
    steps.push({
      label: "Storage Cleared",
      description: "No issues found — your checkout is complete",
      state: "completed",
      timestamp: data?.checkoutApprovedAt,
      icon: <ShieldCheck className="h-4 w-4" />,
      detail: data?.checkoutNotes ? (
        <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2 mt-1">
          {data.checkoutNotes}
        </p>
      ) : null,
    });
  } else if (status === "checkout_claim_filed") {
    steps.push({
      label: "Claim Filed",
      description:
        "The kitchen filed a damage/cleaning claim. Please review and respond in your dashboard.",
      state: "error",
      timestamp: data?.checkoutApprovedAt,
      icon: <FileWarning className="h-4 w-4" />,
      detail: (
        <Badge
          variant="warning"
          className="text-xs font-normal mt-1"
        >
          <FileWarning className="h-3 w-3 mr-1" />
          Check Damage Claims in your dashboard
        </Badge>
      ),
    });
  } else {
    steps.push({
      label: "Outcome",
      description: "Cleared if no issues, or a claim may be filed",
      state: "upcoming",
      icon: <ShieldCheck className="h-4 w-4" />,
    });
  }

  return steps;
}
