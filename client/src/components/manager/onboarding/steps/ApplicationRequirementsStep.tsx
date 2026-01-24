
import React from "react";
import { Info } from "lucide-react";
import LocationRequirementsSettings from "@/components/manager/LocationRequirementsSettings";
import { useManagerOnboarding } from "../ManagerOnboardingContext";

export default function ApplicationRequirementsStep() {
  const { selectedLocationId } = useManagerOnboarding();

  if (!selectedLocationId) return null;

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
      <div>
        <h3 className="text-lg font-semibold mb-1">Application Requirements</h3>
        <p className="text-sm text-gray-600 mb-4">
          Configure which fields are required when chefs apply to your kitchens. You can make fields optional to streamline the application process.
        </p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-blue-900">
            <p className="font-semibold mb-1">Why configure this?</p>
            <p>By default, all fields are required. You can make certain fields optional to reduce friction for chefs applying to your kitchen. You can always change these settings later from your dashboard.</p>
          </div>
        </div>
      </div>

      <LocationRequirementsSettings locationId={selectedLocationId} />
    </div>
  );
}
