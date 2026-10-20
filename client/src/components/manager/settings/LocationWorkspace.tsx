/**
 * Location: the location's own settings in one page, in the same section-tab layout as My Kitchens (header with the
 * location's name and address, an underline tab bar, one section at a time).
 *
 * Saving follows My Kitchens: Details saves from the page header, only while something changed; Booking defaults
 * keeps its per-section saves. Unsaved edits are guarded (tab switches here, leaving the page in the dashboard).
 */
import { useEffect, useRef, useState } from "react";
import { mt } from "@/i18n/manager";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusButton } from "@/components/ui/status-button";
import { useStatusButton } from "@/hooks/use-status-button";
import { ChefPageHeader } from "@/components/chef/ui";
import { MapPin, Shield, ClipboardCheck, FileText, CreditCard } from "@/components/ui/manager-icons";
import { UnsavedChangesDialog } from "@/components/manager/UnsavedChangesDialog";
import StripeConnectSetup from "@/components/manager/StripeConnectSetup";
import LocationSettings, { type LocationDetailsHandle } from "./LocationSettings";
import LicenseSettings from "./LicenseSettings";
import BookingRulesSettings, { type BookingPoliciesHandle } from "./BookingRulesSettings";
import FacilityDocsSettings from "./FacilityDocsSettings";
import { kitchenLicenseState } from "@shared/kitchen-license";
import { isLocationSection, type LocationSection } from "@/lib/manager-location-navigation";

const TAB_TRIGGER =
  "group shrink-0 gap-2 rounded-none border-b-2 border-transparent px-0.5 py-2.5 font-normal text-muted-foreground transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:shadow-none";
const TAB_ICON = "h-4 w-4 shrink-0 transition-colors group-data-[state=active]:text-primary";
const HEADER_LINK = "rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground";

export type LocationWorkspaceHandle = { saveAllChanges: () => Promise<boolean> };

const readSection = (): LocationSection => {
  const value = new URLSearchParams(window.location.search).get("section");
  return isLocationSection(value) ? value : "details";
};

export default function LocationWorkspace({ location, onSaveLocation, onRefresh, onOpenRequirements, onDirtyChange, saveRef }: {
  location: any;
  onSaveLocation: (updates: any) => Promise<unknown>;
  onRefresh: () => void;
  onOpenRequirements: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  saveRef?: React.MutableRefObject<LocationWorkspaceHandle | null>;
}) {
  const [section, setSection] = useState<LocationSection>(readSection);
  const [detailsDirty, setDetailsDirty] = useState(false);
  const [bookingDirty, setBookingDirty] = useState(false);
  const [pendingSection, setPendingSection] = useState<LocationSection | null>(null);
  const [savingBeforeSwitch, setSavingBeforeSwitch] = useState(false);
  const detailsRef = useRef<LocationDetailsHandle>(null);
  const bookingRef = useRef<BookingPoliciesHandle>(null);

  const dirty = (section === "details" && detailsDirty) || (section === "booking" && bookingDirty);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  // Back/forward and links that change only ?section.
  useEffect(() => {
    const sync = () => setSection(readSection());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const saveCurrent = async () => section === "details" ? (await detailsRef.current?.save()) ?? true
    : section === "booking" ? (await bookingRef.current?.saveAllChanges()) ?? true : true;
  if (saveRef) saveRef.current = { saveAllChanges: saveCurrent };
  const saveAction = useStatusButton(async () => { if (!(await saveCurrent())) throw new Error("save-failed"); });

  const go = (next: LocationSection) => {
    setSection(next);
    const url = new URL(window.location.href);
    url.searchParams.set("section", next);
    window.history.replaceState(window.history.state, "", url);
  };
  const requestSection = (value: string) => {
    if (!isLocationSection(value) || value === section) return;
    if (dirty) setPendingSection(value); else go(value);
  };

  // The license is the only section that can need the manager's action; flag it on its tab.
  const licenseState = kitchenLicenseState(location);
  const licenseNeedsAttention = ["not_uploaded", "rejected", "expired", "expiring_soon"].includes(licenseState);
  const showHeaderSave = section === "details" && (detailsDirty || saveAction.status !== "idle");

  return (
    <div className="w-full min-w-0 max-w-full space-y-6">
      <ChefPageHeader
        title={location.name}
        description={location.address || mt("locationPageDescription")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" className={HEADER_LINK} onClick={onOpenRequirements}>
              <ClipboardCheck className="mr-1.5 h-4 w-4" />{mt("navApplicationRequirements")}
            </Button>
            {showHeaderSave && <StatusButton status={saveAction.status} onClick={saveAction.execute}
              labels={{ idle: mt("saveChanges"), loading: mt("savingShort"), success: mt("saved") }} />}
          </div>
        }
      />
      <Tabs value={section} onValueChange={requestSection} className="w-full min-w-0 max-w-full">
        <TabsList className="mb-6 h-auto w-full min-w-0 max-w-full justify-start gap-6 overflow-x-auto rounded-none border-b border-border bg-transparent p-0 text-muted-foreground">
          <TabsTrigger value="details" className={TAB_TRIGGER}><MapPin className={TAB_ICON} />{mt("details")}</TabsTrigger>
          <TabsTrigger value="license" className={TAB_TRIGGER}>
            <Shield className={TAB_ICON} />{mt("locTabLicense")}
            {licenseNeedsAttention && <span className="h-2 w-2 rounded-full bg-amber-500" aria-label={mt("licenseNeedsAttention")} role="img" />}
          </TabsTrigger>
          <TabsTrigger value="booking" className={TAB_TRIGGER}><ClipboardCheck className={TAB_ICON} />{mt("locationBookingDefaults")}</TabsTrigger>
          <TabsTrigger value="documents" className={TAB_TRIGGER}><FileText className={TAB_ICON} />{mt("locTabDocuments")}</TabsTrigger>
          <TabsTrigger value="payments" className={TAB_TRIGGER}><CreditCard className={TAB_ICON} />{mt("locTabPayments")}</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="mt-0">
          <LocationSettings location={location} onSave={onSaveLocation} embedded onDirtyChange={setDetailsDirty} saveRef={detailsRef} />
        </TabsContent>
        <TabsContent value="license" className="mt-0">
          <LicenseSettings location={location} onRefresh={onRefresh} embedded />
        </TabsContent>
        <TabsContent value="booking" className="mt-0 space-y-4">
          <p className="text-sm text-muted-foreground">{mt("locationBookingDefaultsIntro")}</p>
          <BookingRulesSettings ref={bookingRef} location={location} onSave={onSaveLocation} onDirtyChange={setBookingDirty} hideHeader />
        </TabsContent>
        <TabsContent value="documents" className="mt-0">
          <FacilityDocsSettings location={location} embedded />
        </TabsContent>
        <TabsContent value="payments" className="mt-0">
          {/* The same component as Profile › Payments: one Stripe account, one source of truth. */}
          <div className="rounded-xl border bg-card p-5"><StripeConnectSetup /></div>
        </TabsContent>
      </Tabs>
      <UnsavedChangesDialog
        open={pendingSection !== null}
        onOpenChange={(open) => !open && setPendingSection(null)}
        description={mt("locationUnsavedChangesDescription")}
        isSaving={savingBeforeSwitch}
        onDiscard={() => { const next = pendingSection; setPendingSection(null); if (section === "details") setDetailsDirty(false); if (section === "booking") setBookingDirty(false); if (next) go(next); }}
        onSave={async () => { setSavingBeforeSwitch(true); const saved = await saveCurrent(); setSavingBeforeSwitch(false); if (saved && pendingSection) { const next = pendingSection; setPendingSection(null); go(next); } }}
      />
    </div>
  );
}
