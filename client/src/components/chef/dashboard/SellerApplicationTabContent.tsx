import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { ChefPageHeader, QuietNotice, StatTile, StatusDot } from "@/components/chef/ui";
import { TruncatedText } from "@/components/common/TruncatedText";
import { KitchenApplicationCard } from "@/components/chef/applications";
import EmptyApplicationState from "./EmptyApplicationState";
import {
  documentToneFromLabel,
  getKitchenDisplayStatus,
  toneToBadgeVariant,
  type StatusTone,
} from "@/components/chef/applications/status";
import { formatApplicationStatus } from "@/lib/applicationSchema";
import { Application } from "@shared/schema";
import { ArrowRight, Building, Store } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { KitchenApplicationWithLocation, PublicKitchen } from "./types";

interface SellerApplicationTabContentProps {
  applications: Application[];
  kitchenApplications: KitchenApplicationWithLocation[];
  publicKitchens?: PublicKitchen[];
  onStartApplication: () => void;
  onManageDocuments: () => void;
  onCancelApplication: (type: "chef", id: number) => void;
  onDiscoverKitchens: () => void;
  onBookKitchen: (locationId: number, locationName: string, locationAddress?: string) => void;
}

function sellerTone(status: string): StatusTone {
  const value = status.toLowerCase();
  if (value.includes("approved")) return "success";
  if (value.includes("rejected")) return "danger";
  if (value.includes("cancel")) return "neutral";
  if (
    value.includes("review") ||
    value.includes("pending") ||
    value.includes("started") ||
    value === "new"
  ) {
    return "progress";
  }
  return "neutral";
}

function kitchenLabel(preference: string | null | undefined, t: ChefT) {
  switch (preference) {
    case "commercial":
      return t("apPrefCommercial");
    case "home":
      return t("apPrefHome");
    case "notSure":
      return t("apPrefNotSure");
    default:
      return "—";
  }
}

function formatDate(value: string | Date | null | undefined, locale: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type DocCopy = { label: string; hint: string };

type ChefT = import("i18next").TFunction<"chef", undefined>;

function documentsCopy(app: Application, t: ChefT): DocCopy {
  if (app.status === "approved") {
    const foodSafetyOk = app.foodSafetyLicenseStatus === "approved";
    const establishmentOk = !app.foodEstablishmentCertUrl || app.foodEstablishmentCertStatus === "approved";
    if (foodSafetyOk && establishmentOk) return { label: t("ovDocVerified"), hint: t("apDocVerifiedHint") };
    if (app.foodSafetyLicenseStatus === "rejected" || app.foodEstablishmentCertStatus === "rejected") {
      return { label: t("ovDocRejected"), hint: t("apDocRejectedHint") };
    }
    return { label: t("apDocInReviewLabel"), hint: t("apDocInReviewHint") };
  }
  if (app.status === "inReview") {
    const uploaded =
      Boolean(app.foodSafetyLicenseUrl) &&
      (Boolean(app.foodEstablishmentCertUrl) || app.foodEstablishmentCert !== "yes");
    return uploaded
      ? { label: t("apDocUploadedLabel"), hint: t("apDocUploadedHint") }
      : { label: t("apDocNeededLabel"), hint: t("apDocNeededHint") };
  }
  return { label: t("apDocRequiredLabel"), hint: t("apDocRequiredHint") };
}

function docRow(status: string | null | undefined, uploaded: boolean, t: ChefT) {
  if (!uploaded) return { variant: "outline" as const, label: t("apptabDocNotUploaded") };
  const tone = documentToneFromLabel(status || "pending");
  const label =
    status === "approved" ? t("apptabDocApproved")
    : status === "rejected" ? t("apptabDocRejected")
    : status ? t("apptabDocPending")
    : t("apptabDocPending");
  return {
    variant: toneToBadgeVariant(tone),
    label,
  };
}

export default function SellerApplicationTabContent({
  applications,
  kitchenApplications,
  publicKitchens,
  onStartApplication,
  onManageDocuments,
  onCancelApplication,
  onDiscoverKitchens,
  onBookKitchen,
}: SellerApplicationTabContentProps) {
  const { t, i18n } = useTranslation("chef");
  const sorted = useMemo(
    () =>
      [...applications].sort((a, b) => {
        const aTime = new Date(a.createdAt as unknown as string).getTime();
        const bTime = new Date(b.createdAt as unknown as string).getTime();
        return bTime - aTime;
      }),
    [applications]
  );

  const current = sorted[0] ?? null;
  const earlier = sorted.slice(1);
  const hasActiveSeller = sorted.some((app) => app.status !== "cancelled" && app.status !== "rejected");
  const hasSeller = Boolean(current);
  const hasKitchens = kitchenApplications.length > 0;

  const kitchenDisplays = useMemo(
    () => kitchenApplications.map((app) => ({ app, display: getKitchenDisplayStatus(app, t) })),
    [kitchenApplications, t]
  );
  const kitchensNeedingAction = kitchenDisplays.filter((item) => item.display.tone === "warning").length;
  const kitchensInReview = kitchenDisplays.filter((item) => item.display.tone === "progress").length;
  const kitchensReady = kitchenDisplays.filter((item) => item.display.actionKind === "book").length;
  const kitchenTone: StatusTone = kitchensNeedingAction
    ? "warning"
    : kitchensReady
      ? "success"
      : kitchensInReview
        ? "progress"
        : hasKitchens
          ? "neutral"
          : "neutral";
  const kitchenValue = !hasKitchens
    ? t("apKitchenNone")
    : kitchensNeedingAction
      ? kitchensNeedingAction === 1
        ? t("apKitchenActionNeeded")
        : t("apKitchenNeedYou", { count: kitchensNeedingAction })
      : kitchensReady
        ? kitchensReady === 1
          ? t("apKitchenReady")
          : t("apKitchenReadyCount", { count: kitchensReady })
        : kitchensInReview
          ? kitchensInReview === 1
            ? t("apKitchenInReview")
            : t("apKitchenInReviewCount", { count: kitchensInReview })
          : `${kitchenApplications.length}`;
  const kitchenHint = !hasKitchens
    ? t("apApplyKitchenHint")
    : kitchenApplications.length === 1
      ? kitchenDisplays[0]?.app.location?.name || t("apKitchenOne")
      : t("apKitchenCount", { count: kitchenApplications.length });

  if (!hasSeller && !hasKitchens) {
    return (
      <div className="space-y-8">
        <ChefPageHeader
          title={t("apMyApplication")}
          description={t("apptabGetStartedDesc")}
        />
        <EmptyApplicationState
          onStartSellerApplication={onStartApplication}
          onDiscoverKitchens={onDiscoverKitchens}
        />
      </div>
    );
  }

  const statusLabel = current ? formatApplicationStatus(current.status, t) : t("apNotStartedStatus");
  const statusTone = current ? sellerTone(current.status) : "neutral";
  const docs = current ? documentsCopy(current, t) : { label: "—", hint: t("ovApplyToSellHint") };
  const docsTone = current ? documentToneFromLabel(docs.label) : "neutral";
  const kitchenPref = kitchenLabel(current?.kitchenPreference, t);
  const submitted = formatDate(current?.createdAt as unknown as string, i18n.language);
  const foodSafety = current
    ? docRow(current.foodSafetyLicenseStatus, Boolean(current.foodSafetyLicenseUrl), t)
    : null;
  const establishment = current
    ? docRow(current.foodEstablishmentCertStatus, Boolean(current.foodEstablishmentCertUrl), t)
    : null;
  const docsNeedAction = docsTone === "warning" || docsTone === "danger";
  const canManageDocs = Boolean(current) && current.status !== "cancelled" && current.status !== "rejected";
  const canCancel = Boolean(current) && current.status !== "approved" && current.status !== "cancelled";

  const subtitle = docsNeedAction
    ? t("apSubtitleDocsAction")
    : kitchensNeedingAction
      ? t("apSubtitleKitchenAction")
      : hasSeller && hasKitchens
        ? t("apSubtitleBoth")
        : hasSeller
          ? t("apSubtitleSellerOnly")
          : t("apSubtitleKitchenOnly");

  return (
    <div className="space-y-8">
      <ChefPageHeader title={t("apMyApplication")} description={subtitle} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={t("apStatSeller")}
          value={statusLabel}
          hint={current ? t("apApplicationIdHint", { id: current.id }) : t("ovApplyToSellHint")}
          tone={statusTone}
        />
        <StatTile label={t("apStatDocuments")} value={docs.label} hint={docs.hint} tone={docsTone} />
        <StatTile label={t("apStatKitchens")} value={kitchenValue} hint={kitchenHint} tone={kitchenTone} />
        <StatTile
          label={t("apStatKitchenSetting")}
          value={hasSeller ? kitchenPref : "—"}
          hint={hasSeller ? t("apWhereYouCook") : t("apSetWhenApply")}
        />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section className="flex min-h-full flex-col">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">{t("apSectionSeller")}</h3>
              <p className="text-xs text-muted-foreground">{t("apSectionSellerDesc")}</p>
            </div>
            {current ? (
              <Badge variant={toneToBadgeVariant(statusTone)} className="shrink-0 font-medium">
                {statusLabel}
              </Badge>
            ) : null}
          </div>
          <Card className="flex flex-1 flex-col shadow-none">
            <CardContent className="flex-1 pt-4">
              {current && foodSafety && establishment ? (
                <div className="space-y-4">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <div>
                      <dt className="text-xs text-muted-foreground">{t("apRowReference")}</dt>
                      <dd className="mt-1 truncate text-sm font-medium">#{current.id}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">{t("apRowSubmitted")}</dt>
                      <dd className="mt-1 truncate text-sm font-medium">{submitted}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">{t("apRowName")}</dt>
                      <dd className="mt-1">
                        <TruncatedText className="block truncate text-sm font-medium">{current.fullName || "—"}</TruncatedText>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">{t("apRowKitchen")}</dt>
                      <dd className="mt-1">
                        <TruncatedText className="block truncate text-sm font-medium">{kitchenPref}</TruncatedText>
                      </dd>
                    </div>
                  </dl>
                  <div className="grid grid-cols-1 gap-2">
                    <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
                      <span className="text-sm">{t("apFoodSafetyLicense")}</span>
                      <Badge variant={foodSafety.variant} className="font-medium">
                        {foodSafety.label}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
                      <span className="text-sm">{t("apEstablishmentCert")}</span>
                      <Badge variant={establishment.variant} className="font-medium">
                        {establishment.label}
                      </Badge>
                    </div>
                  </div>
                  {current.feedback ? (
                    <QuietNotice title={t("apReviewerFeedback")}>{current.feedback}</QuietNotice>
                  ) : null}
                  {earlier.length > 0 ? (
                    <ul className="divide-y border-t pt-1">
                      {earlier.map((app) => (
                        <li key={app.id} className="flex items-center justify-between gap-3 py-2.5">
                          <TruncatedText as="p" className="truncate text-sm text-muted-foreground">{`#${app.id}`}</TruncatedText>
                          <span className="flex items-center gap-2 text-sm">
                            <StatusDot tone={sellerTone(app.status)} />
                            {formatApplicationStatus(app.status, t)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("apOneApplicationNote")}
                </p>
              )}
            </CardContent>
            <CardFooter className="mt-auto w-full flex-row justify-between gap-2">
              {current && canCancel ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => onCancelApplication("chef", current.id)}
                >
                  {t("apCancelBtn")}
                </Button>
              ) : (
                <span />
              )}
              {current && canManageDocs ? (
                <Button
                  className="ml-auto"
                  variant={docsNeedAction ? "default" : "outline"}
                  onClick={onManageDocuments}
                >
                  {docsNeedAction ? t("apUpdateDocuments") : t("apManageDocuments")}
                  <ArrowRight />
                </Button>
              ) : !hasActiveSeller ? (
                <Button className="ml-auto w-full" onClick={onStartApplication}>
                  <Store />
                  {t("apStartSellerApplication")}
                  <ArrowRight />
                </Button>
              ) : null}
            </CardFooter>
          </Card>
        </section>

        <section className="flex min-h-full flex-col">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">{t("apSectionKitchens")}</h3>
              <p className="text-xs text-muted-foreground">{t("apSectionKitchensDesc")}</p>
            </div>
            {hasKitchens ? (
              <Badge variant={toneToBadgeVariant(kitchenTone)} className="shrink-0 font-medium">
                {kitchenValue}
              </Badge>
            ) : null}
          </div>
          {hasKitchens ? (
            <div className="flex flex-1 flex-col gap-2">
              {kitchenApplications.map((app) => {
                const kitchenData = publicKitchens?.find((k) => k.locationId === app.locationId);
                return (
                  <KitchenApplicationCard
                    key={app.id}
                    application={app}
                    kitchenImageUrl={kitchenData?.imageUrl}
                    onBookKitchen={onBookKitchen}
                    onDiscoverKitchens={onDiscoverKitchens}
                  />
                );
              })}
              <Button variant="outline" className="mt-auto w-full" onClick={onDiscoverKitchens}>
                <Building />
                {t("apDiscoverMoreKitchens")}
                <ArrowRight />
              </Button>
            </div>
          ) : (
            <Card className="flex flex-1 flex-col shadow-none">
              <CardContent className="flex-1 pt-4">
                <p className="text-sm text-muted-foreground">
                  {t("apBrowsePartnerKitchens")}
                </p>
              </CardContent>
              <CardFooter className="mt-auto w-full">
                <Button variant="outline" className="w-full" onClick={onDiscoverKitchens}>
                  <Building />
                  {t("apBrowseKitchens")}
                  <ArrowRight />
                </Button>
              </CardFooter>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}
