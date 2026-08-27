import { Link } from "wouter";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  BadgeCheck,
  BookOpen,
  Building,
  Check,
  Clock,
  Compass,
  FileText,
  HelpCircle,
  Home,
  Shield,
  Store,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SKILLSPASS_OFFICIAL_CERT_URL } from "@/config/skillspass";
import { GuidanceCards } from "./GuidanceCards";
import { BrandName } from "./BrandName";
import { QuietNotice } from "@/components/chef/ui";
import { useChefOnboarding, type ChefPath } from "./ChefOnboardingContext";

export function WelcomeStep() {
  const { t } = useTranslation("chef");
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          {t("onboardWelcomeDuration", "About 10 minutes")}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
          {t("onboardWelcomeSaveReturn", "Save and return anytime")}
        </span>
      </div>

      <div className="space-y-3">
        {[
          {
            icon: Compass,
            title: t("onboardWelcomeItem1Title", "Choose how you want to use LocalCooks"),
            description: t("onboardWelcomeItem1Description", "Sell homemade food, book commercial kitchens, or both."),
          },
          {
            icon: FileText,
            title: t("onboardWelcomeItem2Title", "Complete the steps that match your path"),
            description: t(
              "onboardWelcomeItem2Description",
              "Application for selling. Kitchen browse and apply for bookings. Training is optional."
            ),
          },
          {
            icon: BadgeCheck,
            title: t("onboardWelcomeItem3Title", "Open your dashboard when you are ready"),
            description: t(
              "onboardWelcomeItem3Description",
              "Anything you skip now can be finished later — we will not lock you out."
            ),
          },
        ].map((item) => (
          <div key={item.title} className="flex items-start gap-4 rounded-xl border border-border/80 p-4">
            <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <item.icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{item.title}</p>
              <p className="text-sm text-muted-foreground mt-0.5">{item.description}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border p-4">
          <Store className="h-5 w-5 text-primary mb-2" />
          <p className="text-sm font-medium">{t("onboardWelcomeSellFoodTitle", "Sell food")}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {t("onboardWelcomeSellFoodDescription", "We handle delivery, payments, and customer support.")}
          </p>
        </div>
        <div className="rounded-xl border border-border p-4">
          <Building className="h-5 w-5 text-foreground/70 mb-2" />
          <p className="text-sm font-medium">{t("onboardWelcomeBookKitchensTitle", "Book kitchens")}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {t("onboardWelcomeBookKitchensDescription", "Prep in licensed commercial spaces near you.")}
          </p>
        </div>
      </div>
    </div>
  );
}

export function PathSelectionStep({
  selectedPaths,
  togglePath,
}: {
  selectedPaths: ChefPath[];
  togglePath: (path: ChefPath) => void;
}) {
  const { t } = useTranslation("chef");
  return (
    <div className="space-y-5">
      <PathCard
        selected={selectedPaths.includes("localcooks")}
        onClick={() => togglePath("localcooks")}
        icon={Store}
        title={
          <>
            {t("onboardPathStartSellingOn", "Start selling on")} <BrandName className="text-primary" />
          </>
        }
        description={t(
          "onboardPathSellDescription",
          "Apply to sell homemade food. We handle delivery, payments, and customer support."
        )}
        nextSteps={[
          t("onboardPathSellStep1", "Submit a chef application"),
          t("onboardPathSellStep2", "List your food after approval"),
        ]}
        accent="primary"
      />

      <PathCard
        selected={selectedPaths.includes("kitchen")}
        onClick={() => togglePath("kitchen")}
        icon={Building}
        title={t("onboardPathKitchenTitle", "Access commercial kitchens")}
        description={t(
          "onboardPathKitchenDescription",
          "Browse and book licensed kitchens so you can scale beyond a home kitchen."
        )}
        nextSteps={[
          t("onboardPathKitchenStep1", "Browse kitchens near you"),
          t("onboardPathKitchenStep2", "Apply, then book time after approval"),
        ]}
        accent="neutral"
      />

      {selectedPaths.length === 0 && (
        <QuietNotice title={t("onboardPathSelectNoticeTitle", "Select at least one option")}>
          {t("onboardPathSelectNoticeBody", "Choose how you want to use LocalCooks, then press Save and continue.")}
        </QuietNotice>
      )}
    </div>
  );
}

function PathCard({
  selected,
  onClick,
  icon: Icon,
  title,
  description,
  nextSteps,
  accent,
}: {
  selected: boolean;
  onClick: () => void;
  icon: typeof Store;
  title: ReactNode;
  description: string;
  nextSteps: string[];
  accent: "primary" | "neutral";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full p-5 rounded-2xl border-2 text-left transition-all",
        selected
          ? accent === "primary"
            ? "border-primary bg-primary/[0.04] shadow-sm"
            : "border-foreground/80 bg-foreground/[0.03] shadow-sm"
          : "border-border hover:border-primary/40 hover:bg-muted/40"
      )}
    >
      <div className="flex items-start gap-4">
        <div
          className={cn(
            "w-12 h-12 rounded-xl flex items-center justify-center shrink-0",
            selected
              ? accent === "primary"
                ? "bg-primary text-primary-foreground"
                : "bg-foreground text-background"
              : "bg-muted text-muted-foreground"
          )}
        >
          <Icon className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-semibold text-lg leading-tight">{title}</h3>
            <span
              className={cn(
                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                selected
                  ? accent === "primary"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-foreground bg-foreground text-background"
                  : "border-muted-foreground/40"
              )}
            >
              {selected && <Check className="h-3 w-3" strokeWidth={3} />}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1.5">{description}</p>
          <ul className="mt-3 space-y-1">
            {nextSteps.map((step) => (
              <li key={step} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="h-1 w-1 rounded-full bg-primary/70" />
                {step}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </button>
  );
}

export function LocalCooksApplicationStep({ hasApplication }: { hasApplication: boolean }) {
  const { t } = useTranslation("chef");
  const { sellerApplicationStatus, currentStepData } = useChefOnboarding();
  const guidance = currentStepData?.guidance ?? [];
  const statusLabel =
    sellerApplicationStatus === "approved"
      ? t("onboardAppStatusApproved", "Approved")
      : sellerApplicationStatus === "rejected"
        ? t("onboardAppStatusNeedsAttention", "Needs attention")
        : t("onboardAppStatusUnderReview", "Under review");

  return (
    <div className="space-y-8">
      {hasApplication ? (
        <QuietNotice title={t("onboardAppSubmittedTitle", "Application submitted")}>
          {t("onboardAppSubmittedBody", {
            status: statusLabel,
            defaultValue: "Status: {status}. We will email you when anything changes.",
          })}
        </QuietNotice>
      ) : (
        <>
          <div className="space-y-3">
            {[
              {
                icon: User,
                title: t("onboardAppPersonalDetailsTitle", "Personal details"),
                description: t("onboardAppPersonalDetailsDescription", "Name, email, and phone so we can reach you."),
              },
              {
                icon: Home,
                title: t("onboardAppKitchenSettingTitle", "Kitchen setting"),
                description: t(
                  "onboardAppKitchenSettingDescription",
                  "Home kitchen, commercial kitchen, or not sure yet."
                ),
              },
              {
                icon: Shield,
                title: t("onboardAppCertificationsTitle", "Certifications"),
                description: t(
                  "onboardAppCertificationsDescription",
                  "Food handler certificate. Establishment certificate is optional."
                ),
              },
            ].map((item) => (
              <div key={item.title} className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <item.icon className="h-4 w-4" />
                </div>
                <div className="pt-1">
                  <p className="text-sm font-semibold">{item.title}</p>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-border bg-muted/30 p-4 flex items-start gap-3">
            <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground">
              {t(
                "onboardAppReviewTimeNotice",
                "Most applications are reviewed within 24–48 hours. Press Start your application below, or continue this setup and finish later from your dashboard."
              )}
            </p>
          </div>
        </>
      )}

      {hasApplication && (
        <Button asChild variant="outline">
          <Link href="/dashboard?view=applications">{t("onboardViewApplicationLabel", "View application")}</Link>
        </Button>
      )}

      <GuidanceCards
        items={guidance}
        icons={[FileText, Shield, HelpCircle]}
      />
    </div>
  );
}

export function TrainingStep({ hasCompleted }: { hasCompleted: boolean }) {
  const { t } = useTranslation("chef");
  const { currentStepData } = useChefOnboarding();
  const guidance = currentStepData?.guidance ?? [];

  return (
    <div className="space-y-8">
      {hasCompleted ? (
        <QuietNotice title={t("onboardTrainingCompletedTitle", "Training completed")}>
          {t("onboardTrainingCompletedBody", "You finished the LocalCooks food safety videos.")}
        </QuietNotice>
      ) : (
        <>
          <div className="grid gap-3">
            <div className="rounded-xl border border-border p-4">
              <p className="text-sm font-semibold">{t("onboardTrainingBasicsTitle", "Food Safety Basics")}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {t("onboardTrainingBasicsDescription", "14 short videos on HACCP, contamination, and safe handling.")}
              </p>
            </div>
            <div className="rounded-xl border border-border p-4">
              <p className="text-sm font-semibold">{t("onboardTrainingHygieneTitle", "Safety & Hygiene How-To's")}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {t("onboardTrainingHygieneDescription", "8 practical demos for kitchen hygiene and cleaning.")}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <p className="text-sm text-muted-foreground">
              {t(
                "onboardTrainingCertNoticePrefix",
                "Finishing these videos gives you a LocalCooks completion certificate. That is not an official food handler certificate. For official certification, register free with"
              )}{" "}
              <a
                href={SKILLSPASS_OFFICIAL_CERT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary hover:underline"
              >
                {t("onboardTrainingSkillsPassLinkText", "SkillsPass NL")}
              </a>
              .
            </p>
          </div>
        </>
      )}

      {hasCompleted && (
        <Button asChild variant="outline">
          <Link href="/dashboard?view=training">{t("onboardTrainingReviewLink", "Review training")}</Link>
        </Button>
      )}

      <GuidanceCards items={guidance} icons={[BookOpen, Shield, Clock]} />
    </div>
  );
}

export function BrowseKitchensStep({
  hasApplications,
  applicationsCount,
}: {
  hasApplications: boolean;
  applicationsCount: number;
}) {
  const { t } = useTranslation("chef");
  const { currentStepData } = useChefOnboarding();
  const guidance = currentStepData?.guidance ?? [];

  return (
    <div className="space-y-8">
      {hasApplications ? (
        <QuietNotice title={t("onboardKitchenAppSubmittedTitle", "Kitchen application submitted")}>
          {t("onboardKitchenAppSubmittedBody", {
            count: applicationsCount,
            defaultValue:
              "{count, plural, one {# kitchen application} other {# kitchen applications}} on file. You can browse more anytime.",
          })}
        </QuietNotice>
      ) : (
        <>
          <div className="space-y-3">
            {[
              {
                step: "1",
                title: t("onboardBrowseStepBrowseTitle", "Browse"),
                description: t(
                  "onboardBrowseStepBrowseDescription",
                  "Compare kitchens by location, equipment, storage, and hourly rate."
                ),
              },
              {
                step: "2",
                title: t("onboardBrowseStepApplyTitle", "Apply"),
                description: t(
                  "onboardBrowseStepApplyDescription",
                  "Send a short application to the kitchens you want to use."
                ),
              },
              {
                step: "3",
                title: t("onboardBrowseStepBookTitle", "Book"),
                description: t(
                  "onboardBrowseStepBookDescription",
                  "After approval, book prep time directly from your dashboard."
                ),
              },
            ].map((item) => (
              <div key={item.step} className="flex items-start gap-4 rounded-xl border border-border/80 p-4">
                <span className="w-8 h-8 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center shrink-0">
                  {item.step}
                </span>
                <div>
                  <p className="text-sm font-semibold">{item.title}</p>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {hasApplications && (
        <Button asChild variant="outline">
          <Link href="/compare-kitchens">{t("onboardBrowseMoreKitchensLink", "Browse more kitchens")}</Link>
        </Button>
      )}

      <GuidanceCards items={guidance} icons={[Building, FileText, HelpCircle]} />
    </div>
  );
}

export function SummaryStep() {
  const { t } = useTranslation("chef");
  const {
    selectedPaths,
    hasSellerApplication,
    hasKitchenApplications,
    kitchenApplicationsCount,
    hasCompletedTraining,
    sellerApplicationStatus,
  } = useChefOnboarding();

  const summaryItems = [];

  if (selectedPaths.includes("localcooks")) {
    summaryItems.push({
      id: "application",
      label: t("onboardSummarySellerAppLabel", "Seller application"),
      status: hasSellerApplication
        ? sellerApplicationStatus === "approved"
          ? "done"
          : "in_progress"
        : "not_started",
      description: hasSellerApplication
        ? t("onboardSummaryAppStatusDescription", {
            status:
              sellerApplicationStatus === "approved"
                ? t("onboardAppStatusApproved", "Approved")
                : sellerApplicationStatus === "rejected"
                  ? t("onboardSummaryStatusRejected", "Rejected")
                  : t("onboardAppStatusUnderReview", "Under review"),
            defaultValue: "Status: {status}",
          })
        : t("onboardSummarySellerAppNotStarted", "Submit anytime from Applications in your dashboard"),
      actionLabel: hasSellerApplication
        ? t("onboardViewApplicationLabel", "View application")
        : t("onboardStartApplicationLabel", "Start application"),
      actionHref: hasSellerApplication
        ? "/dashboard?view=applications"
        : "/dashboard?view=applications&action=new",
    });

    summaryItems.push({
      id: "training",
      label: t("onboardSummaryTrainingLabel", "Food safety training"),
      status: hasCompletedTraining ? "done" : "not_started",
      description: hasCompletedTraining
        ? t("onboardTrainingCompletedTitle", "Training completed")
        : t("onboardSummaryTrainingNotStarted", "Optional. Watch the videos at your own pace from Overview."),
      actionLabel: hasCompletedTraining
        ? t("onboardTrainingReviewLink", "Review training")
        : t("onboardStartTrainingLabel", "Start training"),
      actionHref: "/dashboard?view=training",
    });
  }

  if (selectedPaths.includes("kitchen")) {
    summaryItems.push({
      id: "kitchen-access",
      label: t("onboardSummaryKitchenAccessLabel", "Kitchen access"),
      status: hasKitchenApplications ? "done" : "not_started",
      description: hasKitchenApplications
        ? t("onboardSummaryKitchenAppsSubmitted", {
            count: kitchenApplicationsCount,
            defaultValue: "{count, plural, one {# kitchen application} other {# kitchen applications}} submitted",
          })
        : t("onboardSummaryKitchenAccessNotStarted", "Browse and apply to commercial kitchens anytime"),
      actionLabel: t("onboardSummaryBrowseKitchensLabel", "Browse kitchens"),
      actionHref: "/compare-kitchens",
    });
  }

  return (
    <div className="space-y-3">
      {summaryItems.map((item) => (
        <div
          key={item.id}
          className="flex items-center justify-between gap-4 rounded-xl border border-border p-4"
        >
          <div className="flex items-center gap-3 min-w-0">
            {item.status === "done" && (
              <div className="w-8 h-8 rounded-full border bg-muted flex items-center justify-center shrink-0">
                <Check className="h-4 w-4 text-success" />
              </div>
            )}
            {item.status === "in_progress" && (
              <div className="w-8 h-8 rounded-full border bg-muted flex items-center justify-center shrink-0">
                <Clock className="h-4 w-4 text-warning" />
              </div>
            )}
            {item.status === "not_started" && (
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                <div className="w-2 h-2 rounded-full bg-muted-foreground/50" />
              </div>
            )}
            <div className="min-w-0">
              <p className="font-medium text-sm">{item.label}</p>
              <p className="text-sm text-muted-foreground">{item.description}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" asChild className="shrink-0 text-primary">
            <Link href={item.actionHref}>{item.actionLabel}</Link>
          </Button>
        </div>
      ))}
    </div>
  );
}

export function CompletionStep({ selectedPaths }: { selectedPaths: ChefPath[] }) {
  const { t } = useTranslation("chef");
  const { hasSellerApplication, hasKitchenApplications } = useChefOnboarding();

  const nextItems: string[] = [];
  if (selectedPaths.includes("localcooks")) {
    nextItems.push(
      hasSellerApplication
        ? t("onboardCompletionSellerReviewing", "Your seller application is being reviewed — we will email you with updates.")
        : t("onboardCompletionSellerNotSubmitted", "Submit your seller application from Applications whenever you are ready.")
    );
  }
  if (selectedPaths.includes("kitchen")) {
    nextItems.push(
      hasKitchenApplications
        ? t("onboardCompletionKitchenReviewing", "Your kitchen applications are with the kitchen managers.")
        : t("onboardCompletionKitchenNotSubmitted", "Browse commercial kitchens and apply whenever you want to book time.")
    );
  }

  return (
    <div className="space-y-6">
      <div className="w-16 h-16 rounded-full border bg-muted flex items-center justify-center">
        <Check className="h-8 w-8 text-success" />
      </div>
      <ul className="space-y-3">
        {nextItems.map((item) => (
          <li key={item} className="flex items-start gap-3 text-sm text-muted-foreground">
            <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
