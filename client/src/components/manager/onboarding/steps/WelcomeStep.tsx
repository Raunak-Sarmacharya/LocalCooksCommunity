import React from "react";
import { ArrowRight, Building, ChefHat, Clock, CreditCard, Package, Wrench, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useManagerOnboarding } from "../ManagerOnboardingContext";
import { cn } from "@/lib/utils";

// Notion-inspired minimal step data
const SETUP_STEPS = [
  { 
    icon: Building, 
    title: "Business", 
    description: "Add your business details and contact info",
    required: true 
  },
  { 
    icon: ChefHat, 
    title: "Kitchen Space", 
    description: "Configure your kitchen details and pricing",
    required: true 
  },
  { 
    icon: Clock, 
    title: "Availability", 
    description: "Set when chefs can book your space",
    required: true 
  },
  { 
    icon: CreditCard, 
    title: "Payments", 
    description: "Connect Stripe to receive payouts",
    required: true 
  },
  { 
    icon: Package, 
    title: "Storage", 
    description: "Offer storage options for chefs",
    required: false 
  },
  { 
    icon: Wrench, 
    title: "Equipment", 
    description: "List available equipment rentals",
    required: false 
  },
];

export default function WelcomeStep() {
  const { handleNext } = useManagerOnboarding();

  return (
    <div className="animate-in fade-in duration-500">
      {/* Hero Section - Compact & Clean */}
      <div className="text-center mb-8">
        <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100 tracking-tight mb-1">
          Let's set up your kitchen
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          A few quick steps to get your space ready for chefs to discover and book.
        </p>
      </div>

      {/* Time Estimate - Subtle */}
      <div className="flex items-center justify-center gap-2 mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-xs">
          <Clock className="w-3.5 h-3.5" />
          <span>About 5 minutes</span>
        </div>
      </div>

      {/* Steps Grid - Notion-style minimal cards */}
      <div className="grid gap-2 mb-10">
        {SETUP_STEPS.map((step, index) => (
          <StepCard 
            key={step.title}
            icon={step.icon}
            title={step.title}
            description={step.description}
            required={step.required}
            index={index}
          />
        ))}
      </div>

      {/* CTA Section */}
      <div className="flex flex-col items-center gap-4">
        <Button
          size="lg"
          onClick={() => handleNext()}
          className={cn(
            "h-12 px-8 text-base font-medium",
            "bg-[#F51042] hover:bg-[#E10F38] text-white",
            "shadow-sm hover:shadow-md transition-all duration-200"
          )}
        >
          Get Started
          <ArrowRight className="ml-2 w-4 h-4" />
        </Button>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          You can save and continue anytime
        </p>
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

function StepCard({ icon: Icon, title, description, required, index }: StepCardProps) {
  return (
    <div 
      className={cn(
        "group flex items-center gap-3 p-3 rounded-lg transition-all duration-200",
        "hover:bg-slate-50 dark:hover:bg-slate-800/50"
      )}
    >
      {/* Icon */}
      <div className={cn(
        "w-8 h-8 rounded-md flex items-center justify-center shrink-0",
        required 
          ? "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400" 
          : "bg-slate-50 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500"
      )}>
        <Icon className="w-4 h-4" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn(
            "text-sm font-medium",
            required ? "text-slate-700 dark:text-slate-300" : "text-slate-500 dark:text-slate-400"
          )}>
            {title}
          </span>
          {!required && (
            <span className="text-[10px] text-slate-400 dark:text-slate-500">
              Optional
            </span>
          )}
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {description}
        </p>
      </div>
    </div>
  );
}
