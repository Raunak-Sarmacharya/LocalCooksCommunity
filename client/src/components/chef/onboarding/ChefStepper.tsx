import { cn } from "@/lib/utils";
import { useChefOnboarding } from "./ChefOnboardingContext";
import { Check, Circle, Store, Building } from "lucide-react";

export function ChefStepper() {
  const {
    visibleSteps,
    currentStepIndex,
    completedSteps,
    goToStep,
    selectedPaths,
  } = useChefOnboarding();

  return (
    <div className="space-y-6">
      {/* Path Indicators */}
      {selectedPaths.length > 0 && (
        <div className="flex gap-2 mb-4">
          {selectedPaths.includes('seller') && (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-primary/10 rounded-full text-xs font-medium text-primary">
              <Store className="h-3 w-3" />
              Seller
            </div>
          )}
          {selectedPaths.includes('kitchen') && (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-blue-500/10 rounded-full text-xs font-medium text-blue-600">
              <Building className="h-3 w-3" />
              Kitchen
            </div>
          )}
        </div>
      )}

      {/* Steps */}
      <nav aria-label="Progress">
        <ol className="space-y-2">
          {visibleSteps.map((step, index) => {
            const isActive = index === currentStepIndex;
            const isCompleted = completedSteps[step.id] ?? false;
            const isPast = index < currentStepIndex;
            const isClickable = isPast || isCompleted;

            // Determine step color based on path
            const stepPath = step.metadata?.path;
            const getStepColor = () => {
              if (isActive) return "bg-primary text-primary-foreground";
              if (isCompleted || isPast) return "bg-primary/20 text-primary";
              if (stepPath === 'seller') return "bg-primary/5 text-primary/50";
              if (stepPath === 'kitchen') return "bg-blue-500/5 text-blue-500/50";
              return "bg-muted text-muted-foreground";
            };

            return (
              <li key={step.id}>
                <button
                  onClick={() => isClickable && goToStep(step.id)}
                  disabled={!isClickable}
                  className={cn(
                    "w-full flex items-center gap-3 p-3 rounded-lg transition-all text-left",
                    isActive && "bg-primary/5 border border-primary/20",
                    !isActive && isClickable && "hover:bg-muted/50 cursor-pointer",
                    !isClickable && "cursor-default opacity-60"
                  )}
                >
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium transition-colors",
                      getStepColor()
                    )}
                  >
                    {isCompleted || isPast ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <span>{index + 1}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className={cn(
                        "text-sm font-medium truncate",
                        isActive && "text-foreground",
                        !isActive && "text-muted-foreground"
                      )}
                    >
                      {step.metadata?.label || step.payload?.title || `Step ${index + 1}`}
                    </p>
                    {step.metadata?.isOptional && (
                      <p className="text-[10px] text-muted-foreground">Optional</p>
                    )}
                  </div>
                  {stepPath && stepPath !== 'both' && (
                    <div
                      className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        stepPath === 'seller' ? "bg-primary" : "bg-blue-500"
                      )}
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}

export default ChefStepper;
