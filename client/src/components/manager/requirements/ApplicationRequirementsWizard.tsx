import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
/**
 * Application Requirements Wizard
 *
 * Configures the half of the chef application a manager owns — the "Kitchen
 * Documents" (tier 2) requirements. The "Request to apply" half is
 * platform-wide and set by Local Cooks admins, so it is not editable here.
 *
 * The surface is deliberately single-pane: one card stack, one primary action.
 * The page hosting it already names the surface, so this component renders no
 * heading, no step strip and no footer beyond the save action.
 */

import { useState, useEffect, useCallback, useImperativeHandle, useMemo, useRef, forwardRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { StatusButton } from "@/components/ui/status-button";
import { cn } from "@/lib/utils";
import { Loader2, AlertCircle } from "@/components/ui/manager-icons";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";


import { RequirementsStepTwo } from "./RequirementsStepTwo";
import { LocationRequirements } from "./types";

/**
 * Structural equality.
 *
 * The requirements payload contains arrays (the custom-field list), so an
 * identity check would call two equal values different whenever a re-render
 * rebuilds them — which is exactly how a "dirty" flag gets stuck on.
 */
export function isSameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;

  return aKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      isSameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

export interface ApplicationRequirementsWizardHandle {
  /** Trigger a save of the current requirements state. Returns a promise that resolves when save completes. */
  save: () => Promise<void>;
  /** Whether there are unsaved changes */
  hasUnsavedChanges: boolean;
}

interface ApplicationRequirementsWizardProps {
  locationId: number;
  onSaveSuccess?: () => void;
  /** Compact mode for embedding in onboarding flow */
  compact?: boolean;
  /** Hide the save footer when the parent owns the action */
  hideNavigation?: boolean;
  /** Notify the parent when the dirty state changes — the parent cannot read the
   *  imperative ref during render, so it needs a state signal to gate its own CTA. */
  onDirtyChange?: (dirty: boolean) => void;
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const currentFirebaseUser = auth.currentUser;
  if (!currentFirebaseUser) {
    throw new Error(tt('firebaseUserNotAvailable'));
  }
  const token = await currentFirebaseUser.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export const ApplicationRequirementsWizard = forwardRef<ApplicationRequirementsWizardHandle, ApplicationRequirementsWizardProps>(function ApplicationRequirementsWizard({
  locationId,
  onSaveSuccess,
  compact = false,
  hideNavigation = false,
  onDirtyChange,
}, ref) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [requirements, setRequirements] = useState<Partial<LocationRequirements>>({});
  /**
   * What the server currently holds. The working copy above is compared against
   * this to decide whether anything is actually unsaved — a change that is
   * toggled back to its original value is not a change.
   */
  const [baseline, setBaseline] = useState<Partial<LocationRequirements>>({});

  // Fetch current requirements
  const { data, isLoading, error } = useQuery<LocationRequirements>({
    queryKey: [`/api/manager/locations/${locationId}/requirements`],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/locations/${locationId}/requirements`, {
        credentials: 'include',
        headers,
      });
      if (!response.ok) throw new Error(tt('failedToFetchRequirements'));
      return response.json();
    },
    enabled: !!locationId,
  });

  /**
   * The last server payload this form was seeded from. A refetch that returns
   * the same values must not overwrite edits in progress — react-query refetches
   * on window focus, so a manager who tabs away mid-edit would otherwise come
   * back to a silently reverted form.
   */
  const seededRef = useRef<LocationRequirements | undefined>(undefined);

  // Initialize requirements from fetched data
  useEffect(() => {
    if (!data) return;
    if (seededRef.current && isSameValue(seededRef.current, data)) return;
    seededRef.current = data;
    setRequirements(data);
    setBaseline(data);
  }, [data]);

  /**
   * Derived, never latched. Comparing field-by-field is what lets a toggle that
   * is flipped back read as clean again.
   */
  const isDirty = useMemo(() => {
    const keys = new Set([...Object.keys(baseline), ...Object.keys(requirements)]);
    for (const key of Array.from(keys)) {
      const current = (requirements as Record<string, unknown>)[key];
      const saved = (baseline as Record<string, unknown>)[key];
      if (!isSameValue(current, saved)) return true;
    }
    return false;
  }, [requirements, baseline]);

  // Report the derived state upward — the parent cannot read the ref during render.
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (updates: Partial<LocationRequirements>) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/locations/${locationId}/requirements`, {
        method: 'PUT',
        headers,
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (!response.ok) {
        const error = await response.json();
        const errorMessage = error.message || error.error || 'Failed to save requirements';
        if (error.details && Array.isArray(error.details)) {
          const details = error.details
            .map((d: any) => `${d.path?.join('.') || 'field'}: ${d.message}`)
            .join(', ');
          throw new Error(`${errorMessage}. ${details}`);
        }
        throw new Error(errorMessage);
      }
      return response.json();
    },
    onSuccess: (_result, updates) => {
      queryClient.invalidateQueries({ queryKey: [`/api/manager/locations/${locationId}/requirements`] });
      queryClient.invalidateQueries({ queryKey: [`location-${locationId}`], exact: false });
      // Advance the baseline to what was just persisted, so the save button
      // clears immediately instead of flickering until the refetch lands.
      setBaseline(prev => ({ ...prev, ...updates }));

      toast({ title: mt("requirementsSaved"),
        description: mt("yourApplicationRequirementsHaveBeenUpdatedSuccessfully"),
      });

      onSaveSuccess?.();
    },
    onError: (error: Error) => {
      toast({ title: mt("saveFailed"),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleRequirementsChange = useCallback((updates: Partial<LocationRequirements>) => {
    setRequirements(prev => ({ ...prev, ...updates }));
  }, []);

  const handleSave = useCallback(() => {
    saveMutation.mutate(requirements);
  }, [saveMutation, requirements]);

  // Expose save trigger to parent via ref
  useImperativeHandle(ref, () => ({
    save: () => {
      return new Promise<void>((resolve, reject) => {
        saveMutation.mutate(requirements, {
          onSuccess: () => resolve(),
          onError: (err) => reject(err),
        });
      });
    },
    hasUnsavedChanges: isDirty,
  }), [saveMutation, requirements, isDirty]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{mt("loadingRequirements")}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <AlertCircle className="h-6 w-6 text-destructive" />
        <p className="text-sm font-medium text-foreground">{mt("failedToLoadRequirements")}</p>
        <p className="max-w-sm text-xs text-muted-foreground">{(error as Error).message}</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-6', compact && 'space-y-4')}>
      <RequirementsStepTwo
        requirements={requirements}
        onRequirementsChange={handleRequirementsChange}
      />

      {/* One save for the whole page, present only while something is unsaved —
          the page stays quiet at rest. Kept mounted through the success
          animation, like the Booking Policies page. */}
      {!hideNavigation && (isDirty || saveMutation.isPending) && (
        <div className="flex items-center justify-end border-t border-border pt-6">
          <StatusButton
            onClick={handleSave}
            status={saveMutation.isPending ? "loading" : "idle"}
            labels={{ idle: mt("saveChanges"), loading: mt("savingShort"), success: mt("saved") }}
          />
        </div>
      )}
    </div>
  );
});

export default ApplicationRequirementsWizard;
