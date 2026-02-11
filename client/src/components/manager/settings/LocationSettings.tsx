/**
 * Location Settings Component
 * Manages timezone and location-specific settings
 */

import { useCallback } from 'react';
import { Globe } from 'lucide-react';
import { StatusButton } from '@/components/ui/status-button';
import { useStatusButton } from '@/hooks/use-status-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DEFAULT_TIMEZONE } from '@/utils/timezone-utils';

interface Location {
  id: number;
  name: string;
  address: string;
  timezone?: string;
}

interface LocationSettingsProps {
  location: Location;
  onSave: (updates: any) => Promise<unknown>;
}

export default function LocationSettings({ location, onSave }: LocationSettingsProps) {
  const timezone = DEFAULT_TIMEZONE;

  const saveAction = useStatusButton(
    useCallback(async () => {
      await onSave({
        locationId: location.id,
        timezone: DEFAULT_TIMEZONE,
      });
    }, [onSave, location.id]),
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Location Settings</h2>
        <p className="text-muted-foreground">
          Configure location-specific settings for {location.name}.
        </p>
      </div>

      {/* Location Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Globe className="h-5 w-5 text-cyan-600" />
            <div>
              <CardTitle className="text-lg">Location Details</CardTitle>
              <CardDescription>Basic information about this location</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-700">Location Name</label>
              <div className="mt-1 p-3 bg-slate-50 rounded-lg text-slate-900">
                {location.name}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Address</label>
              <div className="mt-1 p-3 bg-slate-50 rounded-lg text-slate-900">
                {location.address || 'Not specified'}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Timezone Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Globe className="h-5 w-5 text-cyan-600" />
            <div>
              <CardTitle className="text-lg">Timezone Settings</CardTitle>
              <CardDescription>
                The timezone for this location is locked to Newfoundland Time
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700">Location Timezone</label>
            <div className="mt-1.5 w-full max-w-md border border-gray-300 rounded-lg px-4 py-2.5 bg-gray-50 text-gray-700 flex items-center gap-2">
              <Globe className="h-4 w-4 text-gray-400" />
              <span>Newfoundland Time (GMT-3:30)</span>
              <span className="ml-auto text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded">Locked</span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              All booking times for this location will be interpreted in Newfoundland Time. 
              This affects when bookings are considered "past", "upcoming", or "active".
            </p>
          </div>

          <div className="p-3 bg-cyan-50 border border-cyan-200 rounded-lg">
            <p className="text-sm text-cyan-800">
              The timezone is currently locked to Newfoundland Time for all locations on the platform.
              This ensures consistent booking times across all kitchens.
            </p>
          </div>

          <StatusButton
            status={saveAction.status}
            onClick={saveAction.execute}
            variant="outline"
            labels={{ idle: "Save Settings", loading: "Saving", success: "Saved" }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
