import { useEffect, useMemo, useState } from "react";
import { useManagerOnboarding, type LocationDraftFields } from "../ManagerOnboardingContext";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import { FileText, ExternalLink } from "@/components/ui/manager-icons";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useSessionFileUpload } from "@/hooks/useSessionFileUpload";
import {
  ACCEPTED_IMAGE_TYPES,
  LogoPhotoField,
} from "@/components/manager/kitchen/KitchenPhotoFields";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { OnboardingNavigationFooter } from "../OnboardingNavigationFooter";
import AddressAutocomplete from "@/components/ui/address-autocomplete";
import { SettingsRow } from "@/components/manager/settings/SettingsRow";
import { SettingsFileUpload } from "@/components/manager/settings/SettingsFileUpload";
import { AuthenticatedDocumentLink } from "@/components/manager/settings/AuthenticatedDocumentLink";
import { getDocumentFilename } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { FormLegend } from "@/components/ui/form-legend";
import { useScrollToTopOnChange } from "@/hooks/use-scroll-to-top-on-change";

/**
 * A document already stored for this location: name, one status line, one link.
 * Mirrors the terms row on the Booking Policies page so uploads look the same
 * everywhere in the manager app.
 */
function DocumentRow({
  url,
  fallbackLabel,
  status,
}: {
  url: string;
  fallbackLabel: string;
  status?: string | null;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <FileText className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {getDocumentFilename(url) || fallbackLabel}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {mt("uploadedToCloud")}{status ? ` · ${status}` : ""}
        </p>
      </div>
      <AuthenticatedDocumentLink
        url={url}
        className="inline-flex shrink-0 items-center gap-1 text-sm text-primary hover:underline"
      >
        {mt("viewDocument")}
        <ExternalLink className="h-3.5 w-3.5" />
      </AuthenticatedDocumentLink>
    </div>
  );
}

/**
 * The Business step, in three parts that save as you go.
 *
 * Part 1 owns the identity fields (name, address, logo, description) and is what
 * creates the location — the create endpoint requires name + address, both of
 * which live here. Parts 2 and 3 update the same record. Splitting it this way
 * means a manager who stops halfway keeps everything they typed, instead of
 * losing a long form because they never reached the bottom.
 */
const PART_COUNT = 3;

export default function LocationStep() {

  const {
    locationForm,
    licenseForm,
    termsForm,
    selectedLocation,
    handleNext,
    handleBack,
    isFirstStep,
    isSubmitting,
    saveAndExit,
    saveLocationDraft,
    setUnsavedChanges,
    registerStepSave,
  } = useManagerOnboarding();

  const { toast } = useToast();

  // Logo upload — same hook + folder convention the kitchen cover uses.
  const { uploadFile: uploadLogoFile } = useSessionFileUpload({
    allowedTypes: ACCEPTED_IMAGE_TYPES,
    onError: (message) => toast({ title: mt("uploadFailed2"), description: message, variant: "destructive" }),
  });
  const uploadLogo = async (file: File) => {
    const result = await uploadLogoFile(file, "location-logos");
    if (result?.url) locationForm.setLogoUrl(result.url);
  };

  const [activePart, setActivePart] = useState(0);
  const [isSavingPart, setIsSavingPart] = useState(false);
  /**
   * Whether a stored document is being swapped out. Mirrors the Booking Policies
   * page: while something is on file we show the row plus a "Replace" action,
   * and only reveal the upload field once Replace is chosen — so the field and
   * the file it would replace never compete for attention.
   */
  const [isReplacingLicense, setIsReplacingLicense] = useState(false);
  const [isReplacingTerms, setIsReplacingTerms] = useState(false);
  /**
   * The part's values at the moment it was opened. The primary button compares
   * against this so it offers "Save & continue" only when something changed.
   */
  const [partSnapshot, setPartSnapshot] = useState<string | null>(null);
  // Continuing to a shorter part used to leave you mid-page.
  const scrollRef = useScrollToTopOnChange(activePart);

  const existingLicenseUrl = selectedLocation?.kitchenLicenseUrl || (selectedLocation as any)?.kitchen_license_url || null;
  const existingTermsUrl = selectedLocation?.kitchenTermsUrl || (selectedLocation as any)?.kitchen_terms_url || null;
  const hasExistingLicense = !!existingLicenseUrl;
  const hasExistingTerms = !!existingTermsUrl;
  /*
   * There used to be an `isReadOnly` here that hid Replace, the expiry date and
   * the upload fields once the step was complete. It made the finished state a
   * dead end: a manager whose licence had lapsed could see the document but not
   * correct it. The Replace gate already prevents a stray re-upload — the field
   * only appears once Replace is chosen — so the guard was redundant as well as
   * unhelpful.
   */

  // A document uploaded in this session replaces the stored one in the row below,
  // so the two never describe the same file at once.
  const licenseUrl = licenseForm.uploadedUrl || existingLicenseUrl;
  const termsUrl = termsForm.uploadedUrl || existingTermsUrl;
  const hasLicenseOnFile = Boolean(licenseUrl);
  const hasTermsOnFile = Boolean(termsUrl);
  /**
   * Same shape as the Booking Policies page: with something on file the row
   * stands alone until "Replace" is chosen, which is what reveals the upload
   * field below it.
   */
  const showLicenseUpload = !hasLicenseOnFile || isReplacingLicense;
  const showTermsUpload = !hasTermsOnFile || isReplacingTerms;

  const licenseStatus = selectedLocation?.kitchenLicenseStatus;
  const showLicenseStatus = Boolean(selectedLocation?.kitchenLicenseUrl)
    && licenseStatus !== "rejected"
    && licenseStatus !== "expired";

  const handleLicenseFile = async (file: File | null) => {
    if (!file) return;
    toast({ title: mt("uploadingLicense"), description: file.name });
    try {
      await licenseForm.uploadFile(file);
      // Collapse the field again — the row above now names the new file.
      setIsReplacingLicense(false);
      toast({ title: mt("licenseUploadedSuccessfully"), description: file.name });
    } catch (error) {
      toast({ title: mt("uploadFailed2"),
        description: mt("failedToUploadLicenseFilePleaseTryAgain"),
        variant: "destructive",
      });
    }
  };

  const handleTermsFile = async (file: File | null) => {
    if (!file) return;
    toast({ title: mt("uploadingTerms"), description: file.name });
    try {
      await termsForm.uploadFile(file);
      setIsReplacingTerms(false);
      toast({ title: mt("termsUploadedSuccessfully"), description: file.name });
    } catch (error) {
      toast({ title: mt("uploadFailed2"),
        description: mt("failedToUploadTermsFilePleaseTryAgain"),
        variant: "destructive",
      });
    }
  };

  // Validation based on preferred contact method
  const isContactValid = () => {
    const method = locationForm.preferredContactMethod;
    if (method === "email") return !!locationForm.contactEmail;
    if (method === "phone") return !!locationForm.contactPhone;
    return !!locationForm.contactEmail && !!locationForm.contactPhone;
  };

  const needsEmail = locationForm.preferredContactMethod === "email" || locationForm.preferredContactMethod === "both";
  const needsPhone = locationForm.preferredContactMethod === "phone" || locationForm.preferredContactMethod === "both";

  /** What each part owns. Part 0 must satisfy the create endpoint's name + address. */
  const partFields = useMemo((): Partial<LocationDraftFields>[] => [
    {
      name: locationForm.name,
      address: locationForm.address,
      logoUrl: locationForm.logoUrl,
      description: locationForm.description,
    },
    {
      preferredContactMethod: locationForm.preferredContactMethod,
      contactEmail: locationForm.contactEmail,
      contactPhone: locationForm.contactPhone,
      notificationEmail: locationForm.notificationEmail,
      notificationPhone: locationForm.notificationPhone,
    },
    {},
  ], [
    locationForm.name, locationForm.address, locationForm.logoUrl, locationForm.description,
    locationForm.preferredContactMethod, locationForm.contactEmail, locationForm.contactPhone,
    locationForm.notificationEmail, locationForm.notificationPhone,
  ]);

  const partSignature = useMemo(
    () => JSON.stringify(partFields[activePart]),
    [partFields, activePart],
  );

  // Snapshot on entering a part. Also re-snapshots once a save settles, so the
  // button returns to "Continue" the moment the work is actually persisted.
  useEffect(() => {
    setPartSnapshot(partSignature);
    // Intentionally keyed on the part, not the signature: re-snapshotting on
    // every keystroke would make the form permanently clean.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePart]);

  const isPartDirty = partSnapshot !== null && partSignature !== partSnapshot;

  // Feed the wizard's unsaved-changes guard: only a part with real edits counts.
  useEffect(() => {
    setUnsavedChanges(isPartDirty);
  }, [isPartDirty, setUnsavedChanges]);

  // Let the guard's "Save changes" persist the part the manager is on. Parts 1
  // and 2 save as a draft; the final part is the existing full save.
  useEffect(() => {
    registerStepSave(async () => {
      if (activePart >= PART_COUNT - 1) return false;
      if (!isPartDirty) return true;
      const saved = await saveLocationDraft(partFields[activePart]);
      if (saved) setPartSnapshot(partSignature);
      return saved;
    });
    return () => registerStepSave(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerStepSave, activePart, isPartDirty, partSignature]);

  /** Which part is still missing something required. */
  const partIsValid = (part: number): boolean => {
    if (part === 0) {
      return Boolean(
        locationForm.name &&
        locationForm.address &&
        locationForm.logoUrl &&
        locationForm.description.trim()
      );
    }
    if (part === 1) return isContactValid();
    return Boolean(
      (licenseForm.file || licenseForm.uploadedUrl || hasExistingLicense) &&
      (termsForm.file || termsForm.uploadedUrl || hasExistingTerms)
    );
  };

  const goToNextPart = () => setActivePart((part) => Math.min(part + 1, PART_COUNT - 1));

  /** Persist this part (only if it changed), then move on. */
  const handlePartContinue = async () => {
    if (activePart < PART_COUNT - 1) {
      if (!isPartDirty) {
        goToNextPart();
        return;
      }
      setIsSavingPart(true);
      try {
        const saved = await saveLocationDraft(partFields[activePart]);
        if (!saved) return;
        setPartSnapshot(partSignature);
        goToNextPart();
      } finally {
        setIsSavingPart(false);
      }
      return;
    }

    // Final part — the existing flow validates everything, tracks completion and
    // advances the wizard.
    await handleNext();
  };

  const handlePartBack = () => {
    if (activePart === 0) {
      handleBack();
      return;
    }
    setActivePart((part) => Math.max(part - 1, 0));
  };

  const contactOptionClass = (selected: boolean) => cn(
    "flex cursor-pointer items-center gap-2.5 rounded-lg border px-4 py-2.5 transition-colors",
    selected
      ? "border-primary bg-primary/5"
      : "border-border hover:border-muted-foreground/30"
  );

  const partHeading = [
    { title: mt("businessPartDetailsTitle"), description: mt("businessPartDetailsDesc") },
    { title: mt("businessPartContactTitle"), description: mt("businessPartContactDesc") },
    { title: mt("businessPartDocumentsTitle"), description: mt("businessPartDocumentsDesc") },
  ][activePart];

  return (
    <div ref={scrollRef} className="space-y-6 animate-in fade-in duration-500">
      {/* Part progress — three dots, so the manager always knows how much is left. */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5" role="group" aria-label={mt("businessStepProgress", { current: activePart + 1, total: PART_COUNT })}>
          {Array.from({ length: PART_COUNT }, (_, index) => (
            <span
              key={index}
              aria-hidden
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                index === activePart
                  ? "w-6 bg-primary"
                  : index < activePart
                    ? "w-1.5 bg-primary/50"
                    : "w-1.5 bg-muted-foreground/25",
              )}
            />
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {mt("businessStepProgress", { current: activePart + 1, total: PART_COUNT })}
        </span>
      </div>

      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{partHeading.title}</h2>
        <p className="text-sm text-muted-foreground">{partHeading.description}</p>
      </div>

      <FormLegend />

      {/* ---------------------------------------------------------------- Part 1 */}
      {activePart === 0 && (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            <SettingsRow
              id="business-name"
              label={mt("businessName")}
              required
              hint={mt("thisNameWillBeDisplayedToChefsBrowsingYourKitchen")}
            >
              <Input
                id="business-name"
                placeholder={mt("eGDowntownCommercialKitchen")}
                value={locationForm.name}
                onChange={(e) => locationForm.setName(e.target.value)}
                className="w-64"
              />
            </SettingsRow>

            <SettingsRow
              id="business-address"
              label={mt("businessAddress")}
              required
              hint={mt("businessAddressHint")}
            >
              <AddressAutocomplete
                value={locationForm.address}
                onChange={(value) => locationForm.setAddress(value)}
                placeholder={mt("startTypingYourAddress")}
                className="w-80"
                province="NL"
              />
            </SettingsRow>

            {/*
              * Stacked, not inline: the field is a full-width row now, so an
              * inline layout would pin it to the right edge and break the
              * form's left alignment.
              */}
            <SettingsRow
              id="location-logo"
              label={mt("locationLogo")}
              required
              layout="stacked"
              hint={mt("locationLogoHint")}
            >
              <LogoPhotoField
                value={locationForm.logoUrl}
                onSelectFile={(file) => void uploadLogo(file)}
                onRemove={() => locationForm.setLogoUrl("")}
                className="max-w-lg"
              />
            </SettingsRow>

            <SettingsRow
              id="location-description"
              label={mt("locationDescription")}
              required
              layout="stacked"
              hint={mt("locationDescriptionHint")}
            >
              <Textarea
                id="location-description"
                value={locationForm.description}
                onChange={(event) => locationForm.setDescription(event.target.value)}
                placeholder={mt("locationDescriptionPlaceholder")}
                rows={4}
                maxLength={500}
                className="max-w-lg"
              />
            </SettingsRow>
          </CardContent>
        </Card>
      )}

      {/* ---------------------------------------------------------------- Part 2 */}
      {activePart === 1 && (
        <>
          {/*
            * No card header here: the part heading above already says "How
            * should we reach you?", so a nested "Primary Contact" title and its
            * subtitle repeated it. The rows speak for themselves.
            */}
          <Card>
            <CardContent className="divide-y divide-border p-0">
              <SettingsRow
                label={mt("preferredContactMethod")}
                help={mt("thisIsHowWeLlReachYouForAccountRelatedMattersAndSupportInqui")}
              >
                <RadioGroup
                  value={locationForm.preferredContactMethod}
                  onValueChange={(value) => locationForm.setPreferredContactMethod(value as "email" | "phone" | "both")}
                  className="flex flex-wrap gap-2"
                >
                  <label htmlFor="contact-method-email" className={contactOptionClass(locationForm.preferredContactMethod === "email")}>
                    <RadioGroupItem value="email" id="contact-method-email" className="shrink-0" />
                    <span className="text-sm">{mt("email")}</span>
                  </label>
                  <label htmlFor="contact-method-phone" className={contactOptionClass(locationForm.preferredContactMethod === "phone")}>
                    <RadioGroupItem value="phone" id="contact-method-phone" className="shrink-0" />
                    <span className="text-sm">{mt("phone")}</span>
                  </label>
                  <label htmlFor="contact-method-both" className={contactOptionClass(locationForm.preferredContactMethod === "both")}>
                    <RadioGroupItem value="both" id="contact-method-both" className="shrink-0" />
                    <span className="text-sm">{mt("both")}</span>
                  </label>
                </RadioGroup>
              </SettingsRow>

              <SettingsRow
                id="contact-email"
                label={mt("contactEmail")}
                required={needsEmail}
                className={cn(locationForm.preferredContactMethod === "phone" && "opacity-50")}
              >
                <Input
                  id="contact-email"
                  type="email"
                  placeholder={mt("youBusinessCom")}
                  value={locationForm.contactEmail}
                  onChange={(e) => locationForm.setContactEmail(e.target.value)}
                  disabled={locationForm.preferredContactMethod === "phone"}
                  className="w-64"
                />
              </SettingsRow>

              <SettingsRow
                id="contact-phone"
                label={mt("contactPhone")}
                required={needsPhone}
                className={cn(locationForm.preferredContactMethod === "email" && "opacity-50")}
              >
                <Input
                  id="contact-phone"
                  type="tel"
                  placeholder="+1 (555) 000-0000"
                  value={locationForm.contactPhone}
                  onChange={(e) => locationForm.setContactPhone(e.target.value)}
                  disabled={locationForm.preferredContactMethod === "email"}
                  className="w-64"
                />
              </SettingsRow>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base">{mt("platformNotifications")}</CardTitle>
              <CardDescription>{mt("whereYouLlReceiveBookingUpdatesAndChefApplications")}</CardDescription>
            </CardHeader>
            <CardContent className="divide-y divide-border p-0">
              <SettingsRow id="notification-email" label={mt("notificationEmail")} hint={mt("defaultsToYourContactEmail")}>
                <Input
                  id="notification-email"
                  type="email"
                  placeholder={mt("bookingsBusinessCom")}
                  value={locationForm.notificationEmail}
                  onChange={(e) => locationForm.setNotificationEmail(e.target.value)}
                  className="w-64"
                />
              </SettingsRow>

              <SettingsRow id="notification-phone" label={mt("notificationPhone")} hint={mt("optional")}>
                <Input
                  id="notification-phone"
                  type="tel"
                  placeholder="+1 (555) 000-0000"
                  value={locationForm.notificationPhone}
                  onChange={(e) => locationForm.setNotificationPhone(e.target.value)}
                  className="w-64"
                />
              </SettingsRow>
            </CardContent>
          </Card>
        </>
      )}

      {/* ---------------------------------------------------------------- Part 3 */}
      {activePart === 2 && (
        <>
          <Card>
            <CardHeader className="p-4 pb-2">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-1 text-base">
                    {mt("commercialKitchenLicense")}
                    {/* A licence is not optional for going live, so it carries the
                        same asterisk the form legend explains. */}
                    <span aria-hidden className="text-sm text-destructive">*</span>
                  </CardTitle>
                  <CardDescription>{mt("uploadYourCommercialKitchenLicenseForVerification")}</CardDescription>
                </div>
                {hasLicenseOnFile && !isReplacingLicense && (
                  <Button variant="outline" size="sm" onClick={() => setIsReplacingLicense(true)}>
                    {mt("replace")}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0">
              {hasLicenseOnFile && licenseUrl && (
                <DocumentRow
                  url={licenseUrl}
                  fallbackLabel={mt("licenseOnFile")}
                  status={showLicenseStatus ? (licenseStatus || "pending") : null}
                />
              )}

              {/* [ENTERPRISE] Read-only once the step is complete - no re-upload during onboarding */}
              {showLicenseUpload && (
                <SettingsFileUpload
                  id="license-file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  file={licenseForm.file}
                  label={mt("uploadLicenseFile")}
                  hint={mt("pDFJPGOrPNGMax10MB")}
                  disabled={licenseForm.isUploading}
                  onChange={handleLicenseFile}
                />
              )}
            </CardContent>

            <div className="divide-y divide-border border-t border-border">
                <SettingsRow
                  id="license-expiry-date"
                  label={mt("licenseExpirationDate")}
                  required={Boolean(licenseForm.file)}
                  hint={licenseForm.file ? mt("requiredEnterTheDateWhenThisLicenseExpires") : undefined}
                >
                  {/*
                    * The shared date field, the same picker the dashboard
                    * License settings use — not a native <input type="date">,
                    * whose browser-chrome calendar looked foreign here.
                    */}
                  <DateField
                    id="license-expiry-date"
                    value={licenseForm.expiryDate}
                    onChange={licenseForm.setExpiryDate}
                    placeholder={mt("licenseExpirationDate")}
                  />
                </SettingsRow>
              </div>
          </Card>

          <Card>
            <CardHeader className="p-4 pb-2">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-1 text-base">
                    {mt("termsPolicies")}
                    {/* Required to continue, exactly like the licence — so it
                        carries the same mark. */}
                    <span aria-hidden className="text-sm text-destructive">*</span>
                  </CardTitle>
                  <CardDescription>{mt("houseRulesAndPoliciesChefsMustAgreeToBeforeBooking")}</CardDescription>
                </div>
                {hasTermsOnFile && !isReplacingTerms && (
                  <Button variant="outline" size="sm" onClick={() => setIsReplacingTerms(true)}>
                    {mt("replace")}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0">
              {hasTermsOnFile && termsUrl && (
                <DocumentRow url={termsUrl} fallbackLabel={mt("termsOnFile")} />
              )}

              {/* [ENTERPRISE] Read-only once the step is complete - no re-upload during onboarding */}
              {showTermsUpload && (
                <SettingsFileUpload
                  id="terms-file"
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                  file={termsForm.file}
                  label={mt("uploadTermsDocument2")}
                  hint={mt("pDFJPGPNGOrDOCMax10MB")}
                  disabled={termsForm.isUploading}
                  onChange={handleTermsFile}
                />
              )}
            </CardContent>
          </Card>
        </>
      )}

      <OnboardingNavigationFooter
        onNext={() => void handlePartContinue()}
        onBack={handlePartBack}
        onSaveAndExit={() => void saveAndExit()}
        showBack={!isFirstStep || activePart > 0}
        isLoading={isSavingPart || isSubmitting}
        isSavingAndExiting={isSubmitting}
        // Nothing to save on the final part: the existing flow owns that save.
        nextLabel={
          activePart < PART_COUNT - 1 && isPartDirty
            ? mt("saveAndContinue")
            : tt("continue")
        }
        isNextDisabled={
          isSubmitting ||
          isSavingPart ||
          (activePart < PART_COUNT - 1 && !partIsValid(activePart)) ||
          (activePart === PART_COUNT - 1 && (
            isSubmitting ||
            !locationForm.name ||
            !locationForm.address ||
            !locationForm.logoUrl ||
            !locationForm.description.trim() ||
            !isContactValid() ||
            (!licenseForm.file && !licenseForm.uploadedUrl && !hasExistingLicense) ||
            (!termsForm.file && !termsForm.uploadedUrl && !hasExistingTerms)
          ))
        }
      />
    </div>
  );
}
