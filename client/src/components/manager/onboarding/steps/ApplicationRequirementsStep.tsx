import { useEffect, useMemo, useState, useRef } from "react";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import { CheckCircle, ClipboardList } from "@/components/ui/manager-icons";
import { ApplicationRequirementsWizard } from "@/components/manager/requirements";
import type { ApplicationRequirementsWizardHandle } from "@/components/manager/requirements";
import {
  STEP1_FIELD_GROUPS,
  STEP2_BUILT_IN_FIELDS,
  type LocationRequirements,
} from "@/components/manager/requirements/types";
import { auth } from "@/lib/firebase";
import { useManagerOnboarding } from "../ManagerOnboardingContext";
import { OnboardingNavigationFooter } from "../OnboardingNavigationFooter";
import { StepSummary } from "../StepSummary";
import { useStepParts } from "../use-step-parts";

/**
 * The requirements wizard is ONE surface — a single pane of settings, not a set of parts —
 * so the step has one working part and the review is the second screen.
 */
const PART_COUNT = 1;

export default function ApplicationRequirementsStep() {
  
  const {
    selectedLocationId,
    handleNext,
    handleBack,
    isFirstStep,
    hasRequirements,
    requirementsLoaded,
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

  /**
   * A finished Requirements step opens on its review. `requirementsLoaded` — not
   * `hasRequirements` — is the readiness signal: the flag is false until the fetch lands.
   */
  const { isSummary, editPart, goNext, goBack } = useStepParts({
    isComplete: Boolean(hasRequirements),
    isReady: Boolean(requirementsLoaded),
    partCount: PART_COUNT,
  });

  /**
   * The saved row, for the review.
   *
   * Read on the review rather than held in the context, so it reflects what was just
   * saved. `{ id: -1 }` is the endpoint's "no row yet" sentinel — a truthy check would
   * show a review of nothing.
   */
  const [saved, setSaved] = useState<LocationRequirements | null>(null);
  useEffect(() => {
    if (!isSummary || !selectedLocationId) return;
    let cancelled = false;
    void (async () => {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch(`/api/manager/locations/${selectedLocationId}/requirements`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok || cancelled) return;
      const row = await res.json();
      if (!cancelled && Number(row?.id) > 0) setSaved(row);
    })();
    return () => { cancelled = true; };
  }, [isSummary, selectedLocationId]);

  /**
   * How much the manager is asking for, counted off the same field lists the wizard
   * renders — so the review cannot describe a different form from the one that set it.
   */
  const requiredCounts = useMemo(() => {
    const required = (groups: typeof STEP1_FIELD_GROUPS) =>
      groups
        .flatMap((group) => group.fields)
        .filter((field) => Boolean((saved as Record<string, unknown> | null)?.[field.key as string])).length;
    return {
      info: required(STEP1_FIELD_GROUPS),
      infoTotal: STEP1_FIELD_GROUPS.flatMap((group) => group.fields).length,
      documents: required(STEP2_BUILT_IN_FIELDS),
      documentsTotal: STEP2_BUILT_IN_FIELDS.flatMap((group) => group.fields).length,
      custom: Array.isArray(saved?.customFields) ? saved.customFields.length : 0,
    };
  }, [saved]);

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
    // The review is the last screen; only IT moves the wizard on.
    if (isSummary) {
      await handleNext();
      return;
    }

    // [ENTERPRISE] Double-click guard
    if (isSaving) return;

    // Auto-save unsaved changes before moving to the review.
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

    // Re-check the saved state so the stepper and sidebar see the new record, then
    // show the review.
    if (refreshRequirements) {
      await refreshRequirements();
    }
    goNext();
  };

  const handlePartBack = () => {
    if (goBack()) return;
    handleBack();
  };

  const summaryRows = [
    {
      key: "info",
      label: mt("requirementsSummaryInfo"),
      value: mt("requirementsSummaryRequiredCount", {
        required: requiredCounts.info,
        total: requiredCounts.infoTotal,
      }),
    },
    {
      key: "documents",
      label: mt("requirementsSummaryDocuments"),
      value: mt("requirementsSummaryRequiredCount", {
        required: requiredCounts.documents,
        total: requiredCounts.documentsTotal,
      }),
    },
    {
      key: "custom",
      label: mt("requirementsSummaryCustom"),
      value: requiredCounts.custom > 0
        ? mt("requirementsSummaryCustomCount", { count: requiredCounts.custom })
        : mt("none"),
    },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {!isSummary && (
        <>
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
        </>
      )}

      {/*
       * The review. The wizard is one pane, so its rows carry no Edit of their own — three
       * buttons that all open the same form would be three ways to say one thing. The
       * heading carries the single action instead.
       */}
      {isSummary && (
        <StepSummary
          heading={{ title: mt("requirementsSummaryHeading"), part: 0 }}
          /*
           * One surface, so one group — and an untitled one: the heading above already names
           * it, and the single Edit lives there. A group heading would only say it twice.
           */
          sections={[{ key: "requirements", rows: summaryRows }]}
          onEdit={editPart}
          noteTitle={mt("requirementsRecapTitle")}
          noteBody={mt("requirementsRecapBody")}
        />
      )}

      <OnboardingNavigationFooter
        onNext={() => void handleContinue()}
        onBack={handlePartBack}
        onSaveAndExit={() => void saveAndExit()}
        /* No Back on the review: the heading's Edit already opens the one form. */
        showBack={!isSummary && !isFirstStep}
        hasUnsavedWork={wizardDirty}
        nextLabel={wizardDirty ? mt("saveAndContinue") : tt("continue")}
        isNextDisabled={!isSummary && !hasRequirements && !wizardDirty}
        isLoading={isSaving}
        isSavingAndExiting={isSubmitting}
      />
    </div>
  );
}
