import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
import DocumentUpload from "@/components/document-verification/DocumentUpload";
import { ChefPageHeader, QuietNotice } from "@/components/chef/ui";
import { documentToneFromLabel, toneToBadgeVariant } from "@/components/chef/applications/status";
import { useTranslation } from "react-i18next";

interface DocumentVerificationData {
  foodSafetyLicenseUrl?: string | null;
  foodEstablishmentCertUrl?: string | null;
  foodSafetyLicenseStatus?: string | null;
  foodEstablishmentCertStatus?: string | null;
}

interface DocumentVerificationViewProps {
  documentVerification: DocumentVerificationData | null | undefined;
  onBack: () => void;
}

function statusLabel(status: string | null | undefined, uploaded: boolean, t: import("i18next").TFunction<"chef", undefined>) {
  if (!uploaded) return t("dvNotStarted");
  if (status === "approved") return t("ovDocVerified");
  if (status === "pending") return t("apDocInReviewLabel");
  if (status === "rejected") return t("dvNeedsAttention");
  return t("dvNotStarted");
}

export default function DocumentVerificationView({
  documentVerification,
  onBack,
}: DocumentVerificationViewProps) {
  const { t } = useTranslation("chef");
  const hasUploadedDocuments = Boolean(
    documentVerification?.foodSafetyLicenseUrl || documentVerification?.foodEstablishmentCertUrl
  );
  const documentsArePending =
    hasUploadedDocuments && documentVerification?.foodSafetyLicenseStatus === "pending";
  const overallLabel = statusLabel(
    documentVerification?.foodSafetyLicenseStatus,
    Boolean(documentVerification?.foodSafetyLicenseUrl),
    t
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

  return (
    <div className="space-y-6">
      <ChefPageHeader
        title={t("dvTitle")}
        description={t("dvDesc")}
        actions={
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft />
            {t("dvBack")}
          </Button>
        }
      />

      <Card className="shadow-none">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">{t("dvStatusLabel")}</CardTitle>
              <CardDescription>{t("dvStatusDesc")}</CardDescription>
            </div>
            <Badge variant={toneToBadgeVariant(documentToneFromLabel(overallLabel))} className="font-medium">
              {overallLabel}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            {steps.map((step, index) => (
              <div key={step.label} className="flex flex-1 items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "h-1 rounded-full",
                      step.done ? "bg-foreground" : step.current ? "bg-foreground/40" : "bg-border"
                    )}
                  />
                  <p className="mt-2 text-center text-xs text-muted-foreground">{step.label}</p>
                </div>
                {index < steps.length - 1 ? null : null}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {documentsArePending && (
        <QuietNotice title={t("dvPendingTitle")}>
          {t("dvPendingBody")}
        </QuietNotice>
      )}

      {!hasUploadedDocuments && (
        <QuietNotice title={t("dvNeededTitle")}>
          {t("dvNeededBody")}
        </QuietNotice>
      )}

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">{t("dvRequiredDocsTitle")}</CardTitle>
          <CardDescription>{t("dvRequiredDocsDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <DocumentUpload forceShowForm={true} />
        </CardContent>
      </Card>
    </div>
  );
}
