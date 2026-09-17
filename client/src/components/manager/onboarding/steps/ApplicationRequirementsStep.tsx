import { useEffect, useState, useRef } from "react";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import { CheckCircle, ClipboardList } from "@/components/ui/manager-icons";
import { ApplicationRequirementsWizard } from "@/components/manager/requirements";
import type { ApplicationRequirementsWizardHandle } from "@/components/manager/requirements";
import { useManagerOnboarding } from "../ManagerOnboardingContext";
import { OnboardingNavigationFooter } from "../OnboardingNavigationFooter";

export default function ApplicationRequirementsStep() {
  
  const {
    selectedLocationId,
    handleNext,
    handleBack,
    isFirstStep,
    hasRequirements,
    refreshRequirements,
    setUnsavedChanges,
    registerStepSave,
    saveAndExit,
    isSubmitting,
  } = useManagerOnboarding();

  const [isSaving, setIsSaving] = useState(false);
  // Mirror of the wizard's internal dirty flag. `wizardRef.current` is a ref, so
  // reading it during render never re-renders this component — the CTA below would
  // stay disabled forever on a location with no saved requirements row yet.
  const [wizardDirty, setWizardDirty] = useState(false);
  const wizardRef = useRef<ApplicationRequirementsWizardHandle>(null);

  // Let the wizard's unsaved-changes guard speak for this step.
  useEffect(() => {
    setUnsavedChanges(wizardDirty);
  }, [wizardDirty, setUnsavedChanges]);

  useEffect(() => {
    registerStepSave(async () => {
      try {
        await wizardRef.current?.save();
        return true;
      } catch {
        return false;
      }
    });
    return () => registerStepSave(null);
  }, [registerStepSave]);

  if (!selectedLocationId) return null;

  const handleContinue = async () => {
    // [ENTERPRISE] Double-click guard
    if (isSaving) return;

    // Auto-save unsaved changes before any navigation
    if (wizardRef.current?.hasUnsavedChanges) {
      setIsSaving(true);
      try {
        await wizardRef.current.save();
      } catch {
        // Save failed — toast already shown by wizard, don't navigate
        setIsSaving(false);
        return;
      }
      setIsSaving(false);
    }

    // Re-check the saved state so the stepper and sidebar see the new record,
    // then hand off to the next onboarding step.
    if (refreshRequirements) {
      await refreshRequirements();
    }
    setTimeout(() => {
      handleNext();
    }, 100);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Status line — what the chef will see, and what this step still needs */}
      <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
        {hasRequirements ? (
          <CheckCircle className="mt-px h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ClipboardList className="mt-px h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {hasRequirements ? mt("requirementsSaved2") : mt("configureRequirements2")}
          </span>
          {` — ${hasRequirements ? mt("modifyBelowOrContinue") : mt("saveSettingsToContinue")}`}
        </p>
      </div>

      {/* Requirements Wizard - Compact mode for onboarding */}
      <ApplicationRequirementsWizard
        ref={wizardRef}
        locationId={selectedLocationId}
        onSaveSuccess={refreshRequirements}
        compact
        hideNavigation
        onDirtyChange={setWizardDirty}
      />

      <OnboardingNavigationFooter
        onNext={handleContinue}
        onBack={handleBack}
        onSaveAndExit={() => void saveAndExit()}
        showBack={!isFirstStep}
        nextLabel={wizardDirty ? mt("saveAndContinue") : tt("continue")}
        isNextDisabled={!hasRequirements && !wizardDirty}
        isLoading={isSaving}
        isSavingAndExiting={isSubmitting}
      />
    </div>
  );
}
