/**
 * Location Requirements Settings
 * Wrapper component that uses the new ApplicationRequirementsWizard
 * Maintains backward compatibility with existing usage
 */

import { ApplicationRequirementsWizard } from './requirements';

interface LocationRequirementsSettingsProps {
  locationId: number;
  locationName?: string;
  onSaveSuccess?: () => void;
}

export default function LocationRequirementsSettings({
  locationId,
  locationName,
  onSaveSuccess,
}: LocationRequirementsSettingsProps) {
  return (
    <ApplicationRequirementsWizard
      locationId={locationId}
      locationName={locationName}
      onSaveSuccess={onSaveSuccess}
    />
  );
}
