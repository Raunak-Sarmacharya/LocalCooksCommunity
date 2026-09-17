import React from "react";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import { Button } from "@/components/ui/button";
import { StatusButton } from "@/components/ui/status-button";
import { ChevronLeft, LogOut, SkipForward } from "@/components/ui/manager-icons";
import { cn } from "@/lib/utils";

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
    className = ""
}: OnboardingNavigationFooterProps) {

    const isAnyActionPending = isLoading || isSavingAndExiting;

    return (
        <div className={cn(
            "flex items-center justify-between pt-8 mt-10",
            "border-t border-border",
            className
        )}>
            {/* Left side - Back button */}
            {showBack && onBack ? (
                <Button
                    variant="ghost"
                    onClick={onBack}
                    disabled={isBackDisabled || isAnyActionPending}
                    className="gap-2 text-muted-foreground hover:text-foreground hover:bg-muted"
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
                        className="gap-2 text-muted-foreground hover:text-foreground"
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
                        className="gap-2 text-muted-foreground hover:text-foreground"
                        title={saveAndExitLabel}
                    >
                        <LogOut className="w-4 h-4" aria-hidden />
                        <span className="hidden sm:inline">{saveAndExitLabel}</span>
                    </Button>
                )}
                <StatusButton
                    onClick={onNext}
                    disabled={isNextDisabled}
                    status={isLoading ? "loading" : "idle"}
                    size="lg"
                    className={cn("min-w-[140px] font-semibold")}
                    labels={{ idle: nextLabel, loading: mt("savingShort"), success: mt("saved") }}
                />
            </div>
        </div>
    );
}
