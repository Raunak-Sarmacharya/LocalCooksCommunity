import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Building,
  Calendar,
  CheckCircle,
  Clock,
  FileText,
  MapPin,
  ArrowRight,
  User,
  Mail,
  Phone,
  FileCheck,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

type ChefTFunction = TFunction<"chef", undefined>;
import { ChefKitchenApplication } from "@shared/schema";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import { parseBusinessInfo, formatExperience, formatExpiryDate } from "@/utils/parseBusinessInfo";
import { SecureDocumentLink } from "@/components/common/SecureDocumentLink";
import { TruncatedText } from "@/components/common/TruncatedText";
import {
  getKitchenDisplayStatus,
  hasStep2BeenSubmitted,
  toneToBadgeVariant,
} from "./status";
import { SmartImage } from "@/components/ui/smart-image";

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

const getDocStatusBadge = (status: string | null | undefined, t: ChefTFunction) => {
  if (!status || status === "N/A") return { variant: "outline" as const, label: t("apptabDocNotUploaded", "Not uploaded") };
  if (status === "approved") return { variant: "success" as const, label: t("apptabDocApproved", "Approved") };
  if (status === "pending") return { variant: "warning" as const, label: t("apptabDocPending", "Pending") };
  if (status === "rejected") return { variant: "destructive" as const, label: t("apptabDocRejected", "Rejected") };
  return { variant: "outline" as const, label: status };
};

const formatYesNoNotSure = (value: string | undefined, t: ChefTFunction) => {
  if (value === "yes") return t("apptabYes", "Yes");
  if (value === "no") return t("apptabNo", "No");
  if (value === "notSure") return t("apptabNotSure", "Not Sure");
  return value || t("apptabNotApplicable", "N/A");
};

function KitchenApplicationDetails({
  app,
  display,
  onBookKitchen,
  onDiscoverKitchens,
}: {
  app: KitchenApplicationWithLocation;
  display: ReturnType<typeof getKitchenDisplayStatus>;
  onBookKitchen: KitchenApplicationCardProps["onBookKitchen"];
  onDiscoverKitchens: KitchenApplicationCardProps["onDiscoverKitchens"];
}) {
  const { t, i18n } = useTranslation("chef");
  const currentStep = (app as any).current_tier ?? 1;
  const tierData = (app as any).tier_data || {};
  const step2Data = tierData.step2 || tierData.tier2 || {};
  const step2Submitted = hasStep2BeenSubmitted(app);
  const hasStep2Data = Object.keys(step2Data).length > 0 || (app as any).tier2_completed_at;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
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
          <p className="text-sm font-medium capitalize">{app.status}</p>
        </div>
      </div>

      {app.status === "approved" && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("apptabProgress", "Progress")}
          </p>
          <div className="flex items-center gap-2">
            {[1, 2, 3].map((step) => (
              <div key={step} className="flex-1">
                <div
                  className={cn(
                    "h-1 rounded-full",
                    display.step >= step ? "bg-foreground" : "bg-border"
                  )}
                />
                <p className="mt-1 text-center text-xs text-muted-foreground">
                  {step === 3 ? t("apptabCompleteWord", "Complete") : t("apptabStepN", { step, defaultValue: "Step {step}" })}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <Separator className="bg-border/50" />

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted">
            <span className="text-xs font-medium text-muted-foreground">1</span>
          </div>
          <p className="text-sm font-bold text-foreground">{t("apptabStep1Title", "Request to apply")}</p>
          {(app as any).tier1_completed_at && (
            <Badge variant="success">
              <CheckCircle className="mr-1 h-3 w-3" />
              {t("apptabSubmittedOn", { date: new Date((app as any).tier1_completed_at || app.createdAt).toLocaleDateString(i18n.language), defaultValue: "Submitted {date}" })}
            </Badge>
          )}
        </div>

        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("apptabPersonalInformation", "Personal Information")}
          </p>
          <div className="grid grid-cols-1 gap-3">
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
              <div className="space-y-3">
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

          <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("apptabDocumentsLabel", "Documents")}
          </p>
          <div className="grid grid-cols-1 gap-3">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card p-3">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <span className="text-sm font-medium">{t("apptabFoodSafetyLicense", "Food Safety License")}</span>
                  <p className="text-xs text-muted-foreground">
                    {t("apptabHasLicense", { value: formatYesNoNotSure(app.foodSafetyLicense, t), defaultValue: "Has License: {value}" })}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {app.foodSafetyLicenseUrl ? (
                  <>
                    <Badge variant={getDocStatusBadge(app.foodSafetyLicenseStatus, t).variant}>
                      {getDocStatusBadge(app.foodSafetyLicenseStatus, t).label}
                    </Badge>
                    <SecureDocumentLink
                      url={app.foodSafetyLicenseUrl}
                      fileName="Food Safety License"
                      label={t("apptabView", "View")}
                      showIcon={false}
                    />
                  </>
                ) : (
                  <Badge variant="outline" className="bg-muted">
                    {t("apptabNotUploaded", "Not Uploaded")}
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card p-3">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <span className="text-sm font-medium">{t("apptabEstablishmentCert", "Establishment Cert")}</span>
                  <p className="text-xs text-muted-foreground">
                    {t("apptabHasCert", { value: formatYesNoNotSure(app.foodEstablishmentCert, t), defaultValue: "Has Cert: {value}" })}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {app.foodEstablishmentCertUrl ? (
                  <>
                    <Badge variant={getDocStatusBadge(app.foodEstablishmentCertStatus, t).variant}>
                      {getDocStatusBadge(app.foodEstablishmentCertStatus, t).label}
                    </Badge>
                    <SecureDocumentLink
                      url={app.foodEstablishmentCertUrl}
                      fileName="Establishment Certificate"
                      label={t("apptabView", "View")}
                      showIcon={false}
                    />
                  </>
                ) : (
                  <Badge variant="outline" className="bg-muted">
                    {t("apptabNotUploaded", "Not Uploaded")}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {(currentStep >= 2 || hasStep2Data) && (
        <>
          <Separator className="bg-border/50" />
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted">
                <span className="text-xs font-medium text-muted-foreground">2</span>
              </div>
              <p className="text-sm font-bold text-foreground">{t("apptabStep2Title", "Step 2 - Additional Requirements")}</p>
              {(app as any).tier2_completed_at ? (
                <Badge variant="success">
                  <CheckCircle className="mr-1 h-3 w-3" />
                  {t("apptabSubmittedOn", { date: new Date((app as any).tier2_completed_at).toLocaleDateString(i18n.language), defaultValue: "Submitted {date}" })}
                </Badge>
              ) : currentStep === 2 ? (
                <Badge variant="warning">
                  <Clock className="mr-1 h-3 w-3" />
                  {t("apptabInProgress", "In Progress")}
                </Badge>
              ) : null}
            </div>

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
                          {t("apptabStep2Documents", "Step 2 Documents")}
                        </p>
                        <div className="grid grid-cols-1 gap-3">
                          {Object.entries(step2Data.documents).map(
                            ([docKey, docValue]: [string, any]) => (
                              <div
                                key={docKey}
                                className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card p-3"
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
                                  <Badge variant="outline" className="bg-muted">
                                    {t("apptabNotUploaded", "Not Uploaded")}
                                  </Badge>
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
              <div className="rounded-md border px-3 py-3">
                <p className="text-sm text-muted-foreground">
                  {t("apptabStep2Outstanding", "Step 2 is still outstanding. Complete it to get full kitchen access.")}
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
            <Calendar className="mr-1 h-4 w-4" />
            {t("apptabBookKitchen", "Book Kitchen")}
          </Button>
        )}
        {app.status === "approved" && currentStep < 3 &&
          (step2Submitted ? (
            <Badge variant="outline" className="text-xs">
              <FileCheck className="mr-1 h-3 w-3" />
              {t("apptabStep2SubmittedAwaiting", "Step 2 submitted — awaiting manager review")}
            </Badge>
          ) : (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/kitchen-requirements/${app.locationId}`}>
                <ArrowRight className="mr-1 h-4 w-4" />
                {t("apptabCompleteStepN", { step: currentStep === 1 ? 2 : currentStep, defaultValue: "Complete Step {step}" })}
              </Link>
            </Button>
          ))}
        {(app.status === "rejected" || app.status === "cancelled") && (
          <Button variant="outline" size="sm" onClick={onDiscoverKitchens}>
            <Building className="mr-1 h-4 w-4" />
            {t("apptabApplyAnotherKitchen", "Apply to Another Kitchen")}
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
  onDiscoverKitchens,
}: KitchenApplicationCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { t } = useTranslation("chef");

  const imageUrl = kitchenImageUrl || app.location?.brandImageUrl;
  const display = getKitchenDisplayStatus(app, t);
  const kitchenName = app.location?.name || t("apptabKitchenApplication");

  return (
    <>
      <Card className="overflow-hidden shadow-none">
        <div className="flex items-center gap-4 p-5">
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
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <TruncatedText className="truncate font-medium">{kitchenName}</TruncatedText>
                <Badge variant={toneToBadgeVariant(display.tone)} className="font-medium">
                  {display.label}
                </Badge>
              </div>
              <p className="mt-1 flex items-center gap-1 truncate text-sm text-muted-foreground">
                <MapPin className="h-3 w-3 shrink-0" />
                <TruncatedText className="truncate">{app.location?.address || t("apptabAddressNotAvailable")}</TruncatedText>
                <span className="text-border">·</span>
                <span>{display.stepCaption}</span>
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDetailsOpen(true)}
              >
                <Eye />
                {t("apptabViewDetails")}
              </Button>
              {display.actionKind === "book" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    onBookKitchen(
                      app.locationId,
                      app.location?.name || t("apptabKitchenFallback"),
                      app.location?.address
                    )
                  }
                >
                  {t("apptabBook")}
                </Button>
              )}
              {display.actionKind === "complete-step" && (
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/kitchen-requirements/${app.locationId}`}>{t("apptabContinue")}</Link>
                </Button>
              )}
              {display.actionKind === "discover" && (
                <Button size="sm" variant="outline" onClick={onDiscoverKitchens}>
                  {t("apptabBrowse")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>

      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-xl">
          <SheetHeader className="pr-8 text-left">
            <div className="flex items-start gap-3">
              {imageUrl ? (
                <div className="h-11 w-11 shrink-0 overflow-hidden rounded-md border">
                  <SmartImage
                    src={getR2ProxyUrl(imageUrl)}
                    alt={kitchenName}
                    className="h-full w-full object-cover"
                  />
                </div>
              ) : (
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-muted">
                  <Building className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 space-y-1">
                <SheetTitle className="flex flex-wrap items-center gap-2">
                  <TruncatedText className="truncate">{kitchenName}</TruncatedText>
                  <Badge variant={toneToBadgeVariant(display.tone)} className="font-medium">
                    {display.label}
                  </Badge>
                </SheetTitle>
                <SheetDescription className="flex items-center gap-1">
                  <MapPin className="h-3 w-3 shrink-0" />
                  <TruncatedText className="truncate">
                    {app.location?.address || t("apptabAddressNotAvailable")}
                  </TruncatedText>
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>
          <KitchenApplicationDetails
            app={app}
            display={display}
            onBookKitchen={onBookKitchen}
            onDiscoverKitchens={onDiscoverKitchens}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
