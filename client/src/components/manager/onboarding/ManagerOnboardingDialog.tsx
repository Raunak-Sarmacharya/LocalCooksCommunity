
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { useManagerOnboarding } from "./ManagerOnboardingContext";
import { componentRegistry } from "@/config/onboarding";
import EnterpriseStepper from "./EnterpriseStepper";
import { useLocation } from "wouter";

export default function ManagerOnboardingDialog() {
  const {
    isOpen,
    setIsOpen,
    currentStepData,
  } = useManagerOnboarding();

  // Get the component for the current step
  const StepComponent = currentStepData?.componentKey
    ? componentRegistry[currentStepData.componentKey as keyof typeof componentRegistry]
    : null;

  const [location] = useLocation();
  if (location === "/manager/setup") return null;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-w-5xl w-full p-0 gap-0 overflow-hidden h-[80vh]">
        <DialogTitle className="sr-only">Manager Setup Wizard</DialogTitle>

        <div className="grid grid-cols-12 h-full">
          {/* Sidebar (3 cols) */}
          <div className="col-span-3 h-full border-r border-slate-200">
            <EnterpriseStepper />
          </div>

          {/* Main Content (9 cols) */}
          <div className="col-span-9 h-full flex flex-col bg-slate-50/50">
            {/* Header Area */}
            <div className="px-8 py-6 border-b border-slate-100 bg-white">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                {currentStepData?.title || 'Setup'}
              </h1>
              <p className="text-slate-500 mt-1">
                {currentStepData?.description}
              </p>
            </div>

            {/* Scrollable Form Area */}
            <div className="flex-1 overflow-y-auto p-8">
              <div className="max-w-2xl mx-auto">
                {StepComponent ? (
                  <StepComponent />
                ) : (
                  <div className="flex items-center justify-center h-40 text-muted-foreground bg-white rounded-lg border border-dashed">
                    Component not found: {currentStepData?.componentKey}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
