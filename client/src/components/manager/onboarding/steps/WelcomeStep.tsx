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
// Same constant the shared footer uses, so all nine steps are one footer height rather than
// two that drift. See the comment there for why the `!` is required.
import { FOOTER_ACTION } from "../OnboardingNavigationFooter";

/**
 * Welcome step — the first screen of the setup wizard.
 *
 * NO "WELCOME" COPY. The manager reaches this straight after the welcome screen
 * (`manager-welcome-screen.tsx`), so an eyebrow reading "Welcome to LocalCooks" — and a
 * breadcrumb ending in "Welcome" — said it for the third time. The headline carries the page.
 *
 * Header type scale, deliberately three steps and no more:
 *   headline   30/36px  semibold
 *   support    18/20px  muted
 *   body       14px     muted
 * The headline used to run 48px into a 36px accent, which is what read as unfinished.
 */
const PREVIEW_STEPS = [
  { Icon: Briefcase, titleKey: "welcomeStepBusinessTitle", descKey: "welcomeStepBusinessDesc" },
  { Icon: CookingPot, titleKey: "welcomeStepKitchenTitle", descKey: "welcomeStepKitchenDesc" },
  { Icon: CalendarDays, titleKey: "welcomeStepAvailabilityTitle", descKey: "welcomeStepAvailabilityDesc" },
] as const;

export default function WelcomeStep() {
  const { handleNext, saveAndExit, isSubmitting } = useManagerOnboarding();

  return (
    <div className="mx-auto flex max-w-xl animate-in fade-in flex-col gap-10 duration-500">
      <header className="space-y-3">
        {/* `h1`: the shell skips its heading block for the welcome step, so this is the
            page's only heading — it was still starting at level 2. */}
        <h1 className="text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
          {mt("welcomeHeadline")}
        </h1>

        <p className="text-lg text-muted-foreground sm:text-xl">{mt("welcomeHeadlineAccent")}</p>

        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          {mt("aFewQuickStepsToGetYourSpaceReadyForChefsToDiscoverAndBook")}
        </p>

        {/* Same chip treatment the shell uses for the business name on every other step. */}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
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
       * Footer: the divider and the actions, nothing else.
       *
       * There used to be a reassurance line on the left ("you can change this later…"). It
       * wrapped in EVERY locale — at `text-xs` that sentence needs ~360px and the slot only
       * has ~200px next to the buttons — so it always orphaned its last word onto a second
       * line. "Maybe later" already says it, so the line is gone.
       */}
      <footer className="flex items-center justify-end gap-2 border-t border-border pt-6">
        <Button
          type="button"
          variant="ghost"
          onClick={() => void saveAndExit()}
          disabled={isSubmitting}
          className={`${FOOTER_ACTION} text-muted-foreground hover:bg-muted hover:text-foreground`}
        >
          {mt("welcomeMaybeLater")}
        </Button>

        <Button
          type="button"
          onClick={() => void handleNext()}
          disabled={isSubmitting}
          className={`${FOOTER_ACTION} min-w-[140px] gap-2 font-semibold`}
        >
          {mt("welcomeLetsStart")}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      </footer>
    </div>
  );
}
