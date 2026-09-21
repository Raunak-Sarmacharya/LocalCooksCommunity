import React from "react";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import { Button } from "@/components/ui/button";
import { StatusButton } from "@/components/ui/status-button";
import { AlertCircle, ChevronLeft, LogOut, SkipForward } from "@/components/ui/manager-icons";
import { cn } from "@/lib/utils";

/**
 * Footer action size: 40px, and the `!` is load-bearing.
 *
 * `index.css` applies `min-h-[44px]` to EVERY `button`, unlayered — so `size` alone can never
 * go below 44px, which is why `lg` (48px) and `default` (44px) both read as oversized here.
 * `md:!min-h-0` releases that floor from `md` up and leaves the mobile touch target alone.
 * `WelcomeStep` imports the same value, so all nine steps share one footer height.
 */
export const FOOTER_ACTION = "!h-10 md:!min-h-0";

interface OnboardingNavigationFooterProps {
    onNext: () => void;
    onBack?: () => void;
    onSkip?: () => void;
    /**
     * Persist whatever the current step has, mark it as seen, and leave the
     * wizard — the user can resume from the same step later. The footer does
     * not own the action; callers wire it to `ManagerOnboardingContext.saveAndExit`.
     */
    onSaveAndExit?: () => void;
    isNextDisabled?: boolean;
    isBackDisabled?: boolean;
    isLoading?: boolean;
    isSavingAndExiting?: boolean;
    nextLabel?: string;
    backLabel?: string;
    skipLabel?: string;
    saveAndExitLabel?: string;
    showBack?: boolean;
    showSkip?: boolean;
    /**
     * Show the "Save & exit" escape hatch. Defaults to `true` so any step can
     * be paused without losing progress; a step can opt out by passing
     * `false` (e.g. on the welcome step, which already renders its own
     * "Maybe later" button).
     */
    showSaveAndExit?: boolean;
    /**
     * Whether the step actually holds anything to persist.
     *
     * The escape hatch stays on screen either way — it is how a manager leaves the
     * wizard, and hiding it would strand them. What changes is what it promises: with
     * nothing pending it reads "Exit setup" and simply leaves, instead of offering to
     * save work that is already saved. `saveAndExit` reads the same flag, so the label
     * and the behaviour cannot disagree.
     */
    hasUnsavedWork?: boolean;
    /**
     * Why the primary action is disabled, stated next to it.
     *
     * A greyed-out Continue with no reason is a dead end: the manager can see the button will
     * not work but not what to do about it. The listings pages already put their
     * `incompleteReason()` beside the disabled submit; this is the same rule for the wizard.
     * Callers pass the SAME string they use when they refuse to leave a part, so the button and
     * the refusal can never explain the step differently.
     */
    incompleteReason?: string;
    className?: string;
}

export function OnboardingNavigationFooter({
    onNext,
    onBack,
    onSkip,
    onSaveAndExit,
    isNextDisabled = false,
    isBackDisabled = false,
    isLoading = false,
    isSavingAndExiting = false,
    nextLabel = tt("continue"),
    backLabel = mt("back"),
    skipLabel = tt("skipForNow"),
    saveAndExitLabel = mt("saveAndExitButton"),
    showBack = true,
    showSkip = false,
    showSaveAndExit = true,
    hasUnsavedWork = false,
    incompleteReason,
    className = ""
}: OnboardingNavigationFooterProps) {

    const isAnyActionPending = isLoading || isSavingAndExiting;
    const exitLabel = hasUnsavedWork ? saveAndExitLabel : mt("exitSetupButton");

    return (
        <div className={cn("pt-8 mt-10 border-t border-border", className)}>
            {/* Stated above the row rather than inside it: the reason is a sentence, and a
                sentence wedged between the Back button and Continue fights both. */}
            {isNextDisabled && incompleteReason ? (
                <p className="mb-3 flex items-start gap-1.5 text-xs text-muted-foreground" role="status">
                    <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
                    {incompleteReason}
                </p>
            ) : null}

            <div className="flex items-center justify-between">
            {/* Left side - Back button */}
            {showBack && onBack ? (
                <Button
                    variant="ghost"
                    onClick={onBack}
                    disabled={isBackDisabled || isAnyActionPending}
                    className={cn(FOOTER_ACTION, "gap-2 text-muted-foreground hover:text-foreground hover:bg-muted")}
                >
                    <ChevronLeft className="w-4 h-4" />
                    {backLabel}
                </Button>
            ) : (
                <div />
            )}

            {/* Right side - Skip / Save & Exit / Continue buttons */}
            <div className="flex items-center gap-3">
                {showSkip && onSkip && (
                    <Button
                        variant="ghost"
                        onClick={onSkip}
                        disabled={isAnyActionPending}
                        className={cn(FOOTER_ACTION, "gap-2 text-muted-foreground hover:bg-muted hover:text-foreground")}
                    >
                        {skipLabel}
                        <SkipForward className="w-4 h-4" />
                    </Button>
                )}
                {showSaveAndExit && onSaveAndExit && (
                    <Button
                        variant="ghost"
                        onClick={() => onSaveAndExit()}
                        disabled={isAnyActionPending}
                        className={cn(FOOTER_ACTION, "gap-2 text-muted-foreground hover:bg-muted hover:text-foreground")}
                        title={exitLabel}
                    >
                        <LogOut className="w-4 h-4" aria-hidden />
                        <span className="hidden sm:inline">{exitLabel}</span>
                    </Button>
                )}
                <StatusButton
                    onClick={onNext}
                    disabled={isNextDisabled}
                    status={isLoading ? "loading" : "idle"}
                    className={cn(FOOTER_ACTION, "min-w-[140px] font-semibold")}
                    labels={{ idle: nextLabel, loading: mt("savingShort"), success: mt("saved") }}
                />
            </div>
            </div>
        </div>
    );
}
