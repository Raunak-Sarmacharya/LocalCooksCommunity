/**
 * Location Requirements Settings
 * Wrapper component that uses the new ApplicationRequirementsWizard
 * Maintains backward compatibility with existing usage
 */

import { forwardRef } from "react";
import {
  ApplicationRequirementsWizard,
  type ApplicationRequirementsWizardHandle,
} from "./requirements";

interface LocationRequirementsSettingsProps {
  locationId: number;
  onSaveSuccess?: () => void;
  /** Notify the parent when the page has unsaved changes, so it can gate its own
   *  navigation with the shared unsaved-changes guard. */
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * Forwards both the dirty signal and the imperative handle, because the parent's
 * guard needs to *read* whether anything is unsaved (a state signal) and
 * *trigger* a save before leaving (a ref). A component that only forwarded one
 * could show the dialog but never satisfy its "Save and leave" action.
 */
const LocationRequirementsSettings = forwardRef<
  ApplicationRequirementsWizardHandle,
  LocationRequirementsSettingsProps
>(function LocationRequirementsSettings({ locationId, onSaveSuccess, onDirtyChange }, ref) {
  return (
    <ApplicationRequirementsWizard
      ref={ref}
      locationId={locationId}
      onSaveSuccess={onSaveSuccess}
      onDirtyChange={onDirtyChange}
    />
  );
});

export default LocationRequirementsSettings;
