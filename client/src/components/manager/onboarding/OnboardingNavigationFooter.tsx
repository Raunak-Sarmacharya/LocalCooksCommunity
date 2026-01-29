import React from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

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
        <div className={`flex items-center justify-between pt-6 border-t border-border mt-8 ${className}`}>
            {showBack && onBack ? (
                <Button
                    variant="outline"
                    onClick={onBack}
                    disabled={isBackDisabled || isLoading}
                    className="gap-2"
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
                className="gap-2 min-w-[140px]"
            >
                {isLoading ? (
                    <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Saving...
                    </>
                ) : (
                    <>
                        {nextLabel}
                        <ChevronRight className="w-4 h-4" />
                    </>
                )}
            </Button>
        </div>
    );
}
