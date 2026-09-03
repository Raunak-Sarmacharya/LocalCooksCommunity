import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatApplicationStatus } from "@/lib/applicationSchema";
import { Application } from "@shared/schema";
import {
  applicationStatusVariant,
  documentToneFromLabel,
  toneToBadgeVariant,
} from "./status";
import type { StatusVariant } from "@/components/chef/dashboard/types";

type ChefTFunction = TFunction<"chef", undefined>;

interface SellerApplicationCardProps {
  application: Application;
  onCancelApplication: (type: "chef", id: number) => void;
  onManageDocuments: () => void;
  getStatusVariant: (status: string) => StatusVariant;
}

function docBadge(
  status: string | null | undefined,
  uploaded: boolean,
  t: ChefTFunction,
) {
  if (!uploaded) {
    return { variant: "outline" as const, label: t("docNotUploaded", "Not uploaded") };
  }
  const tone = documentToneFromLabel(status || "pending");
  return {
    variant: toneToBadgeVariant(tone),
    label: status
      ? status.charAt(0).toUpperCase() + status.slice(1)
      : t("docPending", "Pending"),
  };
}

export default function SellerApplicationCard({
  application: app,
  onCancelApplication,
  onManageDocuments,
}: SellerApplicationCardProps) {
  const { t, i18n } = useTranslation("chef");
  const [isExpanded, setIsExpanded] = useState(false);

  const foodSafetyStatus =
    "foodSafetyLicenseStatus" in app ? (app as Application).foodSafetyLicenseStatus : undefined;
  const establishmentStatus =
    "foodEstablishmentCertStatus" in app
      ? (app as Application).foodEstablishmentCertStatus
      : undefined;
  const foodSafetyUrl =
    "foodSafetyLicenseUrl" in app ? (app as Application).foodSafetyLicenseUrl : undefined;
  const establishmentUrl =
    "foodEstablishmentCertUrl" in app
      ? (app as Application).foodEstablishmentCertUrl
      : undefined;

  const foodSafety = docBadge(foodSafetyStatus, Boolean(foodSafetyUrl), t);
  const establishment = docBadge(establishmentStatus, Boolean(establishmentUrl), t);

  const docsNeedAction =
    foodSafety.variant === "destructive" ||
    foodSafety.variant === "warning" ||
    establishment.variant === "destructive" ||
    establishment.variant === "warning" ||
    !foodSafetyUrl;

  const docsSummary = !foodSafetyUrl
    ? t("sellerDocsNeeded", "Documents needed")
    : foodSafety.variant === "destructive" || establishment.variant === "destructive"
      ? t("sellerDocsRejected", "Documents rejected")
      : foodSafety.variant === "success" &&
          (establishment.variant === "success" || !establishmentUrl)
        ? t("sellerDocsVerified", "Documents verified")
        : t("sellerDocsInReview", "Documents in review");

  const statusMessage =
    app.status === "approved"
      ? t(
          "sellerApprovedStatusMsg",
          "Approved. Finish document verification if anything is still outstanding, then you can start selling."
        )
      : app.status === "inReview"
        ? t(
            "sellerInReviewStatusMsg",
            "Our team is reviewing this application. You'll be notified when there's a decision."
          )
        : app.status === "rejected"
          ? t(
              "sellerRejectedStatusMsg",
              "This application was not approved. Review any feedback, then submit a new one if you want to try again."
            )
          : app.status === "cancelled"
            ? t("sellerCancelledStatusMsg", "This application was cancelled.")
            : "";

  const submittedDate = app.createdAt
    ? new Date(app.createdAt).toLocaleDateString(i18n.language)
    : "";

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <Card className="overflow-hidden shadow-none">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-muted/40"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">
                  {t("sellerApplicationCardTitle", { id: app.id, defaultValue: `Seller application #${app.id}` })}
                </p>
                <Badge variant={applicationStatusVariant(app.status)} className="font-medium">
                  {formatApplicationStatus(app.status, t)}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("sellerSubmittedOn", { date: submittedDate, defaultValue: `Submitted ${submittedDate}` })}
                <span className="mx-1.5 text-border">·</span>
                {docsSummary}
              </p>
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                isExpanded && "rotate-180"
              )}
            />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="space-y-5 border-t px-4 pb-4 pt-4">
            {statusMessage && (
              <p className="text-sm text-muted-foreground">{statusMessage}</p>
            )}

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("sellerSubmittedInformation", "Submitted information")}
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">{t("fullName", "Full name")}</dt>
                  <dd className="truncate text-sm font-medium">{app.fullName || t("notAvailable", "N/A")}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("email", "Email")}</dt>
                  <dd className="truncate text-sm font-medium">{app.email || t("notAvailable", "N/A")}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("phone", "Phone")}</dt>
                  <dd className="text-sm font-medium">{app.phone || t("notAvailable", "N/A")}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("kitchenPreference", "Kitchen preference")}</dt>
                  <dd className="text-sm font-medium capitalize">{app.kitchenPreference || t("notAvailable", "N/A")}</dd>
                </div>
              </dl>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("documents", "Documents")}
                </p>
                {app.status !== "cancelled" && app.status !== "rejected" && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onManageDocuments}>
                    <FileText className="h-3 w-3" />
                    {docsNeedAction ? t("update", "Update") : t("manage", "Manage")}
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
                  <span className="text-sm">{t("foodSafetyLicense", "Food Safety License")}</span>
                  <Badge variant={foodSafety.variant} className="font-medium">
                    {foodSafety.label}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
                  <span className="text-sm">{t("establishmentCert", "Establishment Cert")}</span>
                  <Badge variant={establishment.variant} className="font-medium">
                    {establishment.label}
                  </Badge>
                </div>
              </div>
            </div>

            {app.feedback && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("reviewerFeedback", "Reviewer feedback")}
                </p>
                <p className="text-sm text-muted-foreground">{app.feedback}</p>
              </div>
            )}

            {app.status !== "approved" && app.status !== "cancelled" && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => onCancelApplication("chef", app.id)}
              >
                {t("cancelApplication", "Cancel application")}
              </Button>
            )}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
