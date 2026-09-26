import { useEffect, useMemo, useState, useRef } from "react";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import { CheckCircle, ClipboardList } from "@/components/ui/manager-icons";
import { ApplicationRequirementsWizard } from "@/components/manager/requirements";
import type { ApplicationRequirementsWizardHandle } from "@/components/manager/requirements";
import {
  resolveApplicantRequirements,
  resolveCustomRequirements,
  resolveDocumentRequirementsUnique,
  type LocationRequirements,
  type ResolvedRequirement,
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
   * saved — the same shape the availability step's review uses, and the reason this screen
   * does NOT have the kitchen step's staleness: it re-reads on every arrival instead of
   * rendering a copy some other component filled.
   *
   * The `id > 0` guard is deliberately NOT applied. `{ id: -1 }` means "no row saved yet",
   * and the endpoint still answers it with the platform DEFAULTS — which are exactly what
   * the wizard rendered and what the manager reviewed, so they are the truthful thing to
   * show. Rejecting the payload left every section blank for a manager who accepted the
   * defaults without touching a switch.
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
      if (!cancelled && row && typeof row === "object") setSaved(row);
    })();
    return () => { cancelled = true; };
  }, [isSummary, selectedLocationId]);

  /**
   * The manager's decisions, by NAME.
   *
   * Counts ("3 of 13 required") told the manager how many switches they had left on, which
   * is not a thing anyone can check — they came here to see what a chef will be asked for.
   * These are read off the very field lists the wizard renders (see `types.ts`), so the
   * review cannot describe a different form from the one that produced it.
   *
   * A switch that is OFF is reported as OPTIONAL rather than dropped: it is still a decision
   * the manager made, and leaving it out would hide what they turned off.
   */
  const requirementSections = useMemo(() => {
    const toGroups = (rows: ResolvedRequirement[]) => {
      const required = rows.filter((row) => row.required);
      const optional = rows.filter((row) => !row.required);
      const toRow = (row: ResolvedRequirement) => ({
        key: row.key,
        label: row.label,
        value: row.description ?? "",
        // The name is the information here; the description annotates it.
        emphasis: "label" as const,
      });
      return [
        {
          key: "required",
          title: mt("requirementsSummaryRequired"),
          count: required.length,
          // An empty required list is a FACT worth stating, not a gap: "every field here is
          // optional" is a very different contract from "this section is broken".
          rows: required.length > 0
            ? required.map(toRow)
            : [{ key: "none-required", value: mt("requirementsSummaryNothingRequired") }],
        },
        {
          key: "optional",
          title: mt("requirementsSummaryOptional"),
          count: optional.length,
          rows: optional.length > 0
            ? optional.map(toRow)
            : [{ key: "none-optional", value: mt("requirementsSummaryNothingOptional") }],
        },
      ];
    };

    return [
      {
        key: "info",
        title: mt("requirementsSummaryInfo"),
        groups: toGroups(saved ? resolveApplicantRequirements(saved) : []),
      },
      {
        key: "documents",
        title: mt("requirementsSummaryDocuments"),
        groups: toGroups(resolveDocumentRequirementsUnique(saved)),
      },
      {
        key: "custom",
        title: mt("requirementsSummaryCustom"),
        groups: (() => {
          const rows = resolveCustomRequirements(saved);
          if (rows.length === 0) {
            return [{ key: "none", title: "", rows: [{ key: "no-custom", value: mt("requirementsSummaryNoCustom") }] }];
          }
          return toGroups(rows);
        })(),
      },
    ];
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
       *
       * Each section splits into Required and Optional, and the SPLIT is the marking: a
       * per-row "Required" pill under a heading that already says Required is six
       * repetitions of a fact already stated. Marking everything marks nothing.
       */}
      {isSummary && (
        <StepSummary
          heading={{ title: mt("requirementsSummaryHeading"), part: 0 }}
          sections={requirementSections}
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
