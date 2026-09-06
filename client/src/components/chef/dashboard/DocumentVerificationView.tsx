import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { InfoChip } from "@/components/chef/info-chip";
import { cn } from "@/lib/utils";
import DocumentUpload from "@/components/document-verification/DocumentUpload";
import { ChefPageHeader, InfoHint } from "@/components/chef/ui";
import { documentToneFromLabel } from "@/components/chef/applications/status";
import { useTranslation } from "react-i18next";

interface DocumentVerificationData {
  foodSafetyLicenseUrl?: string | null;
  foodEstablishmentCertUrl?: string | null;
  foodSafetyLicenseStatus?: string | null;
  foodEstablishmentCertStatus?: string | null;
}

interface DocumentVerificationViewProps {
  documentVerification: DocumentVerificationData | null | undefined;
  /** @deprecated Breadcrumbs handle navigation; kept for call-site compatibility */
  onBack?: () => void;
}

function statusLabel(
  status: string | null | undefined,
  uploaded: boolean,
  t: import("i18next").TFunction<"chef", undefined>,
) {
  if (!uploaded) return t("dvNotStarted");
  if (status === "approved") return t("ovDocVerified");
  if (status === "pending") return t("apDocInReviewLabel");
  if (status === "rejected") return t("dvNeedsAttention");
  return t("dvNotStarted");
}

export default function DocumentVerificationView({
  documentVerification,
}: DocumentVerificationViewProps) {
  const { t } = useTranslation("chef");
  const hasUploadedDocuments = Boolean(
    documentVerification?.foodSafetyLicenseUrl || documentVerification?.foodEstablishmentCertUrl,
  );
  const documentsArePending =
    hasUploadedDocuments && documentVerification?.foodSafetyLicenseStatus === "pending";
  const overallLabel = statusLabel(
    documentVerification?.foodSafetyLicenseStatus,
    Boolean(documentVerification?.foodSafetyLicenseUrl),
    t,
  );

  const steps = [
    { label: t("dvStepUpload"), done: hasUploadedDocuments },
    {
      label: t("dvStepReview"),
      done: documentVerification?.foodSafetyLicenseStatus === "approved",
      current: documentVerification?.foodSafetyLicenseStatus === "pending",
    },
    { label: t("dvStepVerified"), done: documentVerification?.foodSafetyLicenseStatus === "approved" },
  ];

  const tipTitle = t("duGoodToKnow");
  const tipSections = documentsArePending
    ? [{ title: t("dvPendingTitle"), body: t("dvPendingBody") }]
    : !hasUploadedDocuments
      ? [{ title: t("dvNeededTitle"), body: t("dvNeededBody") }]
      : [
          { title: t("duUpdateDocsTitle"), body: t("duUpdateDocsBody") },
          { title: t("duStatusResetTitle"), body: t("duStatusResetBody") },
        ];

  return (
    <div className="space-y-8">
      <ChefPageHeader
        title={t("dvTitle")}
        description={t("dvDesc")}
        titleAccessory={
          <InfoHint title={tipTitle}>
            {tipSections.map((section) => (
              <div key={section.title}>
                <p className="font-medium text-foreground">{section.title}</p>
                <p>{section.body}</p>
              </div>
            ))}
          </InfoHint>
        }
      />

      <Card className="shadow-none">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">{t("dvStatusLabel")}</CardTitle>
              <CardDescription>{t("dvStatusDesc")}</CardDescription>
            </div>
            <InfoChip tone={documentToneFromLabel(overallLabel)} className="shrink-0">
              {overallLabel}
            </InfoChip>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            {steps.map((step) => (
              <div key={step.label} className="min-w-0 flex-1">
                <div
                  className={cn(
                    "h-1 rounded-full",
                    step.done ? "bg-foreground" : step.current ? "bg-foreground/40" : "bg-border",
                  )}
                />
                <p className="mt-2 text-center text-xs text-muted-foreground">{step.label}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">{t("dvRequiredDocsTitle")}</CardTitle>
          <CardDescription>{t("dvRequiredDocsDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <DocumentUpload forceShowForm embedded />
        </CardContent>
      </Card>
    </div>
  );
}
