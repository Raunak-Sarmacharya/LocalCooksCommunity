
import React, { useEffect } from "react";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription 
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, Circle } from "lucide-react";
import { useManagerOnboarding } from "./ManagerOnboardingContext";
import { useFirebaseAuth } from "@/hooks/use-auth";

// Steps
import WelcomeStep from "./steps/WelcomeStep";
import LocationStep from "./steps/LocationStep";
import CreateKitchenStep from "./steps/CreateKitchenStep";
import ApplicationRequirementsStep from "./steps/ApplicationRequirementsStep";
import PaymentSetupStep from "./steps/PaymentSetupStep";
import StorageListingsStep from "./steps/StorageListingsStep";
import EquipmentListingsStep from "./steps/EquipmentListingsStep";
import { STEPS } from "./ManagerOnboardingContext";

const STEP_COMPONENTS: Record<number, React.ComponentType> = {
  0: WelcomeStep,
  1: LocationStep,
  2: CreateKitchenStep,
  3: ApplicationRequirementsStep,
  4: PaymentSetupStep,
  5: StorageListingsStep,
  6: EquipmentListingsStep
};

export function ManagerOnboardingDialog() {
  const { 
    isOpen, 
    setIsOpen, 
    currentStep, 
    visibleSteps, 
    completedSteps, 
    handleNext, 
    handleBack, 
    handleSkip,
    isLoadingLocations,
    locations
  } = useManagerOnboarding();

  const { user } = useFirebaseAuth();

  // Auto-open logic
  useEffect(() => {
    if (user && !isLoadingLocations) {
      // Logic: if not fully onboarded, open.
      // We check `completedSteps` which comes from profile.
      const isComplete = completedSteps['all_completed']; // Assuming this flag exists
      // Or check if we have skipped steps. 
      // Simplified: If no location or explicitly tracked as not done.
      if (!isComplete && (locations.length === 0 || !completedSteps['onboarding_completed'])) {
         setIsOpen(true);
      }
    }
  }, [user, isLoadingLocations, locations, completedSteps, setIsOpen]);

  const CurrentComponent = STEP_COMPONENTS[currentStep] || WelcomeStep;
  const isLastStep = currentStep === 6; // or strictly check generic index

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-w-4xl h-[85vh] p-0 gap-0 overflow-hidden flex bg-white sm:rounded-2xl">
        {/* Sidebar */}
        <div className="w-1/3 bg-slate-50 border-r p-6 hidden md:flex flex-col">
          <div className="mb-8">
            <h2 className="text-xl font-bold bg-gradient-to-r from-rose-500 to-orange-500 bg-clip-text text-transparent">
              Setup Wizard
            </h2>
            <p className="text-sm text-gray-500 mt-1">Get your kitchen ready for chefs</p>
          </div>

          <ScrollArea className="flex-1 -mr-4 pr-4">
            <div className="space-y-4">
              {visibleSteps.map((step, index) => {
                const isActive = step.id === currentStep;
                const isCompleted = step.id < currentStep || completedSteps[step.id]; // Simplified check
                
                return (
                  <div 
                    key={step.id} 
                    className={`flex items-start gap-3 transition-colors ${isActive ? 'opacity-100' : 'opacity-60'}`}
                  >
                    <div className="mt-0.5">
                      {isActive ? (
                        <div className="h-6 w-6 rounded-full bg-rose-100 border-2 border-rose-500 flex items-center justify-center text-xs font-bold text-rose-700">
                          {index + 1}
                        </div>
                      ) : isCompleted ? (
                        <CheckCircle2 className="h-6 w-6 text-green-500" />
                      ) : (
                        <Circle className="h-6 w-6 text-gray-300" />
                      )}
                    </div>
                    <div>
                      <p className={`text-sm font-semibold ${isActive ? 'text-gray-900' : 'text-gray-600'}`}>
                        {step.title}
                      </p>
                      {isActive && (
                        <p className="text-xs text-gray-500 mt-1 leading-snug">
                          {step.description}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0">
          <DialogHeader className="p-6 pb-2 md:hidden">
            <DialogTitle>Setup Wizard</DialogTitle>
          </DialogHeader>
          
          <ScrollArea className="flex-1 p-6 h-full">
            <div className="max-w-2xl mx-auto pb-20"> {/* pb-20 for footer space */}
              <CurrentComponent />
            </div>
          </ScrollArea>

          {/* Footer */}
          <div className="p-4 border-t bg-gray-50/50 flex justify-between items-center gap-4">
            <Button
              variant="ghost"
              onClick={handleBack}
              disabled={currentStep === 0}
              className="text-gray-500 hover:text-gray-900"
            >
              Back
            </Button>
            
            <div className="flex gap-2">
              {currentStep > 0 && !isLastStep && (
                <Button variant="ghost" onClick={handleSkip} className="text-gray-400 hover:text-gray-600">
                  Skip Setup
                </Button>
              )}
              {currentStep > 3 && ( // Allow skipping listings
                 <Button variant="outline" onClick={handleNext}>
                   Skip for Now
                 </Button>
              )}
              <Button onClick={() => handleNext()} className="bg-[#F51042] hover:bg-[#F51042]/90 min-w-[100px]">
                {isLastStep ? "Finish" : "Next"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
