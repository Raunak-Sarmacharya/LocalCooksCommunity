import { useState, useEffect, useRef } from "react";
import { ApplicationFormProvider, useApplicationForm } from "./ApplicationFormContext";
import CertificationsForm from "./CertificationsForm";
import KitchenPreferenceForm from "./KitchenPreferenceForm";
import PersonalInfoForm from "./PersonalInfoForm";
import ProgressIndicator from "./ProgressIndicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ArrowLeft, FileText } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface ApplicationFormPanelProps {
  onBack?: () => void;
  className?: string;
}

// Internal form step component
function FormStepContent({ onBack }: { onBack?: () => void }) {
  const { currentStep, goToPreviousStep } = useApplicationForm();
  const containerRef = useRef<HTMLDivElement>(null);

  // Scroll to top of container when step changes
  useEffect(() => {
    // Scroll the container into view smoothly
    if (containerRef.current) {
      containerRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    // Also reset any internal scroll
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentStep]);

  return (
    <div ref={containerRef} className="space-y-6">
      {/* Header with back button */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            if (currentStep === 1 && onBack) {
              onBack();
            } else {
              goToPreviousStep();
            }
          }}
          className="h-10 w-10 rounded-xl border border-border/50 hover:bg-muted/50"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Chef Application</h2>
          <p className="text-sm text-muted-foreground">Step {currentStep} of 3</p>
        </div>
      </div>

      {/* Progress Indicator */}
      <div className="bg-muted/30 rounded-xl p-4 border border-border/50">
        <ProgressIndicator step={currentStep} />
      </div>

      {/* Form Card - No duplicate header, forms have their own */}
      <Card className="border-border/50 shadow-sm overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-primary via-primary/80 to-primary/60" />
        <CardContent className="p-6 md:p-8">
          {/* Form Content with smooth transitions */}
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              {currentStep === 1 && <PersonalInfoForm />}
              {currentStep === 2 && <KitchenPreferenceForm />}
              {currentStep === 3 && <CertificationsForm />}
            </motion.div>
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* Step indicators at bottom */}
      <div className="flex items-center justify-center gap-2">
        {[1, 2, 3].map((step) => (
          <div
            key={step}
            className={cn(
              "h-2 rounded-full transition-all duration-300",
              step === currentStep
                ? "w-8 bg-primary"
                : step < currentStep
                ? "w-2 bg-primary/60"
                : "w-2 bg-muted"
            )}
          />
        ))}
      </div>
    </div>
  );
}

// Main exported component
export default function ApplicationFormPanel({ onBack, className }: ApplicationFormPanelProps) {
  return (
    <ApplicationFormProvider>
      <div className={cn("w-full", className)}>
        <FormStepContent onBack={onBack} />
      </div>
    </ApplicationFormProvider>
  );
}

// Export a wrapper component for use in the dashboard that handles view mode
interface ApplicationsTabContentProps {
  applications: any[];
  hasActiveApplication: boolean;
  onStartApplication: () => void;
  onCancelApplication: (type: string, id: number) => void;
  isSellerApplicationFullyApproved: boolean;
  renderApplicationCard: (app: any) => React.ReactNode;
  renderEmptyState: () => React.ReactNode;
  renderStripeConnect?: () => React.ReactNode;
}

export function ApplicationsTabWithForm({
  applications,
  hasActiveApplication,
  onStartApplication,
  onCancelApplication,
  isSellerApplicationFullyApproved,
  renderApplicationCard,
  renderEmptyState,
  renderStripeConnect,
}: ApplicationsTabContentProps) {
  const [viewMode, setViewMode] = useState<'list' | 'form'>('list');

  // If showing the form
  if (viewMode === 'form') {
    return (
      <ApplicationFormPanel onBack={() => setViewMode('list')} />
    );
  }

  // Show the list view
  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-sm">
            <FileText className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-foreground">Sell on LocalCooks</h2>
            <p className="text-muted-foreground mt-1">Your seller application and verification status</p>
          </div>
        </div>
        {!hasActiveApplication && (
          <Button 
            size="lg" 
            onClick={() => setViewMode('form')}
            className="rounded-xl shadow-lg shadow-primary/10"
          >
            Start New Application
          </Button>
        )}
      </div>

      {/* Stripe Connect - only when fully approved */}
      {isSellerApplicationFullyApproved && renderStripeConnect && renderStripeConnect()}

      {/* Applications list or empty state */}
      {applications && applications.length > 0 ? (
        <div className="grid gap-6">
          {applications.map((app) => renderApplicationCard(app))}
        </div>
      ) : (
        renderEmptyState()
      )}
    </div>
  );
}
