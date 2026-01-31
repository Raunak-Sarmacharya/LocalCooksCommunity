import React, { useMemo } from 'react';
import { useManagerOnboarding } from './ManagerOnboardingContext';
import { cn } from "@/lib/utils";
import { 
    Check, 
    Circle, 
    MapPin, 
    ChefHat, 
    ClipboardList, 
    CreditCard, 
    Clock, 
    Package, 
    Wrench, 
    PartyPopper,
    Sparkles,
    Lock
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import Logo from "@/components/ui/logo";

// Step icon mapping for visual richness
const STEP_ICONS: Record<string, React.ElementType> = {
    'welcome': Sparkles,
    'location': MapPin,
    'create-kitchen': ChefHat,
    'application-requirements': ClipboardList,
    'payment-setup': CreditCard,
    'availability': Clock,
    'storage-listings': Package,
    'equipment-listings': Wrench,
    'completion-summary': PartyPopper,
};

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
            <div className="h-full flex flex-col bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
                {/* Premium Header with Logo */}
                <div className="p-6 border-b border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm">
                    <div className="flex items-center gap-3 mb-4">
                        <Logo variant="brand" className="h-10 w-auto" />
                        <div className="flex flex-col justify-center">
                            <span className="font-logo text-lg leading-none text-[#F51042] tracking-tight font-normal">
                                LocalCooks
                            </span>
                            <span className="text-[10px] font-sans font-medium text-gray-500/80 uppercase tracking-wider mt-0.5 leading-none">
                                for kitchens
                            </span>
                        </div>
                    </div>

                    {/* Progress Indicator */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-600 dark:text-slate-400 font-medium">
                                Progress
                            </span>
                            <span className="text-primary font-semibold">
                                {progressStats.completed}/{progressStats.total} required
                            </span>
                        </div>
                        <Progress 
                            value={progressStats.percentage} 
                            className="h-2 bg-slate-100 dark:bg-slate-800"
                        />
                    </div>
                </div>

                {/* Steps Navigation */}
                <ScrollArea className="flex-1">
                    <div className="p-4 space-y-1">
                        {visibleSteps.map((step: any, index: number) => {
                            const isActive = index === currentStepIndex;
                            const isCompleted = completedSteps[step.id];
                            const isOptional = step.metadata?.isOptional;
                            const label = step.metadata?.label || step.payload?.title;
                            const StepIcon = STEP_ICONS[step.id] || Circle;
                            
                            // Determine if step is accessible (completed or current or previous completed)
                            const isPreviousComplete = index > 0 ? completedSteps[visibleSteps[index - 1]?.id] : true;
                            const isAccessible = isCompleted || isActive || (index === 0) || isPreviousComplete;

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
                                            className={cn(
                                                "w-full relative flex items-center gap-3 p-3 rounded-xl transition-all duration-200 group text-left",
                                                isActive && "bg-primary/5 dark:bg-primary/10 border border-primary/20 shadow-sm",
                                                !isActive && isCompleted && "hover:bg-slate-50 dark:hover:bg-slate-800/50",
                                                !isActive && !isCompleted && isAccessible && "hover:bg-slate-50 dark:hover:bg-slate-800/50",
                                                !isAccessible && "opacity-50 cursor-not-allowed"
                                            )}
                                        >
                                            {/* Step Indicator */}
                                            <div className={cn(
                                                "relative w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all duration-300",
                                                isCompleted && "bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-lg shadow-emerald-500/25",
                                                isActive && !isCompleted && "bg-gradient-to-br from-primary to-primary/90 shadow-lg shadow-primary/25",
                                                !isActive && !isCompleted && "bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                                            )}>
                                                {isCompleted ? (
                                                    <Check className="w-5 h-5 text-white" strokeWidth={2.5} />
                                                ) : isActive ? (
                                                    <StepIcon className="w-5 h-5 text-white" />
                                                ) : !isAccessible ? (
                                                    <Lock className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                                                ) : (
                                                    <StepIcon className="w-5 h-5 text-slate-400 dark:text-slate-500" />
                                                )}
                                                
                                                {/* Active Pulse */}
                                                {isActive && !isCompleted && (
                                                    <span className="absolute inset-0 rounded-xl bg-primary/20 animate-ping" style={{ animationDuration: '2s' }} />
                                                )}
                                            </div>

                                            {/* Content */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className={cn(
                                                        "text-sm font-medium truncate transition-colors",
                                                        isActive && "text-primary dark:text-primary",
                                                        isCompleted && !isActive && "text-slate-700 dark:text-slate-300",
                                                        !isActive && !isCompleted && "text-slate-600 dark:text-slate-400"
                                                    )}>
                                                        {label}
                                                    </span>
                                                    {isOptional && (
                                                        <Badge 
                                                            variant="outline" 
                                                            className={cn(
                                                                "text-[10px] px-1.5 py-0 h-4 font-normal border-slate-200 dark:border-slate-700",
                                                                isCompleted ? "bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400" : "text-slate-500"
                                                            )}
                                                        >
                                                            {isCompleted ? "Done" : "Optional"}
                                                        </Badge>
                                                    )}
                                                </div>
                                                {/* Subtle description for active step */}
                                                {isActive && step.payload?.description && (
                                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                                                        {step.payload.description}
                                                    </p>
                                                )}
                                            </div>

                                            {/* Completion checkmark for non-optional completed */}
                                            {isCompleted && !isOptional && (
                                                <div className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
                                                    <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" strokeWidth={3} />
                                                </div>
                                            )}
                                        </button>
                                    </TooltipTrigger>
                                    {!isAccessible && (
                                        <TooltipContent side="right" className="text-xs">
                                            Complete previous steps first
                                        </TooltipContent>
                                    )}
                                </Tooltip>
                            );
                        })}
                    </div>
                </ScrollArea>

                {/* Footer Info */}
                <div className="p-4 border-t border-slate-200/80 dark:border-slate-800 bg-gradient-to-r from-slate-50 to-white dark:from-slate-900 dark:to-slate-900">
                    <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/50 dark:border-amber-800/30">
                        <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center shrink-0">
                            <Sparkles className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                        </div>
                        <div>
                            <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                                Almost there!
                            </p>
                            <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80 mt-0.5">
                                Complete required steps to start accepting bookings.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </TooltipProvider>
    );
};

export default EnterpriseStepper;
