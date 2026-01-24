import React from "react";
import { useManagerOnboarding } from "@/components/manager/onboarding/ManagerOnboardingContext";
import { ManagerOnboardingProvider } from "@/components/manager/onboarding/ManagerOnboardingProvider";
import { componentRegistry } from "@/config/onboarding";
import EnterpriseStepper from "@/components/manager/onboarding/EnterpriseStepper";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { useLocation } from "wouter";

export default function ManagerSetupPage() {
    return (
        <ManagerOnboardingProvider>
            <ManagerSetupPageContent />
        </ManagerOnboardingProvider>
    );
}

function ManagerSetupPageContent() {
    const {
        currentStepData,
        handleSkip // Using skip as "Complete Later" / Exit
    } = useManagerOnboarding();

    const [, setLocation] = useLocation();

    const handleExit = () => {
        // Navigate back to dashboard
        setLocation("/manager/dashboard");
    };

    // Get the component for the current step
    const StepComponent = currentStepData?.componentKey
        ? componentRegistry[currentStepData.componentKey as keyof typeof componentRegistry]
        : null;

    return (
        <div className="min-h-screen w-full bg-slate-50 flex overflow-hidden">
            {/* Full Left Sidebar */}
            <aside className="w-80 border-r border-slate-200 bg-white shadow-sm z-10 flex flex-col h-screen">
                <EnterpriseStepper />
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 flex flex-col h-screen overflow-hidden relative">
                {/* Top Bar */}
                <header className="h-16 border-b border-slate-200 bg-white flex items-center justify-between px-8 flex-shrink-0">
                    <div className="flex items-center gap-2">
                        <img src="/logo_small.png" alt="LocalCooks" className="h-8 w-8" onError={(e) => e.currentTarget.style.display = 'none'} />
                        <span className="font-semibold text-slate-900 md:inline hidden">Manager Setup</span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={handleExit} className="text-slate-500 hover:text-slate-900">
                        <X className="w-4 h-4 mr-2" />
                        Save & Exit
                    </Button>
                </header>

                {/* Content Container */}
                <div className="flex-1 overflow-y-auto bg-slate-50 p-6 md:p-12">
                    <div className="max-w-3xl mx-auto w-full">
                        {/* Dynamic Header based on Step */}
                        <div className="mb-8">
                            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                                {currentStepData?.title || 'Setup'}
                            </h1>
                            <p className="text-lg text-slate-500 mt-2">
                                {currentStepData?.description}
                            </p>
                        </div>

                        {/* Step Content */}
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 md:p-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            {StepComponent ? (
                                <StepComponent />
                            ) : (
                                <div className="flex items-center justify-center p-12 text-slate-400 border-2 border-dashed rounded-lg">
                                    Loading Step...
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
