import { Card } from "@/components/ui/card";
import { InfoChip } from "@/components/chef/info-chip";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Building, CheckCircle, Clock, FileText, MapPin, ChevronRight, User, Mail, Phone, FileCheck, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { ChefKitchenApplication } from "@shared/schema";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import { parseBusinessInfo, formatExperience, formatExpiryDate } from "@/utils/parseBusinessInfo";
import { SecureDocumentLink } from "@/components/common/SecureDocumentLink";
import { VerifiedDocumentChip } from "@/components/common/VerifiedDocumentChip";
import { TruncatedText } from "@/components/common/TruncatedText";
import { getKitchenDisplayStatus, hasStep2BeenSubmitted } from "./status";
import { KitchenStatusChip, bookNowIcon as BookNowIcon } from "./status-icons";
import { SmartImage } from "@/components/ui/smart-image";
import "./kitchen-application-details.css";

interface KitchenApplicationWithLocation extends ChefKitchenApplication {
  location: {
    id: number;
    name: string;
    address: string;
    logoUrl?: string;
    brandImageUrl?: string;
  } | null;
}

interface KitchenApplicationCardProps {
  application: KitchenApplicationWithLocation;
  kitchenImageUrl?: string | null;
  onBookKitchen: (locationId: number, locationName: string, locationAddress?: string) => void;
  onDiscoverKitchens: () => void;
}

export function KitchenApplicationDetails({
  app,
  display,
  onBookKitchen,
  compact = false,
}: {
  app: KitchenApplicationWithLocation;
  display: ReturnType<typeof getKitchenDisplayStatus>;
  onBookKitchen: KitchenApplicationCardProps["onBookKitchen"];
  compact?: boolean;
}) {
  const { t, i18n } = useTranslation("chef");
  const currentStep = (app as any).current_tier ?? 1;
  const tierData = (app as any).tier_data || {};
  const step2Data = tierData.step2 || tierData.tier2 || {};
  const step2Submitted = hasStep2BeenSubmitted(app);
  const hasStep2Data = Object.keys(step2Data).length > 0 || (app as any).tier2_completed_at;

  /*
   * Step-2 uploads that are stored in `tier_data.tierFiles` instead of a column —
   * the insurance document is the one that exists today. The chef uploaded these,
   * so their own details view has to show them; it previously rendered only the
   * two certificate columns and silently omitted everything in tierFiles.
   */
  const tierFiles = Object.entries((tierData.tierFiles || {}) as Record<string, unknown>)
    .filter(([, url]) => typeof url === "string" && url.length > 0) as [string, string][];

  /**
   * A readable name for a tier-file key. The insurance document is the only one the
   * UI names; anything else is humanised from the key so a newly added tier file is
   * legible rather than a raw identifier.
   */
  const tierFileLabel = (key: string): string =>
    key === "tier2_insurance_document"
      ? t("apptabInsuranceDocument", { defaultValue: "Insurance document" })
      : key.replace(/^tier\d+_/, "").replaceAll("_", " ");

  return (
    <div className={cn("space-y-5", compact && "kitchen-application-detail-compact")}>
      {!compact && <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-muted/30 p-2">
          <p className="text-xs uppercase text-muted-foreground">{t("apptabApplicationId", "Application ID")}</p>
          <p className="text-sm font-medium">#{app.id}</p>
        </div>
        <div className="rounded-lg bg-muted/30 p-2">
          <p className="text-xs uppercase text-muted-foreground">{t("apptabSubmitted", "Submitted")}</p>
          <p className="text-sm font-medium">
            {new Date(app.createdAt || "").toLocaleDateString(i18n.language)}
          </p>
        </div>
        <div className="rounded-lg bg-muted/30 p-2">
          <p className="text-xs uppercase text-muted-foreground">{t("apptabCurrentProgress", "Current Progress")}</p>
          <p className="text-sm font-medium">{display.stepCaption}</p>
        </div>
        <div className="rounded-lg bg-muted/30 p-2">
          <p className="text-xs uppercase text-muted-foreground">{t("apptabStatus", "Status")}</p>
          <p className="text-sm font-medium">{display.label}</p>
        </div>
      </div>}

      {!compact && app.status === "approved" && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("apptabProgress", "Progress")}
          </p>
          <div className="flex items-center gap-2">
            {[1, 2].map((step) => (
              <div key={step} className="flex-1">
                <div
                  className={cn(
                    "h-1 rounded-full",
                    (step === 1 || step2Submitted) ? "bg-foreground" : "bg-border"
                  )}
                />
                <p className="mt-1 text-center text-xs text-muted-foreground">
                  {step === 1
                    ? t("requestToApply", "Request to apply")
                    : t("kitchenDocuments", "Kitchen documents")}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {!compact && <Separator className="bg-border/50" />}

      <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-bold text-foreground">{t("requestToApply", "Request to apply")}</p>
          {(app as any).tier1_completed_at && (
            <InfoChip variant="success" icon={<CheckCircle className="h-3 w-3" />}>
              {t("apptabSubmittedOn", { date: new Date((app as any).tier1_completed_at || app.createdAt).toLocaleDateString(i18n.language), defaultValue: "Submitted {date}" })}
            </InfoChip>
          )}
        </div>

        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("apptabPersonalInformation", "Personal Information")}
          </p>
          <div className={cn("grid grid-cols-1 gap-3", compact && "compact-personal-details")}>
            <div className="flex items-center gap-2 rounded-lg bg-muted/20 p-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs uppercase text-muted-foreground">{t("apptabFullName", "Full Name")}</p>
                <p className="text-sm font-medium">{app.fullName || t("apptabNotApplicable", "N/A")}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-muted/20 p-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-xs uppercase text-muted-foreground">{t("apptabEmail", "Email")}</p>
                <TruncatedText as="p" className="truncate text-sm font-medium">{app.email || t("apptabNotApplicable", "N/A")}</TruncatedText>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-muted/20 p-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs uppercase text-muted-foreground">{t("apptabPhone", "Phone")}</p>
                <p className="text-sm font-medium">{app.phone || t("apptabNotApplicable", "N/A")}</p>
              </div>
            </div>
          </div>

          <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("apptabBusinessDetails", "Business Details")}
          </p>
          {(() => {
            const businessInfo = parseBusinessInfo(app.businessDescription);
            return (
              <div className={cn("space-y-3", compact && "compact-business-details")}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-lg bg-muted/20 p-2">
                    <p className="text-xs uppercase text-muted-foreground">{t("apptabKitchenPreference", "Kitchen Preference")}</p>
                    <p className="text-sm font-medium capitalize">{app.kitchenPreference || t("apptabNotApplicable", "N/A")}</p>
                  </div>
                  <div className="rounded-lg bg-muted/20 p-2">
                    <p className="text-xs uppercase text-muted-foreground">{t("apptabCookingExperience", "Cooking Experience")}</p>
                    <p className="text-sm font-medium">
                      {formatExperience(app.cookingExperience || businessInfo?.experience)}
                    </p>
                  </div>
                </div>
                {businessInfo && (
                  <>
                    {(businessInfo.businessName || businessInfo.businessType) && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {businessInfo.businessName && (
                          <div className="rounded-lg bg-muted/20 p-2">
                            <p className="text-xs uppercase text-muted-foreground">{t("apptabBusinessName", "Business Name")}</p>
                            <p className="text-sm font-medium">{businessInfo.businessName}</p>
                          </div>
                        )}
                        {businessInfo.businessType && (
                          <div className="rounded-lg bg-muted/20 p-2">
                            <p className="text-xs uppercase text-muted-foreground">{t("apptabBusinessType", "Business Type")}</p>
                            <p className="text-sm font-medium capitalize">{businessInfo.businessType}</p>
                          </div>
                        )}
                      </div>
                    )}
                    {(businessInfo.usageFrequency || businessInfo.sessionDuration) && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {businessInfo.usageFrequency && (
                          <div className="rounded-lg bg-muted/20 p-2">
                            <p className="text-xs uppercase text-muted-foreground">{t("apptabUsageFrequency", "Usage Frequency")}</p>
                            <p className="text-sm font-medium capitalize">{businessInfo.usageFrequency}</p>
                          </div>
                        )}
                        {businessInfo.sessionDuration && (
                          <div className="rounded-lg bg-muted/20 p-2">
                            <p className="text-xs uppercase text-muted-foreground">{t("apptabSessionDuration", "Session Duration")}</p>
                            <p className="text-sm font-medium">{t("apptabHoursValue", { hours: businessInfo.sessionDuration, defaultValue: "{hours} hours" })}</p>
                          </div>
                        )}
                      </div>
                    )}
                    {(businessInfo.foodHandlerCertExpiry || businessInfo.foodEstablishmentCertExpiry) && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {businessInfo.foodHandlerCertExpiry && (
                          <div className="rounded-lg bg-muted/20 p-2">
                            <p className="text-xs uppercase text-muted-foreground">
                              {t("apptabFoodHandlerCertExpiry", "Food Handler Cert Expiry")}
                            </p>
                            <p className="text-sm font-medium">
                              {formatExpiryDate(businessInfo.foodHandlerCertExpiry)}
                            </p>
                          </div>
                        )}
                        {businessInfo.foodEstablishmentCertExpiry && (
                          <div className="rounded-lg bg-muted/20 p-2">
                            <p className="text-xs uppercase text-muted-foreground">
                              {t("apptabEstablishmentCertExpiry", "Establishment Cert Expiry")}
                            </p>
                            <p className="text-sm font-medium">
                              {formatExpiryDate(businessInfo.foodEstablishmentCertExpiry)}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                    {businessInfo.description && (
                      <div className="rounded-lg bg-muted/20 p-2">
                        <p className="text-xs uppercase text-muted-foreground">{t("apptabDescription", "Description")}</p>
                        <p className="text-sm">{businessInfo.description}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })()}

          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
            <div className="float-right">
              <VerifiedDocumentChip status={app.foodSafetyLicenseStatus} url={app.foodSafetyLicenseUrl} expiry={app.foodSafetyLicenseExpiry} />
            </div>
            <p className="text-xs uppercase text-muted-foreground">
              {t("apptabFoodSafetyLicense", "Food Safety License")}
            </p>
            <p className="text-sm font-medium">
              {app.foodSafetyLicense === "yes"
                ? t("apptabYes", "Yes")
                : app.foodSafetyLicense === "no"
                  ? t("apptabNo", "No")
                  : t("apptabNotSure", "Not Sure")}
            </p>
            {app.foodSafetyLicenseUrl ? (
              <div className="mt-2"><SecureDocumentLink url={app.foodSafetyLicenseUrl} fileName={t("apptabFoodSafetyLicense", "Food Safety License")} label={t("apptabView", "View")} /></div>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">{t("apptabDocumentsAfterStep1", "Document upload becomes available after your request to apply is approved.")}</p>
            )}
          </div>

        </div>
      </div>

      {(currentStep >= 2 || hasStep2Data) && (
        <>
          <Separator className="bg-border/50" />
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-bold text-foreground">{t("kitchenDocuments", "Kitchen documents")}</p>
              {(app as any).tier2_completed_at ? (
                <InfoChip variant="success" icon={<CheckCircle className="h-3 w-3" />}>
                  {t("apptabSubmittedOn", { date: new Date((app as any).tier2_completed_at).toLocaleDateString(i18n.language), defaultValue: "Submitted {date}" })}
                </InfoChip>
              ) : currentStep === 2 ? (
                <InfoChip variant="warning" icon={<Clock className="h-3 w-3" />}>
                  {t("apptabInProgress", "In Progress")}
                </InfoChip>
              ) : null}
            </div>

            {app.foodEstablishmentCertUrl && (
              <div className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium">Food Establishment Licence</p>
                  <VerifiedDocumentChip status={app.foodEstablishmentCertStatus} url={app.foodEstablishmentCertUrl} expiry={app.foodEstablishmentCertExpiry} />
                </div>
                <div className="mt-2"><SecureDocumentLink url={app.foodEstablishmentCertUrl} fileName="Food Establishment Licence" label={t("apptabView", "View")} /></div>
              </div>
            )}

            {tierFiles.map(([key, url]) => (
              <div key={key} className="rounded-xl border border-border bg-card p-3">
                <p className="text-sm font-medium capitalize">{tierFileLabel(key)}</p>
                <div className="mt-2">
                  <SecureDocumentLink url={url} fileName={tierFileLabel(key)} label={t("apptabView", "View")} />
                </div>
              </div>
            ))}

            {hasStep2Data ? (
              <div className="space-y-3">
                {((app as any).government_license_number || step2Data.governmentLicenseNumber) && (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("apptabGovernmentLicense", "Government License")}
                    </p>
                    <div className="grid grid-cols-1 gap-3">
                      <div className="rounded-lg bg-muted/20 p-2">
                        <p className="text-xs uppercase text-muted-foreground">{t("apptabLicenseNumber", "License Number")}</p>
                        <p className="text-sm font-medium">
                          {(app as any).government_license_number ||
                            step2Data.governmentLicenseNumber ||
                            t("apptabNotApplicable", "N/A")}
                        </p>
                      </div>
                      <div className="rounded-lg bg-muted/20 p-2">
                        <p className="text-xs uppercase text-muted-foreground">{t("apptabReceivedDate", "Received Date")}</p>
                        <p className="text-sm font-medium">
                          {(app as any).government_license_received_date ||
                          step2Data.governmentLicenseReceivedDate
                            ? new Date(
                                (app as any).government_license_received_date ||
                                  step2Data.governmentLicenseReceivedDate
                              ).toLocaleDateString(i18n.language)
                            : t("apptabNotApplicable", "N/A")}
                        </p>
                      </div>
                      <div className="rounded-lg bg-muted/20 p-2">
                        <p className="text-xs uppercase text-muted-foreground">{t("apptabExpiryDate", "Expiry Date")}</p>
                        <p className="text-sm font-medium">
                          {(app as any).government_license_expiry_date ||
                          step2Data.governmentLicenseExpiryDate
                            ? new Date(
                                (app as any).government_license_expiry_date ||
                                  step2Data.governmentLicenseExpiryDate
                              ).toLocaleDateString(i18n.language)
                            : t("apptabNotApplicable", "N/A")}
                        </p>
                      </div>
                    </div>
                  </>
                )}

                {Object.keys(step2Data).length > 0 && (
                  <>
                    <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("apptabAdditionalInformation", "Additional Information")}
                    </p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {Object.entries(step2Data).map(([key, value]) => {
                        if (
                          [
                            "governmentLicenseNumber",
                            "governmentLicenseReceivedDate",
                            "governmentLicenseExpiryDate",
                          ].includes(key)
                        ) {
                          return null;
                        }
                        if (typeof value === "object" && value !== null) return null;

                        const displayKey = key
                          .replace(/([A-Z])/g, " $1")
                          .replace(/^./, (str) => str.toUpperCase())
                          .trim();

                        return (
                          <div key={key} className="rounded-lg bg-muted/20 p-2">
                            <p className="text-xs uppercase text-muted-foreground">{displayKey}</p>
                            <p className="text-sm font-medium">{String(value) || t("apptabNotApplicable", "N/A")}</p>
                          </div>
                        );
                      })}
                    </div>

                    {step2Data.documents && Object.keys(step2Data.documents).length > 0 && (
                      <>
                        <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {t("kitchenDocuments", "Kitchen documents")}
                        </p>
                        <div className="grid grid-cols-1 gap-3">
                          {Object.entries(step2Data.documents).map(
                            ([docKey, docValue]: [string, any]) => (
                              <div
                                key={docKey}
                                className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-card p-3"
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                                  <span className="text-sm font-medium capitalize">
                                    {docKey.replace(/([A-Z])/g, " $1").trim()}
                                  </span>
                                </div>
                                {typeof docValue === "string" && docValue ? (
                                  <SecureDocumentLink
                                    url={docValue}
                                    fileName={docKey.replace(/([A-Z])/g, " $1").trim()}
                                    label={t("apptabView", "View")}
                                    showIcon={false}
                                  />
                                ) : (
                                  <InfoChip variant="outline">
                                    {t("apptabNotUploaded", "Not Uploaded")}
                                  </InfoChip>
                                )}
                              </div>
                            )
                          )}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            ) : currentStep >= 2 && !hasStep2Data ? (
              <div className="rounded-xl border px-3 py-3">
                <p className="text-sm text-muted-foreground">
                  {t("kitchenDocumentsOutstanding", "Upload the required documents to get full kitchen access.")}
                </p>
              </div>
            ) : null}
          </div>
        </>
      )}

      {app.feedback && (
        <>
          <Separator className="bg-border/50" />
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("apptabManagerFeedback", "Manager feedback")}
            </p>
            <p className="text-sm text-muted-foreground">{app.feedback}</p>
          </div>
        </>
      )}

      <div className="flex flex-wrap gap-2 pt-2">
        {app.status === "approved" && currentStep >= 3 && (
          <Button
            size="sm"
            onClick={() =>
              onBookKitchen(app.locationId, app.location?.name || t("apptabKitchenFallback", "Kitchen"), app.location?.address)
            }
          >
            <BookNowIcon className="mr-1 h-4 w-4" />
            {t("apptabBookKitchen", "Book Kitchen")}
          </Button>
        )}
        {app.status === "approved" && currentStep < 3 &&
          (step2Submitted ? (
            <InfoChip variant="outline" icon={<FileCheck className="h-3 w-3" />}>
              {t("kdInReview", "In review")}
            </InfoChip>
          ) : (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/kitchen-requirements/${app.locationId}`}>
                {t("continueKitchenApplication", { defaultValue: "Continue application" })}
                <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
              </Link>
            </Button>
          ))}
        {(app.status === "rejected" || app.status === "cancelled") && (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/apply-kitchen/${app.locationId}`}>
              {t("kdApplyAgain", "Apply again")}
                <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

export default function KitchenApplicationCard({
  application: app,
  kitchenImageUrl,
  onBookKitchen,
}: KitchenApplicationCardProps) {
  /*
   * "View details" opens the My Kitchen Applications tab, where the application
   * details already live. A second copy of them in a Sheet would only drift.
   */
  const [, navigate] = useLocation();
  const { t } = useTranslation("chef");

  /*
   * The dashboard switches tabs from `popstate`, but wouter's `navigate()` is a
   * pushState on the SAME pathname (/dashboard) — only the `?view=` changes, so the
   * dashboard's [location] effect never re-runs and the tab would stay where it was
   * while the address bar said otherwise. Firing a popstate makes it actually switch.
   */
  const openKitchenApplications = () => {
    navigate("/dashboard?view=kitchen-requests");
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const imageUrl = kitchenImageUrl || app.location?.brandImageUrl;
  const display = getKitchenDisplayStatus(app, t);
  const kitchenName = app.location?.name || t("apptabKitchenApplication");

  return (
    <>
      <Card className="overflow-hidden shadow-none">
        <div className="min-w-0 p-4 sm:p-5">
          <div className="flex min-w-0 items-start gap-3 sm:gap-4">
            {imageUrl ? (
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border">
                <SmartImage
                  src={getR2ProxyUrl(imageUrl)}
                  alt={kitchenName}
                  className="h-full w-full object-cover"
                />
              </div>
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Building className="h-6 w-6 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <TruncatedText className="block break-words font-medium">{kitchenName}</TruncatedText>
              <div className="mt-1.5"><KitchenStatusChip display={display} /></div>
            </div>
          </div>
          <p className="mt-3 flex min-w-0 items-start gap-1.5 text-sm text-muted-foreground">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 break-words">{app.location?.address || t("apptabAddressNotAvailable")}</span>
          </p>
          {display.actionKind !== "book" && <p className="mt-1 text-xs text-muted-foreground">{display.stepCaption}</p>}
          <div className="mt-4 flex min-w-0 flex-wrap gap-2 border-t pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-w-0 flex-1 sm:flex-none"
                onClick={openKitchenApplications}
              >
                <Eye />
                {t("apptabViewDetails")}
              </Button>
              {display.actionKind === "book" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="min-w-0 flex-1 sm:flex-none"
                  onClick={() =>
                    onBookKitchen(
                      app.locationId,
                      app.location?.name || t("apptabKitchenFallback"),
                      app.location?.address
                    )
                  }
                >
                  <BookNowIcon />
                  {t("apptabBook")}
                </Button>
              )}
              {display.actionKind === "complete-step" && (
                <Button size="sm" variant="outline" className="min-w-0 flex-1 sm:flex-none" asChild>
                  <Link href={`/kitchen-requirements/${app.locationId}`}>{t("apptabContinue")}</Link>
                </Button>
              )}
              {display.actionKind === "discover" && (
                <Button size="sm" variant="outline" className="min-w-0 flex-1 sm:flex-none" asChild>
                  <Link href={`/apply-kitchen/${app.locationId}`}>
                    {t("kdApplyAgain", "Apply again")}
                  </Link>
                </Button>
              )}
          </div>
        </div>
      </Card>
    </>
  );
}
