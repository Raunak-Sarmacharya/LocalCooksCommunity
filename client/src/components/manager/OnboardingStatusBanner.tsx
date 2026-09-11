import { ArrowRight, CheckCircle2, Clock, ListChecks } from "@/components/ui/manager-icons";
import { Button } from "@/components/ui/button";
import { CARD_RADIUS } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { mt } from "@/i18n/manager";

interface OnboardingStatusBannerProps {
  isLoading?: boolean;
  showSetupBanner: boolean;
  showLicenseReviewBanner: boolean;
  isReadyForBookings: boolean;
  missingSteps: string[];
  improvementSteps?: string[];
  onContinueSetup: () => void;
  onImproveListing?: (task: string) => void;
  className?: string;
}

export function OnboardingStatusBanner({
  isLoading = false,
  showSetupBanner,
  showLicenseReviewBanner,
  missingSteps,
  improvementSteps = [],
  onContinueSetup,
  onImproveListing,
  className,
}: OnboardingStatusBannerProps) {
  if (isLoading) {
    return (
      <div className={cn("mb-5 h-24 animate-pulse rounded-2xl border border-border/60 bg-muted/40", className)} aria-label={mt("loadingSetupStatus")} />
    );
  }

  const tasks = showSetupBanner ? missingSteps : improvementSteps;

  if (showSetupBanner || (!showLicenseReviewBanner && tasks.length > 0)) {
    const isSetup = showSetupBanner;
    return (
      <section className={cn(CARD_RADIUS, "mx-4 mt-4 border bg-card p-4 md:mx-6 md:mt-6", className)} aria-label={mt("managerSetupGuidance")}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
              <ListChecks className="size-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">{isSetup ? mt("yourNextSetupStep") : mt("improveYourListing")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{tasks[0]}</p>
              {tasks.length > 1 ? <p className="mt-1 text-xs text-muted-foreground">{tasks.length - 1} more item{tasks.length > 2 ? "s" : ""} after this</p> : null}
            </div>
          </div>
          <Button size="sm" onClick={() => isSetup ? onContinueSetup() : onImproveListing?.(tasks[0])} className="shrink-0">
            {isSetup ? mt("continueSetup") : mt("completeListing")}<ArrowRight className="ml-1.5 size-4" />
          </Button>
        </div>
      </section>
    );
  }

  if (showLicenseReviewBanner) {
    return (
      <section className={cn(CARD_RADIUS, "mx-4 mt-4 border bg-card p-4 md:mx-6 md:mt-6", className)} aria-label={mt("licenceReviewStatus")}>
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/10">
            <Clock className="size-4 text-warning" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">{mt("licenseUnderReview")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{mt("setupCompleteImproveWhilePending")}</p>
            {improvementSteps[0] ? <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><CheckCircle2 className="size-3.5" />{mt("nextLabel")}: {improvementSteps[0]}</p> : null}
          </div>
        </div>
      </section>
    );
  }

  return null;
}

export default OnboardingStatusBanner;
