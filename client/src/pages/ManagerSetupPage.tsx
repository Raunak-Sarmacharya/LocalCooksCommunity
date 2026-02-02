import React, { useEffect, useRef } from "react";
import { useManagerOnboarding } from "@/components/manager/onboarding/ManagerOnboardingContext";
import { componentRegistry } from "@/config/onboarding";
import EnterpriseStepper from "@/components/manager/onboarding/EnterpriseStepper";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
    X, 
    ChevronRight, 
    Home,
    HelpCircle,
    MapPin,
    ChefHat,
    ClipboardList,
    CreditCard,
    Clock,
    Package,
    Wrench,
    PartyPopper,
    Sparkles
} from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// Step icon mapping
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

export default function ManagerSetupPage() {
    return (
        <TooltipProvider>
            <ManagerSetupPageContent />
        </TooltipProvider>
    );
}

function ManagerSetupPageContent() {
    const {
        currentStepData,
        currentStepIndex,
        visibleSteps,
        completedSteps,
        saveAndExit,
    } = useManagerOnboarding();

    const [, setLocation] = useLocation();
    const contentRef = useRef<HTMLDivElement>(null);
    const prevStepIndex = useRef(currentStepIndex);

    // Scroll to top when step changes
    useEffect(() => {
        if (prevStepIndex.current !== currentStepIndex && contentRef.current) {
            contentRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }
        prevStepIndex.current = currentStepIndex;
    }, [currentStepIndex]);

    // [ENTERPRISE] Use context's saveAndExit which persists progress before navigating
    const handleExit = async () => {
        await saveAndExit();
    };

    // Get the component for the current step
    const StepComponent = currentStepData?.componentKey
        ? componentRegistry[currentStepData.componentKey as keyof typeof componentRegistry]
        : null;

    // Get current step info
    const currentStep = visibleSteps[currentStepIndex];
    const isOptional = currentStep?.metadata?.isOptional;
    const StepIcon = STEP_ICONS[currentStep?.id] || Sparkles;

    // Calculate step number (excluding optional from count for display)
    const requiredSteps = visibleSteps.filter((s: any) => !s.metadata?.isOptional);
    const currentRequiredIndex = requiredSteps.findIndex((s: any) => s.id === currentStep?.id);
    const stepNumber = currentRequiredIndex >= 0 ? currentRequiredIndex + 1 : null;

    return (
        <div className="min-h-screen w-full bg-gradient-to-br from-slate-50 via-slate-50 to-slate-100 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 flex overflow-hidden">
            {/* Premium Left Sidebar */}
            <aside className="w-80 border-r border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-xl shadow-slate-200/50 dark:shadow-slate-950/50 z-20 flex flex-col h-screen">
                <EnterpriseStepper />
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 flex flex-col h-screen overflow-hidden relative">
                {/* Premium Top Bar */}
                <header className="h-16 border-b border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md flex items-center justify-between px-6 flex-shrink-0 z-10">
                    <div className="flex items-center gap-4">
                        {/* Breadcrumb */}
                        <nav className="hidden md:flex items-center gap-2 text-sm">
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <button 
                                        onClick={() => setLocation('/manager/dashboard')}
                                        className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                                    >
                                        <Home className="w-4 h-4" />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent>Dashboard</TooltipContent>
                            </Tooltip>
                            <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600" />
                            <span className="text-slate-600 dark:text-slate-400 font-medium">Setup Wizard</span>
                            <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600" />
                            <span className="text-slate-900 dark:text-slate-100 font-medium">
                                {currentStepData?.title || 'Loading...'}
                            </span>
                        </nav>
                    </div>

                    <div className="flex items-center gap-3">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button 
                                    variant="ghost" 
                                    size="icon"
                                    className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                                >
                                    <HelpCircle className="w-5 h-5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Need help?</TooltipContent>
                        </Tooltip>
                        
                        <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={handleExit} 
                            className="border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                            <X className="w-4 h-4 mr-2" />
                            Save & Exit
                        </Button>
                    </div>
                </header>

                {/* Content Container with scroll */}
                <div 
                    ref={contentRef}
                    className="flex-1 overflow-y-auto scroll-smooth"
                >
                    <div className="p-6 md:p-10 lg:p-12">
                        <div className="max-w-3xl mx-auto w-full">
                            {/* Step Header - Minimal & Consistent */}
                            <div className="mb-6 animate-in fade-in duration-300">
                                <div className="flex items-center gap-3">
                                    {/* Step Icon - Smaller, cleaner */}
                                    <div className={cn(
                                        "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                                        completedSteps[currentStep?.id] 
                                            ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
                                            : "bg-primary/10 dark:bg-primary/20 text-primary"
                                    )}>
                                        <StepIcon className="w-5 h-5" />
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        {/* Step indicator */}
                                        <div className="flex items-center gap-2 mb-0.5">
                                            <span className="text-xs text-slate-400 dark:text-slate-500 font-medium">
                                                {stepNumber ? `Step ${stepNumber} of ${requiredSteps.length}` : (isOptional ? 'Optional' : '')}
                                            </span>
                                            {completedSteps[currentStep?.id] && (
                                                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                                                    • Completed
                                                </span>
                                            )}
                                        </div>
                                        {/* Title & Description inline */}
                                        <div className="flex items-baseline gap-2 flex-wrap">
                                            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                                                {currentStepData?.title || 'Setup'}
                                            </h1>
                                            {currentStepData?.description && (
                                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                                    — {currentStepData.description}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Step Content Card */}
                            <div className={cn(
                                "bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800",
                                "shadow-xl shadow-slate-200/50 dark:shadow-slate-950/50",
                                "p-6 md:p-8 lg:p-10",
                                "animate-in fade-in slide-in-from-bottom-4 duration-500"
                            )}>
                                {StepComponent ? (
                                    <StepComponent />
                                ) : (
                                    <div className="flex flex-col items-center justify-center p-12 text-slate-400 dark:text-slate-500">
                                        <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                                            <Sparkles className="w-6 h-6 animate-pulse" />
                                        </div>
                                        <p className="text-sm font-medium">Loading step...</p>
                                    </div>
                                )}
                            </div>

                            {/* Bottom Spacer for better scroll experience */}
                            <div className="h-12" />
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
