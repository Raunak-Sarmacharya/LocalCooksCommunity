/**
 * Location details: name, address, logo. The same fields and controls as onboarding's location step (settings rows, the
 * service-area address search, the logo field), so a location reads the same wherever it is edited.
 *
 * On the Location page the page frame owns saving (header "Save changes" + the unsaved-changes guard): pass
 * `onDirtyChange` and `saveRef`. Standalone, the form shows its own Save once something changed.
 */

import { useCallback, useEffect, useImperativeHandle, useState, type Ref } from "react";
import { mt } from "@/i18n/manager";
import { StatusButton } from "@/components/ui/status-button";
import { useStatusButton } from "@/hooks/use-status-button";
import { Card, CardContent } from "@/components/ui/card";
import { DEFAULT_TIMEZONE } from "@/utils/timezone-utils";
import { Input } from "@/components/ui/input";
import AddressAutocomplete from "@/components/ui/address-autocomplete";
import { SERVICE_PROVINCE } from "@shared/service-area";
import { SettingsRow } from "./SettingsRow";
import { LogoPhotoField } from "@/components/manager/kitchen/KitchenPhotoFields";
import { useSessionFileUpload } from "@/hooks/useSessionFileUpload";
import { useToast } from "@/hooks/use-toast";
import { ChefPageHeader } from "@/components/chef/ui";

interface Location {
  id: number;
  name: string;
  address: string;
  logoUrl?: string;
  timezone?: string;
}

export type LocationDetailsHandle = { save: () => Promise<boolean> };

interface LocationSettingsProps {
  location: Location;
  onSave: (updates: any) => Promise<unknown>;
  embedded?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  saveRef?: Ref<LocationDetailsHandle>;
}

const ACCEPTED_LOGO_TYPES = ["image/jpeg", "image/png", "image/webp"];

export default function LocationSettings({ location, onSave, embedded = false, onDirtyChange, saveRef }: LocationSettingsProps) {
  const { toast } = useToast();
  const [name, setName] = useState(location.name);
  const [address, setAddress] = useState(location.address || "");
  const [logoUrl, setLogoUrl] = useState(location.logoUrl || "");
  const { uploadFile, isUploading } = useSessionFileUpload({
    allowedTypes: ACCEPTED_LOGO_TYPES,
    onError: (message) => toast({ title: mt("uploadFailed2"), description: message, variant: "destructive" }),
  });
  const isDirty = name.trim() !== location.name || address.trim() !== (location.address || "") || logoUrl !== (location.logoUrl || "");
  const valid = !!name.trim() && !!address.trim();

  useEffect(() => {
    setName(location.name);
    setAddress(location.address || "");
    setLogoUrl(location.logoUrl || "");
  }, [location.id, location.name, location.address, location.logoUrl]);

  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const save = useCallback(async () => {
    await onSave({ locationId: location.id, name: name.trim(), address: address.trim(), logoUrl: logoUrl || undefined, timezone: DEFAULT_TIMEZONE });
  }, [onSave, location.id, name, address, logoUrl]);
  const saveAction = useStatusButton(save);

  useImperativeHandle(saveRef, () => ({
    save: async () => {
      if (!isDirty) return true;
      if (!valid) { toast({ title: mt("error"), description: mt("locationNameAddressRequired"), variant: "destructive" }); return false; }
      try { await save(); return true; } catch { return false; }
    },
  }), [isDirty, valid, save, toast]);

  const uploadLogo = async (file: File) => {
    const result = await uploadFile(file, "location-logos");
    if (result?.url) setLogoUrl(result.url);
  };

  return (
    <div className="space-y-4">
      {!embedded && <ChefPageHeader title={mt("locationSettings")} description={mt("locationDetailsDescription", { location: location.name })} />}
      <Card>
        <CardContent className="divide-y divide-border p-0">
          <SettingsRow id="location-name" label={mt("businessName")} required hint={mt("thisNameWillBeDisplayedToChefsBrowsingYourKitchen")}>
            <Input id="location-name" value={name} onChange={(event) => setName(event.target.value)} className="w-64" />
          </SettingsRow>
          <SettingsRow id="location-address" label={mt("businessAddress")} required hint={mt("businessAddressHint")}>
            <AddressAutocomplete value={address} onChange={(value) => setAddress(value)} placeholder={mt("startTypingYourAddress")}
              className="w-80" province={SERVICE_PROVINCE} />
          </SettingsRow>
          <SettingsRow id="location-logo" label={mt("locationLogo")} layout="stacked" hint={mt("locationLogoHint")}>
            <LogoPhotoField value={logoUrl} onSelectFile={(file) => void uploadLogo(file)} onRemove={() => setLogoUrl("")} disabled={isUploading} className="max-w-lg" />
          </SettingsRow>
        </CardContent>
      </Card>
      {!saveRef && (isDirty || saveAction.status !== "idle") && <div className="flex justify-end">
        <StatusButton status={saveAction.status} onClick={saveAction.execute} disabled={!isDirty || !valid || isUploading}
          labels={{ idle: mt("saveSettings"), loading: mt("savingShort"), success: mt("saved") }} />
      </div>}
    </div>
  );
}
