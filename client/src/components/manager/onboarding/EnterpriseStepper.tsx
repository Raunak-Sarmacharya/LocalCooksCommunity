import React from 'react';
import { useManagerOnboarding } from './ManagerOnboardingContext';
import { cn } from "@/lib/utils";
import { Check, Circle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

const EnterpriseStepper = () => {
    const {
        visibleSteps,
        currentStepIndex,
        completedSteps,
        goToStep,
    } = useManagerOnboarding();

    return (
        <div className="h-full flex flex-col bg-muted/30 border-r border-border">
            <div className="p-6 border-b border-border bg-background">
                <h2 className="text-lg font-bold tracking-tight text-foreground">Setup Wizard</h2>
                <p className="text-sm text-muted-foreground mt-1">Get your kitchen ready for chefs</p>
            </div>

            <ScrollArea className="flex-1 py-6 px-4">
                <div className="space-y-1 relative">
                    {/* Vertical Line */}
                    <div className="absolute left-[19px] top-4 bottom-4 w-[2px] bg-border z-0" />

                    {visibleSteps.map((step: any, index: number) => {
                        const isActive = index === currentStepIndex;
                        const isCompleted = completedSteps[step.id];
                        const isOptional = step.metadata?.isOptional;
                        const label = step.metadata?.label || step.payload?.title;

                        let statusIcon;
                        let statusClass;

                        if (isCompleted) {
                            statusIcon = <Check className="w-4 h-4 text-primary-foreground" />;
                            statusClass = "bg-primary border-primary ring-4 ring-primary/20";
                        } else if (isActive) {
                            statusIcon = <Circle className="w-4 h-4 text-primary fill-primary/20" />;
                            statusClass = "bg-background border-primary ring-4 ring-primary/10 z-10";
                        } else {
                            statusIcon = <div className="w-2 h-2 rounded-full bg-muted-foreground/40" />;
                            statusClass = "bg-background border-border";
                        }

                        return (
                            <div
                                key={step.id}
                                onClick={() => {
                                    // Allow clicking on completed steps or current step
                                    if (isCompleted || isActive) {
                                        goToStep(step.id);
                                    }
                                }}
                                className={cn(
                                    "relative z-10 flex items-center gap-3 p-3 rounded-lg transition-all duration-200 group",
                                    isActive ? "bg-background shadow-sm border border-border" : "hover:bg-muted/50",
                                    (isCompleted || isActive) ? "cursor-pointer" : "cursor-default"
                                )}
                            >
                                {/* Icon Circle */}
                                <div className={cn(
                                    "w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0 transition-all duration-300",
                                    statusClass
                                )}>
                                    {statusIcon}
                                </div>

                                {/* Text Content */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between">
                                        <p className={cn(
                                            "text-sm font-medium truncate",
                                            isActive ? "text-foreground" : isCompleted ? "text-foreground/80" : "text-muted-foreground"
                                        )}>
                                            {label}
                                        </p>
                                        {isOptional && !isCompleted && (
                                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 text-muted-foreground font-normal">
                                                Optional
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </ScrollArea>

            <div className="p-4 border-t border-border bg-background">
                <Alert className="py-2">
                    <AlertDescription className="text-xs">
                        Completing required steps unlocks bookings.
                    </AlertDescription>
                </Alert>
            </div>
        </div>
    );
};

export default EnterpriseStepper;
