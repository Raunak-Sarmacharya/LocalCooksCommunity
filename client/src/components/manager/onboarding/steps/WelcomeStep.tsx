import React from "react";
import { mt } from "@/i18n/manager";
import { ArrowRight, Building, ChefHat, Clock, CreditCard, Package, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useManagerOnboarding } from "../ManagerOnboardingContext";
import { cn } from "@/lib/utils";

const SETUP_STEPS = [
  {
    icon: Building,
    titleKey: "welcomeStepBusinessTitle",
    descKey: "welcomeStepBusinessDesc",
    required: true,
  },
  {
    icon: ChefHat,
    titleKey: "welcomeStepKitchenTitle",
    descKey: "welcomeStepKitchenDesc",
    required: true,
  },
  {
    icon: Clock,
    titleKey: "welcomeStepAvailabilityTitle",
    descKey: "welcomeStepAvailabilityDesc",
    required: true,
  },
  {
    icon: CreditCard,
    titleKey: "welcomeStepPaymentsTitle",
    descKey: "welcomeStepPaymentsDesc",
    required: true,
  },
  {
    icon: Package,
    titleKey: "welcomeStepStorageTitle",
    descKey: "welcomeStepStorageDesc",
    required: false,
  },
  {
    icon: Wrench,
    titleKey: "welcomeStepEquipmentTitle",
    descKey: "welcomeStepEquipmentDesc",
    required: false,
  },
] as const;

export default function WelcomeStep() {
  const { handleNext } = useManagerOnboarding();

  return (
    <div className="animate-in fade-in duration-500">
      <div className="text-center mb-8">
        <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100 tracking-tight mb-1">{mt("letSSetUpYourKitchen")}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">{mt("aFewQuickStepsToGetYourSpaceReadyForChefsToDiscoverAndBook")}</p>
      </div>

      <div className="flex items-center justify-center gap-2 mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-xs">
          <Clock className="w-3.5 h-3.5" />
          <span>{mt("about5Minutes")}</span>
        </div>
      </div>

      <div className="grid gap-2 mb-10">
        {SETUP_STEPS.map((step, index) => (
          <StepCard
            key={step.titleKey}
            icon={step.icon}
            title={mt(step.titleKey)}
            description={mt(step.descKey)}
            required={step.required}
            index={index}
          />
        ))}
      </div>

      <div className="flex flex-col items-center gap-4">
        <Button
          size="lg"
          onClick={() => handleNext()}
          className={cn(
            "h-12 px-8 text-base font-medium",
            "",
            "shadow-sm hover:shadow-md transition-all duration-200"
          )}
        >{mt("getStarted")}<ArrowRight className="ml-2 w-4 h-4" />
        </Button>
        <p className="text-xs text-slate-400 dark:text-slate-500">{mt("youCanSaveAndContinueAnytime")}</p>
      </div>
    </div>
  );
}

interface StepCardProps {
  icon: React.ElementType;
  title: string;
  description: string;
  required: boolean;
  index: number;
}

function StepCard({ icon: Icon, title, description, required }: StepCardProps) {
  return (
    <div
      className={cn(
        "group flex items-center gap-3 p-3 rounded-lg transition-all duration-200",
        "hover:bg-slate-50 dark:hover:bg-slate-800/50"
      )}
    >
      <div className={cn(
        "w-8 h-8 rounded-md flex items-center justify-center shrink-0",
        required
          ? "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
          : "bg-slate-50 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500"
      )}>
        <Icon className="w-4 h-4" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn(
            "text-sm font-medium",
            required ? "text-slate-700 dark:text-slate-300" : "text-slate-500 dark:text-slate-400"
          )}>
            {title}
          </span>
          {!required && (
            <span className="text-[10px] text-slate-400 dark:text-slate-500">{mt("optional")}</span>
          )}
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {description}
        </p>
      </div>
    </div>
  );
}
