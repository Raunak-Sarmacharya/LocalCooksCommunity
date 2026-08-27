import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useChefOnboarding } from "./ChefOnboardingContext";
import {
  BookOpen,
  Building,
  Check,
  ChefHat,
  ClipboardCheck,
  Compass,
  FileText,
  PartyPopper,
  Store,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const STEP_ICONS: Record<string, LucideIcon> = {
  welcome: ChefHat,
  "path-selection": Compass,
  "localcooks-application": FileText,
  "food-safety-training": BookOpen,
  "browse-kitchens": Building,
  summary: ClipboardCheck,
  completion: PartyPopper,
};

export function ChefStepper() {
  const { t } = useTranslation("chef");
  const {
    visibleSteps,
    currentStepIndex,
    completedSteps,
    goToStep,
    selectedPaths,
  } = useChefOnboarding();

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-2 pb-6">
        <h2 className="text-[22px] font-semibold leading-snug tracking-tight text-foreground">
          {t("onboardStepperHeading", "Get started by setting up your chef profile and kitchen access.")}
        </h2>
      </div>

      {selectedPaths.length > 0 && (
        <div className="flex flex-wrap gap-2 px-8 pb-6">
          {selectedPaths.includes("localcooks") && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 rounded-full text-xs font-medium text-primary">
              <Store className="h-3 w-3" />
              {t("onboardStepperSellingBadge", "Selling")}
            </div>
          )}
          {selectedPaths.includes("kitchen") && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-foreground/5 rounded-full text-xs font-medium text-foreground/70">
              <Building className="h-3 w-3" />
              {t("onboardStepperKitchensBadge", "Kitchens")}
            </div>
          )}
        </div>
      )}

      <nav aria-label={t("onboardStepperAriaLabel", "Setup progress")} className="flex-1 overflow-auto px-8 pb-4">
        <ol className="relative">
          {visibleSteps.map((step, index) => {
            const isActive = index === currentStepIndex;
            const isCompleted = completedSteps[step.id] ?? false;
            const isPast = index < currentStepIndex;
            const isDone = isCompleted || isPast;
            const isClickable = isPast || isCompleted;
            const isLast = index === visibleSteps.length - 1;
            const StepIcon = STEP_ICONS[String(step.id)] ?? FileText;
            const nextIsDone =
              index < visibleSteps.length - 1 &&
              (completedSteps[visibleSteps[index + 1]?.id] || index + 1 < currentStepIndex);

            return (
              <li key={step.id} className="relative flex gap-4 pb-8 last:pb-0">
                {!isLast && (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute left-4 top-8 bottom-0 w-px -translate-x-1/2",
                      isDone || nextIsDone ? "bg-primary" : "bg-border"
                    )}
                  />
                )}

                <button
                  type="button"
                  onClick={() => {
                    if (!isClickable) return;
                    void goToStep(step.id);
                  }}
                  disabled={!isClickable && !isActive}
                  aria-current={isActive ? "step" : undefined}
                  className={cn(
                    "w-full flex items-start gap-3.5 text-left rounded-lg -mx-1 px-1 py-0.5 transition-colors",
                    isClickable && !isActive && "hover:bg-muted/60 cursor-pointer",
                    !isClickable && !isActive && "cursor-default"
                  )}
                >
                  <span
                    className={cn(
                      "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      isDone && "bg-primary border-primary text-primary-foreground",
                      isActive && !isDone && "bg-primary border-primary text-primary-foreground",
                      !isActive && !isDone && "bg-background border-border text-muted-foreground"
                    )}
                  >
                    {isDone ? (
                      <Check className="h-4 w-4" strokeWidth={2.5} />
                    ) : (
                      <StepIcon className="h-3.5 w-3.5" />
                    )}
                  </span>

                  <span className="flex-1 min-w-0 pt-0.5">
                    <span
                      className={cn(
                        "block text-sm leading-tight",
                        isActive ? "font-semibold text-foreground" : "font-medium text-foreground/80",
                        !isActive && !isDone && "text-muted-foreground"
                      )}
                    >
                      {step.metadata?.label ||
                        step.payload?.title ||
                        t("onboardStepperFallbackStepLabel", {
                          number: index + 1,
                          defaultValue: "Step {number}",
                        })}
                    </span>
                    {step.metadata?.sidebarDescription && (
                      <span
                        className={cn(
                          "block text-xs leading-relaxed mt-1",
                          isActive ? "text-muted-foreground" : "text-muted-foreground/80"
                        )}
                      >
                        {step.metadata.sidebarDescription}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}

export default ChefStepper;
