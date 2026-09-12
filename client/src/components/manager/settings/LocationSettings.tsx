/**
 * Location Settings Component
 * Manages timezone and location-specific settings
 */

import { useCallback, useEffect, useState } from "react";
import { mt } from "@/i18n/manager";
import { Globe, Image as ImageIcon } from "@/components/ui/manager-icons";
import { StatusButton } from "@/components/ui/status-button";
import { useStatusButton } from "@/hooks/use-status-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_TIMEZONE } from "@/utils/timezone-utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSessionFileUpload } from "@/hooks/useSessionFileUpload";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import { SettingsFileUpload } from "./SettingsFileUpload";
import { ChefPageHeader } from "@/components/chef/ui";

interface Location {
  id: number;
  name: string;
  address: string;
  description?: string | null;
  logoUrl?: string;
  timezone?: string;
}

interface LocationSettingsProps {
  location: Location;
  onSave: (updates: any) => Promise<unknown>;
  embedded?: boolean;
}

export default function LocationSettings({ location, onSave, embedded = false }: LocationSettingsProps) {
  const [name, setName] = useState(location.name);
  const [address, setAddress] = useState(location.address || '');
  const [description, setDescription] = useState(location.description || '');
  const [logoUrl, setLogoUrl] = useState(location.logoUrl || '');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const timezone = DEFAULT_TIMEZONE;
  const { uploadFile, isUploading } = useSessionFileUpload({
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
  });
  const isDirty = name.trim() !== location.name || address.trim() !== (location.address || '') || description.trim() !== (location.description || '') || !!logoFile;

  useEffect(() => {
    setName(location.name);
    setAddress(location.address || '');
    setDescription(location.description || '');
    setLogoUrl(location.logoUrl || '');
    setLogoFile(null);
  }, [location.id, location.name, location.address, location.description, location.logoUrl]);

  const saveAction = useStatusButton(
    useCallback(async () => {
      const uploaded = logoFile ? await uploadFile(logoFile, 'location-logos') : null;
      if (logoFile && !uploaded) throw new Error('Logo upload failed');
      await onSave({
        locationId: location.id,
        name: name.trim(),
        address: address.trim(),
        // Send an empty string so the backend can clear an existing description.
        // `undefined` is intentionally ignored by the update route.
        description: description.trim(),
        logoUrl: uploaded?.url || logoUrl || undefined,
        timezone: DEFAULT_TIMEZONE,
      });
      if (uploaded) {
        setLogoUrl(uploaded.url);
        setLogoFile(null);
      }
    }, [onSave, location.id, name, address, description, logoFile, logoUrl, uploadFile]),
  );

  return (
    <div className="space-y-4">
      {!embedded && <ChefPageHeader title={mt("locationSettings")} description={`Configure location-specific settings for ${location.name}.`} />}

      {/* Location Info */}
      <Card>
        <CardHeader className="p-4 pb-3">
          <CardTitle className="text-lg">{mt("locationDetails")}</CardTitle>
          <CardDescription>{mt("basicInformationAboutThisLocation")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-4 pt-0">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="location-name">{mt("locationName")}</Label>
              <Input id="location-name" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location-address">{mt("address")}</Label>
              <Input id="location-address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Street, city, province, postal code" />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="location-description">Location Description</Label>
              <Textarea id="location-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Provide a description of this location to display publicly" rows={4} />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="location-logo">Location logo</Label>
              <div className="flex items-center gap-3 rounded-lg border p-3">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                  {logoUrl && !logoFile ? <img src={getR2ProxyUrl(logoUrl)} alt={`${location.name} logo`} className="h-full w-full object-cover" /> : <ImageIcon className="h-5 w-5 text-muted-foreground" />}
                </div>
                <div className="min-w-0 flex-1">
                  <SettingsFileUpload id="location-logo" accept="image/jpeg,image/png,image/webp" file={logoFile} label="Choose location logo" hint="JPG, PNG or WebP · max 4.5 MB" disabled={isUploading} onChange={setLogoFile} />
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 flex justify-end">
            <StatusButton
              status={saveAction.status}
              onClick={saveAction.execute}
              disabled={!isDirty || !name.trim() || !address.trim() || isUploading}
              labels={{ idle: mt("saveSettings"), loading: mt("savingShort"), success: mt("saved") }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
