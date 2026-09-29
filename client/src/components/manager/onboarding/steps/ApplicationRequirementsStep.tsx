import { useEffect, useMemo, useState, useRef } from "react";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import { CheckCircle, ClipboardList } from "@/components/ui/manager-icons";
import { ApplicationRequirementsWizard } from "@/components/manager/requirements";
import type { ApplicationRequirementsWizardHandle } from "@/components/manager/requirements";
import {
  resolveCustomRequirements,
  resolveDocumentRequirements,
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
    isRequirementsComplete,
    requirementsLoaded,
    refreshRequirements,
    setUnsavedChanges,
    registerStepSave,
    saveAndExit,
    isSubmitting,
    trackStepCompletion,
  } = useManagerOnboarding();

  const [isSaving, setIsSaving] = useState(false);
  // Mirror of the wizard's internal dirty flag. `wizardRef.current` is a ref, so
  // reading it during render never re-renders this component — the CTA below would
  // stay disabled forever on a location with no saved requirements row yet.
  const [wizardDirty, setWizardDirty] = useState(false);
  const wizardRef = useRef<ApplicationRequirementsWizardHandle>(null);

  /**
   * A finished Requirements step opens on its review.
   *
   * `requirementsLoaded` — not the completeness flag — is the readiness signal: completeness is
   * false until the fetch lands, so deciding on it would open every revisit at the form.
   *
   * Completeness is `isRequirementsComplete`, the rule the rail, the checklist and the summary all
   * read: a saved row OR having reached this review. Keying on `hasRequirements` alone — "a row
   * exists" — was this step disagreeing with every other surface about one fact. The pane ships
   * with the platform defaults already filled in, so the common case is a manager who reads them,
   * changes nothing and moves on, and for them no row is ever written: the rail showed the step
   * ticked while the step itself reopened the form they had just accepted.
   */
  const { isSummary, editPart, goNext, goBack } = useStepParts({
    isComplete: Boolean(isRequirementsComplete),
    isReady: Boolean(requirementsLoaded),
    partCount: PART_COUNT,
  });

  /**
   * Reaching the REVIEW is what finishes this step, and only this component knows it happened.
   *
   * The pane ships with the platform defaults already filled in, so the common case is a manager
   * who reads them, changes nothing and moves on — and writes no `location_requirements` row for
   * `hasRequirements` to see. `isRequirementsStepBehindUs` accepts "reached the review" for exactly
   * that case; without this, the only way to record it was pressing Continue, and leaving from the
   * review lost it.
   */
  useEffect(() => {
    if (!isSummary) return;
    void trackStepCompletion('application-requirements');
  }, [isSummary, trackStepCompletion]);

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
   * The manager's decisions, exactly as the wizard showed them.
   *
   * Counts ("3 of 13 required") told the manager how many switches they had left on, which
   * is not a thing anyone can check — they came here to see what a chef will be asked for.
   * So the rows are read off the very field list the wizard renders (see `types.ts`), in the
   * same order, one row per switch. Intentional structure the wizard did not display — group
   * headings, or a Required/Optional split of a list the manager saw as one — would be a
   * second interpretation of the pane, which is what this screen got wrong before.
   *
   * The applicant-information section is deliberately NOT here. Those fields are the
   * platform's standard application questions, owned by Local Cooks and set by an admin —
   * the onboarding wizard never renders them, so listing them here named thirteen switches
   * the manager had never seen and could not change. The heading's `meta` line says what
   * happens to them instead: one sentence, not a list.
   *
   * A switch that is OFF is reported as Optional rather than dropped: it is still a decision
   * the manager made, and leaving it out would hide what they turned off.
   */
  const requirementSections = useMemo(() => {
    const toRow = (row: ResolvedRequirement) => ({
      key: row.key,
      label: row.label,
      // The name is the information here; the state is the annotation on the trailing edge.
      value: row.description ?? "",
      emphasis: "label" as const,
      /*
       * Every row carries its own state.
       *
       * The wizard shows a Required/Optional word on every switch row, so the review does the
       * same and the two screens read alike. Splitting into "Required" and "Optional"
       * sub-groups instead would re-order the list into a shape the manager never saw, and
       * the reason to come here is to check the list they DID see.
       */
      tag: row.required ? mt("requirementsSummaryRequired") : mt("requirementsSummaryOptional"),
      tagStrong: row.required,
    });

    const customRows = resolveCustomRequirements(saved);

    return [
      {
        key: "documents",
        // The wizard's own card title, verbatim, so the review's heading is the string the
        // manager configured under rather than a second name for the same list.
        title: mt("step2Documents"),
        // The ONE Edit for this single-pane step. It lives here, on the heading of the list it
        // opens, rather than on the page title above: the button acts on the requirements list,
        // so it belongs on that list's own row. `heading` below therefore carries NO part —
        // a part reachable from two controls is the defect `StepSummary` exists to prevent.
        part: 0,
        rows: resolveDocumentRequirements(saved).map(toRow),
      },
      {
        key: "custom",
        title: mt("requirementsSummaryCustom"),
        rows: customRows.length > 0
          ? customRows.map(toRow)
          : [{ key: "no-custom", value: mt("requirementsSummaryNoCustom") }],
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
       * The review. The wizard is one pane, so its rows carry no Edit of their own — four
       * buttons that all open the same form would be four ways to say one thing.
       *
       * The single Edit sits on the "Chef Application Requirements" section row, right-aligned
       * above the list it opens. It used to sit on the page title, which put the action on the
       * heading of the whole screen rather than on the thing it acts on — and the title's
       * explanatory line beside it pushed the button onto a second, left-aligned line.
       *
       * `heading` deliberately carries NO `part`: `StepSummary` will not let one part be
       * reachable from two controls.
       *
       * The `meta` slot takes the one fact that does NOT belong in a list: the standard
       * applicant details and agreements are collected for every application and are not the
       * manager's to configure.
       */}
      {isSummary && (
        <StepSummary
          heading={{
            title: mt("requirementsSummaryHeading"),
            meta: mt("requirementsSummaryAlsoCollected"),
          }}
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
        /*
         * Never blocked.
         *
         * This pane shows the requirements a kitchen starts with — the platform defaults the
         * endpoint already returns. A manager who reads them and changes nothing has made a
         * decision, and there is nothing to save for the review to be truthful: the review
         * reads the same endpoint the wizard does. Gating on `hasRequirements` demanded a
         * saved row (`id > 0`), so accepting the defaults left Continue disabled forever with
         * no visible reason. The wizard still auto-saves real edits on the way through.
         */
        isNextDisabled={false}
        isLoading={isSaving}
        isSavingAndExiting={isSubmitting}
      />
    </div>
  );
}
