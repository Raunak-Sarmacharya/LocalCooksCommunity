import type { ReactNode } from "react";
import { Calendar, Check, CheckCircle2, ClipboardList, Clock, Building2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type KitchenJourneyPhase =
  | "apply"
  | "admin_review"
  | "step2_manager"
  | "book"
  | "tour_schedule"
  | "tour_confirm"
  | "tour_visit";

type StepState = "done" | "current" | "upcoming";

function stepState(phase: KitchenJourneyPhase, stepKey: KitchenJourneyPhase): StepState {
  const bookFlow: KitchenJourneyPhase[] = ["apply", "admin_review", "step2_manager", "book"];
  const tourFlow: KitchenJourneyPhase[] = ["tour_schedule", "tour_confirm", "tour_visit"];
  const order = bookFlow.includes(phase) ? bookFlow : tourFlow;
  const idx = order.indexOf(stepKey);
  const currentIdx = order.indexOf(phase);
  if (idx < 0 || currentIdx < 0) return "upcoming";
  if (idx < currentIdx) return "done";
  if (idx === currentIdx) return "current";
  return "upcoming";
}

function StepIcon({
  state,
  children,
}: {
  state: StepState;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border z-10",
        state === "done" && "bg-primary/10 text-primary border-primary/20",
        state === "current" && "bg-primary/10 text-primary border-primary/30 ring-2 ring-primary/20",
        state === "upcoming" && "bg-muted text-muted-foreground border-transparent"
      )}
    >
      {children}
    </div>
  );
}

/** Canonical kitchen application / tour journey — keep in sync everywhere. */
export function KitchenApplicationJourneySteps({
  variant = "book",
  phase,
  className,
  compact,
}: {
  variant?: "book" | "tour";
  phase: KitchenJourneyPhase;
  className?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation("kitchen");

  if (variant === "tour") {
    const steps = [
      {
        key: "tour_schedule" as const,
        icon: <Calendar className="h-4 w-4" />,
        title: t("journeyTourScheduleTitle", "1. Schedule"),
        desc: t("journeyTourScheduleDesc", "Pick a time to visit the kitchen."),
      },
      {
        key: "tour_confirm" as const,
        icon: <Check className="h-4 w-4" />,
        title: t("journeyTourConfirmTitle", "2. Confirm"),
        desc: t("journeyTourConfirmDesc", "The kitchen manager will confirm your tour request."),
      },
      {
        key: "tour_visit" as const,
        icon: <Building2 className="h-4 w-4" />,
        title: t("journeyTourVisitTitle", "3. Visit"),
        desc: t("journeyTourVisitDesc", "Check out the equipment and space in person."),
      },
    ];

    return (
      <div className={cn("space-y-4", className)}>
        {steps.map((s) => {
          const state = stepState(phase, s.key);
          return (
            <div key={s.key} className="flex gap-4 items-start">
              <StepIcon state={state}>{s.icon}</StepIcon>
              <div className={cn(compact ? "pt-0.5" : "pt-1")}>
                <p
                  className={cn(
                    "text-sm font-semibold",
                    state === "upcoming" && "text-muted-foreground"
                  )}
                >
                  {s.title}
                </p>
                <p className="text-sm text-muted-foreground mt-0.5">{s.desc}</p>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const steps = [
    {
      key: "apply" as const,
      icon: <ClipboardList className="h-4 w-4" />,
      title: t("journeyApplyTitle", "1. Request to apply"),
      desc: t(
        "journeyApplyDesc",
        "Share your basic details with Local Cooks."
      ),
    },
    {
      key: "admin_review" as const,
      icon: <Clock className="h-4 w-4" />,
      title: t("journeyAdminReviewTitle", "2. Our Team review"),
      desc: t(
        "journeyAdminReviewDesc",
        "Our Team reviews your request to apply."
      ),
    },
    {
      key: "step2_manager" as const,
      icon: <Check className="h-4 w-4" />,
      title: t("journeyStep2Title", "3. Kitchen documents & review"),
      desc: t(
        "journeyStep2Desc",
        "After your request to apply is approved, submit kitchen documents for the manager to review."
      ),
    },
    {
      key: "book" as const,
      icon: <CheckCircle2 className="h-4 w-4" />,
      title: t("journeyBookTitle", "4. Book & pay"),
      desc: t(
        "journeyBookDesc",
        "Once the kitchen approves you, finalize your schedule and pay."
      ),
    },
  ];

  return (
    <div
      className={cn(
        "relative space-y-4",
        !compact && "pl-3 before:absolute before:inset-y-2 before:left-[23px] before:w-0.5 before:bg-gray-100",
        className
      )}
    >
      {steps.map((s) => {
        const state = stepState(phase, s.key);
        return (
          <div key={s.key} className="relative flex gap-4 items-start">
            <StepIcon state={state}>{state === "done" ? <CheckCircle2 className="h-4 w-4" /> : s.icon}</StepIcon>
            <div className={cn(compact ? "pt-0.5" : "pt-1")}>
              <p
                className={cn(
                  "text-sm font-semibold",
                  state === "upcoming" && "text-muted-foreground"
                )}
              >
                {s.title}
              </p>
              <p className="text-sm text-muted-foreground mt-0.5">{s.desc}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Map auth-modal application phase to journey highlight. */
export function authModalJourneyPhase(
  applicationPhase: "awaiting_verification" | "ready_to_submit" | "submitted" | null | undefined
): KitchenJourneyPhase {
  if (applicationPhase === "submitted") return "admin_review";
  return "apply";
}
