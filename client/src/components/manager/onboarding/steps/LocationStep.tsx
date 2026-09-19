import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useManagerOnboarding, type LocationDraftFields } from "../ManagerOnboardingContext";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import { FileText, ExternalLink, Lock } from "@/components/ui/manager-icons";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useSessionFileUpload } from "@/hooks/useSessionFileUpload";
import PhoneSignInSettings from "@/components/auth/PhoneSignInSettings";
import { auth } from "@/lib/firebase";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { normalizePhoneNumber, formatPhoneForDisplay } from "@shared/phone-validation";
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
  const queryClient = useQueryClient();
  const { user: firebaseUser } = useFirebaseAuth();

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
   * A licence is on file, or one was chosen in this session and not yet uploaded.
   * Either way a date describes it, and the date is not optional: a licence with no
   * expiry is a document nobody can act on — it cannot be approved, and nothing can
   * warn the manager before it lapses. The Manager Portal has always refused to save
   * one without a date; this step was the last place that let it through.
   */
  const licenseNeedsExpiry = Boolean(licenseForm.file || licenseUrl);
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

  /*
   * The contact email is no longer conditional. It is the account address, it is not
   * editable here, and platform notifications now follow it — so it is always present
   * and always in use, and the old per-method email/phone requirement collapsed into
   * the one question that is still open: is the phone proved?
   */
  const needsPhone = locationForm.preferredContactMethod === "phone" || locationForm.preferredContactMethod === "both";

  /**
   * The number the ACCOUNT holds. `users.phone_number` is the only place a manager's
   * phone lives — no account here has ever linked one to Firebase — and the auth user
   * is that same row, so this needs no request of its own.
   *
   * Coerced to `""` rather than left nullable: `normalizePhoneNumber` returns null for
   * an unusable number, and null === null would read as "these two match" in the
   * comparison below.
   */
  const accountPhone = normalizePhoneNumber(firebaseUser?.phoneNumber) || "";
  /**
   * A number proved during THIS visit. It has to be local state rather than the auth
   * user: linking a phone does not change the uid, so the auth context never re-reads
   * the row and would keep reporting a just-verified number as unproved.
   */
  const [linkedPhone, setLinkedPhone] = useState("");
  const verifiedPhone =
    normalizePhoneNumber(linkedPhone) || (firebaseUser?.phoneVerified ? accountPhone : "");

  /**
   * Proved means the account holds THIS number as a credential.
   *
   * Comparing the two is what makes editing the field invalidate the proof. A bare
   * `phoneVerified` flag would carry the account's verdict over to whatever the
   * manager typed next — and a preferred contact method is only worth anything when
   * the number behind it is one they can actually be reached on.
   */
  const isPhoneVerified =
    verifiedPhone !== "" && normalizePhoneNumber(locationForm.contactPhone) === verifiedPhone;

  /** Everything the phone half of this part needs, in one place for both gates. */
  const phoneSatisfied = !needsPhone || isPhoneVerified;

  /**
   * Persist the proved number to the account.
   *
   * The Firebase link alone cannot sign anyone in: `auth-method-hints` finds the
   * account by looking the number up in `users.phone_number`, and this route refuses
   * any number Firebase has not just proved. Both halves are required — the same pair
   * the profile page writes.
   */
  const handlePhoneLinked = async (phone: string) => {
    setLinkedPhone(phone);
    locationForm.setContactPhone(phone);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("no token");
      const response = await fetch("/api/manager/profile", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      if (!response.ok) throw new Error(String(response.status));
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
    } catch {
      // The number IS proved — Firebase holds the credential — so failing the
      // verification here would be a lie. But without this write the account cannot be
      // found from that number at sign-in, so it must not pass silently either.
      toast({
        title: mt("phoneVerifiedNotSaved"),
        description: mt("phoneVerifiedNotSavedDesc"),
        variant: "destructive",
      });
    }
  };

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
      // Notification targets follow the contact details. There is no longer any UI
      // for them, so sending the state they used to be edited into would write a
      // value the manager can no longer see. Same rule as the full save.
      notificationEmail: locationForm.contactEmail,
      notificationPhone: locationForm.contactPhone,
    },
    {},
  ], [
    locationForm.name, locationForm.address, locationForm.logoUrl, locationForm.description,
    locationForm.preferredContactMethod, locationForm.contactEmail, locationForm.contactPhone,
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
    if (part === 1) return Boolean(locationForm.contactEmail) && phoneSatisfied;
    return Boolean(
      (licenseForm.file || licenseForm.uploadedUrl || hasExistingLicense) &&
      (termsForm.file || termsForm.uploadedUrl || hasExistingTerms) &&
      licenseForm.expiryDate
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
        <Card>
          <CardContent className="divide-y divide-border p-0">
            <SettingsRow
              label={mt("preferredContactMethod")}
              hint={mt("platformNotificationsGoToYourContactEmail")}
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

            {/*
              * Read-only on purpose. The address belongs to the ACCOUNT, and the
              * notification target now follows it, so a second editable copy here could
              * only drift from the one that actually receives mail. Changing it is a
              * Settings action, where the verification round-trip already lives.
              *
              * Stacked, and a value rather than a disabled input: the sentence explaining
              * why it is locked does not fit beside a 256px field — at 430px wide it
              * wrapped to six lines and the address overflowed behind it. A locked value
              * should not be dressed as a text box either.
              */}
            <SettingsRow
              id="contact-email"
              label={mt("contactEmail")}
              required
              layout="stacked"
              hint={mt("contactEmailLockedHint")}
            >
              <p className="flex items-start gap-1.5 text-sm font-medium text-foreground">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="break-all">{locationForm.contactEmail}</span>
              </p>
            </SettingsRow>

            {/*
              * One phone surface, not two. When the phone is a contact channel the
              * verification form REPLACES the plain field, so there is never a number
              * sitting in an input that nothing has confirmed. The form keeps the
              * duplicate-number pre-flight and the SMS consent that live on the profile
              * page — see PhoneSignInSettings.
              *
              * Stacked in both states, so the row does not change shape as the number
              * goes from unproved to proved.
              */}
            {needsPhone ? (
              <SettingsRow
                id="contact-phone"
                label={mt("contactPhone")}
                required
                layout="stacked"
                hint={mt("contactPhoneVerifyHint")}
              >
                <PhoneSignInSettings
                  layout="form"
                  initialPhone={locationForm.contactPhone}
                  /* The account's proved number, so the row and the Continue gate agree.
                     The component cannot see `users.phone_verified_at`; without this it
                     would offer to verify a number that is already usable. */
                  provedPhone={verifiedPhone}
                  onPhoneLinked={handlePhoneLinked}
                />
              </SettingsRow>
            ) : locationForm.contactPhone ? (
              /* Not a contact channel, so it is informational: the number the account
                 holds, shown the way it was before this step owned the verification.
                 Omitted entirely when there is no number, rather than rendering an empty
                 row that reads as broken. */
              <SettingsRow id="contact-phone" label={mt("contactPhone")} layout="stacked" className="opacity-50">
                <p className="text-sm text-muted-foreground">
                  {formatPhoneForDisplay(locationForm.contactPhone)}
                </p>
              </SettingsRow>
            ) : null}
          </CardContent>
        </Card>
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
                  required={licenseNeedsExpiry}
                  hint={licenseNeedsExpiry ? mt("requiredEnterTheDateWhenThisLicenseExpires") : undefined}
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
        /*
         * One gate, not two. The final part used to repeat every check from
         * `partIsValid` inline, which is how the expiry date came to be required on
         * the earlier parts and forgotten on the one that actually submits the
         * licence — the rule lived in two places and only one of them had it.
         */
        isNextDisabled={isSubmitting || isSavingPart || !partIsValid(activePart)}
      />
    </div>
  );
}
