import React from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Loader2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface OnboardingNavigationFooterProps {
    onNext: () => void;
    onBack?: () => void;
    isNextDisabled?: boolean;
    isBackDisabled?: boolean;
    isLoading?: boolean;
    nextLabel?: string;
    backLabel?: string;
    showBack?: boolean;
    className?: string;
}

export function OnboardingNavigationFooter({
    onNext,
    onBack,
    isNextDisabled = false,
    isBackDisabled = false,
    isLoading = false,
    nextLabel = "Continue",
    backLabel = "Back",
    showBack = true,
    className = ""
}: OnboardingNavigationFooterProps) {
    return (
        <div className={cn(
            "flex items-center justify-between pt-8 mt-10",
            "border-t border-slate-200/80 dark:border-slate-800",
            className
        )}>
            {showBack && onBack ? (
                <Button
                    variant="ghost"
                    onClick={onBack}
                    disabled={isBackDisabled || isLoading}
                    className="gap-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800"
                >
                    <ChevronLeft className="w-4 h-4" />
                    {backLabel}
                </Button>
            ) : (
                <div />
            )}

            <Button
                onClick={onNext}
                disabled={isNextDisabled || isLoading}
                size="lg"
                className={cn(
                    "gap-2 min-w-[160px] font-semibold",
                    "bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary/80",
                    "shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30",
                    "transition-all duration-200"
                )}
            >
                {isLoading ? (
                    <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Saving...
                    </>
                ) : (
                    <>
                        {nextLabel}
                        <ArrowRight className="w-4 h-4" />
                    </>
                )}
            </Button>
        </div>
    );
}
