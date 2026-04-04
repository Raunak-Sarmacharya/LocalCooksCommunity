import { CheckCircle2, Circle, Clock, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Shared ─────────────────────────────────────────────────────────────────

type StepStatus = "completed" | "active" | "upcoming" | "rejected";
type DateLike = string | Date | null | undefined;

interface Step {
  label: string;
  description: string;
  status: StepStatus;
  timestamp?: DateLike;
}

function fmtShortDate(value: DateLike): string | null {
  if (!value) return null;
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/St_Johns" });
  } catch {
    return null;
  }
}

function StepNode({ step }: { step: Step }) {
  const dateStr = fmtShortDate(step.timestamp);
  return (
    <div className="flex flex-col items-center gap-1 min-w-[64px] sm:min-w-[80px]">
      <div
        className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center border-2 transition-colors",
          step.status === "completed" && "bg-green-100 border-green-500 text-green-600",
          step.status === "active" && "bg-amber-100 border-amber-500 text-amber-600 ring-2 ring-amber-200",
          step.status === "rejected" && "bg-red-100 border-red-500 text-red-600",
          step.status === "upcoming" && "bg-muted border-muted-foreground/20 text-muted-foreground/40",
        )}
      >
        {step.status === "completed" ? (
          <CheckCircle2 className="h-3.5 w-3.5" />
        ) : step.status === "rejected" ? (
          <XCircle className="h-3.5 w-3.5" />
        ) : step.status === "active" ? (
          <Clock className="h-3.5 w-3.5" />
        ) : (
          <Circle className="h-3.5 w-3.5" />
        )}
      </div>
      <div className="text-center">
        <p className={cn(
          "text-[10px] font-semibold leading-tight",
          step.status === "completed" && "text-green-700",
          step.status === "active" && "text-amber-700",
          step.status === "rejected" && "text-red-700",
          step.status === "upcoming" && "text-muted-foreground/50",
        )}>
          {step.label}
        </p>
        <p className={cn(
          "text-[9px] leading-tight mt-0.5 max-w-[80px]",
          step.status === "active" ? "text-amber-600 font-medium" : "text-muted-foreground/60",
        )}>
          {step.description}
        </p>
        {dateStr && (
          <p className="text-[9px] leading-tight mt-0.5 text-muted-foreground/80 font-medium">
            {dateStr}
          </p>
        )}
      </div>
    </div>
  );
}

function Connector({ nextStatus }: { nextStatus: StepStatus }) {
  return (
    <div
      className={cn(
        "h-0.5 w-4 sm:w-6 mt-[-18px]",
        nextStatus === "upcoming" || nextStatus === "rejected"
          ? "bg-muted-foreground/15"
          : "bg-green-400",
      )}
    />
  );
}

// ─── Chef Application Progress Tracker ──────────────────────────────────────

interface ApplicationProgressTrackerProps {
  status: string;
  createdAt?: DateLike;
  foodSafetyLicenseUrl?: string | null;
  foodSafetyLicenseStatus?: string | null;
  foodEstablishmentCertUrl?: string | null;
  foodEstablishmentCertStatus?: string | null;
  documentsReviewedAt?: DateLike;
  phpShopCreated?: boolean;
  verificationEmailSentAt?: DateLike;
  className?: string;
}

function deriveChefSteps(props: ApplicationProgressTrackerProps): Step[] {
  const {
    status,
    createdAt,
    foodSafetyLicenseUrl,
    foodSafetyLicenseStatus,
    foodEstablishmentCertUrl,
    foodEstablishmentCertStatus,
    documentsReviewedAt,
    phpShopCreated,
    verificationEmailSentAt,
  } = props;

  const isRejectedApp = status === "rejected" || status === "cancelled";

  // Step 1: Application Submitted
  const step1: Step = {
    label: "Submitted",
    description: "Application received",
    status: "completed",
    timestamp: createdAt,
  };

  // Step 2: Application Review
  let step2Status: StepStatus = "upcoming";
  let step2Desc = "Awaiting admin review";
  if (status === "approved") {
    step2Status = "completed";
    step2Desc = "Application approved";
  } else if (status === "rejected") {
    step2Status = "rejected";
    step2Desc = "Application rejected";
  } else if (status === "cancelled") {
    step2Status = "rejected";
    step2Desc = "Application cancelled";
  } else if (status === "inReview") {
    step2Status = "active";
    step2Desc = "Needs your review";
  }

  const step2: Step = {
    label: "App Review",
    description: step2Desc,
    status: step2Status,
  };

  // Step 3: Documents Uploaded (only relevant after approval)
  let step3Status: StepStatus = "upcoming";
  let step3Desc = "Awaiting document upload";
  if (isRejectedApp) {
    step3Status = "upcoming";
    step3Desc = "N/A";
  } else if (status === "approved") {
    const hasRequiredDoc = !!foodSafetyLicenseUrl;
    if (hasRequiredDoc) {
      step3Status = "completed";
      step3Desc = "Documents uploaded";
    } else {
      step3Status = "active";
      step3Desc = "Chef needs to upload docs";
    }
  }

  const step3: Step = {
    label: "Docs Upload",
    description: step3Desc,
    status: step3Status,
  };

  // Step 4: Documents Verified (only relevant after upload)
  let step4Status: StepStatus = "upcoming";
  let step4Desc = "Awaiting verification";
  let step4Timestamp: DateLike = null;
  if (isRejectedApp) {
    step4Status = "upcoming";
    step4Desc = "N/A";
  } else if (status === "approved" && foodSafetyLicenseUrl) {
    const fslApproved = foodSafetyLicenseStatus === "approved";
    const fslRejected = foodSafetyLicenseStatus === "rejected";
    const fslPending = foodSafetyLicenseStatus === "pending";

    const fecRequired = !!foodEstablishmentCertUrl;
    const fecApproved = !fecRequired || foodEstablishmentCertStatus === "approved";
    const fecRejected = fecRequired && foodEstablishmentCertStatus === "rejected";
    const fecPending = fecRequired && foodEstablishmentCertStatus === "pending";

    if (fslApproved && fecApproved) {
      step4Status = "completed";
      step4Desc = "Fully verified";
      step4Timestamp = documentsReviewedAt;
    } else if (fslRejected || fecRejected) {
      step4Status = "rejected";
      step4Desc = "Document(s) rejected";
      step4Timestamp = documentsReviewedAt;
    } else if (fslPending || fecPending) {
      step4Status = "active";
      step4Desc = "Needs your review";
    }
  }

  const step4: Step = {
    label: "Doc Review",
    description: step4Desc,
    status: step4Status,
    timestamp: step4Timestamp,
  };

  // Step 5: PHP Shop Created
  let step5Status: StepStatus = "upcoming";
  let step5Desc = "Waiting for verification";
  if (step4Status === "completed") {
    if (phpShopCreated) {
      step5Status = "completed";
      step5Desc = "Shop active";
    } else {
      step5Status = "active";
      step5Desc = "Awaiting creation";
    }
  }

  const step5: Step = {
    label: "Shop Creation",
    description: step5Desc,
    status: step5Status,
  };

  // Step 6: Credentials Sent
  let step6Status: StepStatus = "upcoming";
  let step6Desc = "Waiting for shop";
  if (phpShopCreated) {
    if (verificationEmailSentAt) {
      step6Status = "completed";
      step6Desc = "Credentials sent";
    } else {
      step6Status = "active";
      step6Desc = "Awaiting trigger";
    }
  }

  const step6: Step = {
    label: "Credentials",
    description: step6Desc,
    status: step6Status,
    timestamp: verificationEmailSentAt,
  };

  return [step1, step2, step3, step4, step5, step6];
}

export function ApplicationProgressTracker(props: ApplicationProgressTrackerProps) {
  const steps = deriveChefSteps(props);

  return (
    <div className={cn("flex items-center gap-0", props.className)}>
      {steps.map((step, idx) => (
        <div key={idx} className="flex items-center">
          <StepNode step={step} />
          {idx < steps.length - 1 && <Connector nextStatus={steps[idx + 1].status} />}
        </div>
      ))}
    </div>
  );
}

// ─── Kitchen License Progress Tracker ────────────────────────────────────────

interface LicenseProgressTrackerProps {
  licenseStatus: string;
  licenseUrl?: string | null;
  termsUrl?: string | null;
  submittedAt?: string | null;
  approvedAt?: string | null;
  className?: string;
}

function deriveLicenseSteps(props: LicenseProgressTrackerProps): Step[] {
  const { licenseStatus, licenseUrl, submittedAt, approvedAt } = props;

  const hasLicense = !!licenseUrl;

  // Step 1: Documents Submitted
  const step1: Step = {
    label: "Submitted",
    description: hasLicense ? "License uploaded" : "No license",
    status: hasLicense ? "completed" : "active",
    timestamp: hasLicense ? submittedAt : null,
  };

  // Step 2: Under Review
  let step2Status: StepStatus = "upcoming";
  let step2Desc = "Waiting for submission";
  if (hasLicense) {
    if (licenseStatus === "pending") {
      step2Status = "active";
      step2Desc = "Needs your review";
    } else if (licenseStatus === "approved" || licenseStatus === "rejected") {
      step2Status = "completed";
      step2Desc = "Review completed";
    }
  }

  const step2: Step = {
    label: "Admin Review",
    description: step2Desc,
    status: step2Status,
  };

  // Step 3: Decision
  let step3Status: StepStatus = "upcoming";
  let step3Desc = "Pending decision";
  let step3Timestamp: string | null = null;
  if (licenseStatus === "approved") {
    step3Status = "completed";
    step3Desc = "License approved";
    step3Timestamp = approvedAt ?? null;
  } else if (licenseStatus === "rejected") {
    step3Status = "rejected";
    step3Desc = "License rejected";
    step3Timestamp = approvedAt ?? null;
  }

  const step3: Step = {
    label: "Decision",
    description: step3Desc,
    status: step3Status,
    timestamp: step3Timestamp,
  };

  return [step1, step2, step3];
}

export function LicenseProgressTracker(props: LicenseProgressTrackerProps) {
  const steps = deriveLicenseSteps(props);

  return (
    <div className={cn("flex items-center gap-0", props.className)}>
      {steps.map((step, idx) => (
        <div key={idx} className="flex items-center">
          <StepNode step={step} />
          {idx < steps.length - 1 && <Connector nextStatus={steps[idx + 1].status} />}
        </div>
      ))}
    </div>
  );
}
