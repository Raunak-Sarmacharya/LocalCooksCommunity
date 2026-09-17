import React, { useMemo } from 'react';
import { mt } from "@/i18n/manager";
import { useManagerOnboarding } from "./ManagerOnboardingContext";
import { cn } from "@/lib/utils";
import { Check, Circle, MapPin, Calendar, ClipboardList, CreditCard, Clock, Package, CookingPot, PartyPopper, Handshake, Lock } from "@/components/ui/manager-icons";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import Logo from "@/components/ui/logo";

// Step icon mapping for visual richness
const STEP_ICONS: Record<string, React.ElementType> = {
    'welcome': Handshake,
    'location': MapPin,
    'create-kitchen': Calendar,
    'application-requirements': ClipboardList,
    'payment-setup': CreditCard,
    'availability': Clock,
    'storage-listings': Package,
    'equipment-listings': CookingPot,
    'completion-summary': PartyPopper,
};

/**
 * Onboarding sidebar.
 *
 * One row per step: a single leading glyph, the label, and a trailing state word.
 * No tinted tiles, no gradient fills, no pulse — the row background is the only
 * thing that marks the current step, which keeps the list readable at a glance.
 */
const EnterpriseStepper = () => {
    const {
        visibleSteps,
        currentStepIndex,
        completedSteps,
        goToStep,
    } = useManagerOnboarding();

    // Calculate progress
    const progressStats = useMemo(() => {
        const requiredSteps = visibleSteps.filter((s: any) => !s.metadata?.isOptional);
        const completedRequired = requiredSteps.filter((s: any) => completedSteps[s.id]);
        const percentage = requiredSteps.length > 0 
            ? Math.round((completedRequired.length / requiredSteps.length) * 100) 
            : 0;
        return {
            completed: completedRequired.length,
            total: requiredSteps.length,
            percentage
        };
    }, [visibleSteps, completedSteps]);

    return (
        <TooltipProvider delayDuration={300}>
            <div className="flex h-full flex-col bg-background">
                {/* Brand + progress */}
                <div className="border-b border-border p-6">
                    <div className="flex items-center gap-3">
                        <Logo variant="brand" className="h-10 w-auto" />
                        <div className="flex min-w-0 flex-col justify-center">
                            <span className="font-logo text-lg leading-none text-[#F51042] tracking-tight font-normal">{mt("localCooks")}</span>
                            <span className="text-[10px] font-sans font-medium text-muted-foreground uppercase tracking-wider mt-0.5 leading-none">{mt("shellForKitchens")}</span>
                        </div>
                    </div>

                    {/* Progress Indicator */}
                    <div className="mt-5 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground font-medium">{mt("progress")}</span>
                            <span className="text-primary font-semibold">
                                {mt("requiredStepsCount", {
                                    completed: progressStats.completed,
                                    total: progressStats.total,
                                })}
                            </span>
                        </div>
                        <Progress 
                            value={progressStats.percentage} 
                            className="h-2 bg-muted"
                        />
                    </div>
                </div>

                {/* Steps Navigation */}
                <ScrollArea className="flex-1">
                    <nav className="space-y-1 p-3">
                        {visibleSteps.map((step: any, index: number) => {
                            const isActive = index === currentStepIndex;
                            const isCompleted = completedSteps[step.id];
                            const isOptional = step.metadata?.isOptional;
                            const label = step.metadata?.label || step.payload?.title;
                            const StepIcon = STEP_ICONS[step.id] || Circle;

                            // Determine if step is accessible (completed or current or previous completed)
                            const isPreviousComplete = index > 0 ? completedSteps[visibleSteps[index - 1]?.id] : true;
                            const isAccessible = isCompleted || isActive || (index === 0) || isPreviousComplete;

                            // The trailing tick carries completion, so the glyph
                            // keeps each step's own icon — a check in both slots
                            // said the same thing twice and cost the row its
                            // identity. Lock still wins: an unreachable step must
                            // not look reachable.
                            const Glyph = !isAccessible ? Lock : StepIcon;

                            return (
                                <Tooltip key={step.id}>
                                    <TooltipTrigger asChild>
                                        <button
                                            onClick={() => {
                                                if (isAccessible) {
                                                    goToStep(step.id);
                                                }
                                            }}
                                            disabled={!isAccessible}
                                            aria-current={isActive ? "true" : undefined}
                                            className={cn(
                                                "w-full relative flex items-center gap-3 p-3 rounded-xl transition-colors text-left",
                                                // Every reachable row must *read* as reachable: without an
                                                // explicit pointer, a completed row looks like a disabled one.
                                                isAccessible && "cursor-pointer",
                                                isActive
                                                    ? "bg-muted"
                                                    : isAccessible && "hover:bg-muted/50",
                                                !isAccessible && "opacity-50 cursor-not-allowed"
                                            )}
                                        >
                                            <Glyph
                                                className={cn(
                                                    "w-4 h-4 shrink-0",
                                                    isActive ? "text-foreground" : "text-muted-foreground"
                                                )}
                                            />

                                            <span className={cn(
                                                "flex-1 min-w-0 truncate text-sm font-medium transition-colors",
                                                isActive ? "text-foreground" : "text-muted-foreground"
                                            )}>
                                                {label}
                                            </span>

                                            {/*
                                              * A tick instead of the word "Done": the glyph is
                                              * read at a glance and keeps the trailing slot
                                              * quiet, so the labels stay the loudest thing in
                                              * the row.
                                              *
                                              * "Optional" stays a word. It is a label rather
                                              * than a state — a manager needs to know a step
                                              * *may* be skipped, and no icon carries that.
                                              */}
                                            {isCompleted ? (
                                                <Check
                                                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                                                    aria-hidden
                                                />
                                            ) : isOptional ? (
                                                <span className="shrink-0 text-[11px] text-muted-foreground">
                                                    {mt("optional")}
                                                </span>
                                            ) : null}
                                        </button>
                                    </TooltipTrigger>
                                    {!isAccessible && (
                                        <TooltipContent side="right" className="text-xs">{mt("completePreviousStepsFirst")}</TooltipContent>
                                    )}
                                </Tooltip>
                            );
                        })}
                    </nav>
                </ScrollArea>

                {/* Footer note — one line, no callout box */}
                <div className="border-t border-border p-4">
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                        {mt("completeRequiredStepsToStartAcceptingBookings")}
                    </p>
                </div>
            </div>
        </TooltipProvider>
    );
};

export default EnterpriseStepper;
