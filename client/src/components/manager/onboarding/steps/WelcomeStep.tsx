import { mt } from "@/i18n/manager";
import {
  ArrowRight,
  Briefcase,
  CalendarDays,
  Clock,
  CookingPot,
} from "@/components/ui/manager-icons";
import { Button } from "@/components/ui/button";
import { useManagerOnboarding } from "../ManagerOnboardingContext";

/**
 * Welcome step.
 *
 * One short page that introduces the work ahead. The sidebar already lists
 * every step in order, so we don't repeat that list here — instead we show
 * the *first three* required steps as preview cards (icon + title + one-line
 * description + step number) so the user knows the shape of what they're
 * walking into. Two exits: "Let's start" advances, "Maybe later" saves the
 * seen-state and sends the user to the dashboard so they can resume later.
 */
const PREVIEW_STEPS = [
  { Icon: Briefcase, titleKey: "welcomeStepBusinessTitle", descKey: "welcomeStepBusinessDesc" },
  { Icon: CookingPot, titleKey: "welcomeStepKitchenTitle", descKey: "welcomeStepKitchenDesc" },
  { Icon: CalendarDays, titleKey: "welcomeStepAvailabilityTitle", descKey: "welcomeStepAvailabilityDesc" },
] as const;

export default function WelcomeStep() {
  const { handleNext, saveAndExit, isSubmitting } = useManagerOnboarding();

  return (
    <div className="mx-auto flex max-w-xl animate-in fade-in flex-col gap-8 duration-500">
      {/*
       * Header — eyebrow + headline + description + time pill.
       * The headline uses two lines so a short bold first line leads the eye
       * to a softer second line (mirrors the reference layout).
       */}
      <header className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          {mt("welcomeEyebrow")}
        </p>

        <h2 className="text-4xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-5xl">
          {mt("welcomeHeadline")}
          <span className="block text-4xl sm:text-4xl text-foreground/60">{mt("welcomeHeadlineAccent")}</span>
        </h2>
   

        <p className="max-w-md text-base leading-relaxed text-muted-foreground">
          {mt("aFewQuickStepsToGetYourSpaceReadyForChefsToDiscoverAndBook")}
        </p>

        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
          <Clock className="h-3.5 w-3.5" aria-hidden />
          {mt("welcomeTimeEstimate")}
        </span>
      </header>

      {/*
       * Step preview cards. The numbered badge on the right mirrors the
       * reference image — it shows the user *which* step this card refers to,
       * so the welcome page reads as a preview rather than a duplicate of the
       * sidebar list.
       */}
      <ol className="space-y-3">
        {PREVIEW_STEPS.map(({ Icon, titleKey, descKey }, index) => (
          <li
            key={titleKey}
            className="flex items-start gap-4 rounded-2xl border border-border bg-card px-4 py-3.5 shadow-sm transition-colors hover:bg-muted/40"
          >
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
              aria-hidden
            >
              <Icon className="h-5 w-5" />
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{mt(titleKey)}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{mt(descKey)}</p>
            </div>

            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-xs font-medium text-muted-foreground"
              aria-hidden
            >
              {index + 1}
            </span>
          </li>
        ))}
      </ol>

      {/*
       * Footer — separated by a thin divider so the page reads as
       * (intro + preview) above and (decide + act) below. The "Maybe later"
       * button uses saveAndExit() so the user can leave the wizard with their
       * progress persisted and come back to the same step later.
       */}
      <footer className="mt-2 flex flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
          {mt("welcomeUpdateLater")}
        </p>

        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={() => void saveAndExit()}
            disabled={isSubmitting}
            className="text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {mt("welcomeMaybeLater")}
          </Button>

          <Button
            type="button"
            size="lg"
            onClick={() => void handleNext()}
            disabled={isSubmitting}
            className="gap-2"
          >
            {mt("welcomeLetsStart")}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </footer>
    </div>
  );
}
