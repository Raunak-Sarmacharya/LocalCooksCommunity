/**
 * "Your documents" (owner, Oct 23): which documents each location holds for this customer, what it asks for, and
 * what needs doing. Each location keeps its own copy and reviews it on its own, so a renewal is per location.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { formatCalendarDate } from "@/lib/calendar-date";
import type { KitchenApplicationWithLocation } from "@/hooks/use-chef-kitchen-applications";

export type ApplicationDocument = {
  /** A built-in document, or one the kitchen added ("custom:<field id>"). */
  key: string; label: string; hasExpiry?: boolean; mode: "none" | "track" | "required"; waived: boolean;
  uploaded: boolean; status: string | null; expiry: string | null; daysLeft: number | null; stage: "expired" | "3_day" | "14_day" | "45_day" | null; renewalPending: boolean;
};

const LABEL_KEYS = { foodSafetyLicense: ["mdFoodSafety", "Food safety certificate"], foodEstablishmentCert: ["mdEstablishment", "Food establishment licence"], insurance: ["mdInsurance", "Insurance"] } as const;

/** What the customer should do about one document, if anything. */
export function documentNeedsAction(document: ApplicationDocument) {
  if (document.renewalPending) return false;
  if (!document.uploaded) return document.mode === "required" && !document.waived;
  return document.status === "rejected" || document.stage !== null;
}

/** One location's documents, as on "Your documents", with a View link; used on the application page too. */
export function ApplicationDocumentRows({ app, viewLink }: { app: KitchenApplicationWithLocation & { documents?: ApplicationDocument[] }; viewLink?: (key: ApplicationDocument["key"]) => ReactNode }) {
  const { t, i18n } = useTranslation("chef");
  const statusOf = (document: ApplicationDocument) => !document.uploaded ? t("mdNotUploaded", "Not uploaded")
    : document.renewalPending ? t("mdRenewalInReview", "Renewal in review")
    : document.stage === "expired" ? t("mdExpired", "Expired")
    : document.status === "approved" ? t("mdVerified", "Verified") : document.status === "rejected" ? t("mdNeedsReplacement", "Needs a replacement") : t("mdInReview", "In review");
  const modeOf = (document: ApplicationDocument) => document.waived ? t("mdNotRequiredHere", "Not required for you here")
    : document.mode === "required" ? t("mdRequired", "Required") : document.mode === "track" ? t("mdTracked", "Kept on file") : t("mdOnFile", "On file");
  return <ul className="divide-y">
    {app.documents!.map(document => {
      const needs = documentNeedsAction(document);
      const expiry = document.expiry ? formatCalendarDate(document.expiry, i18n.language, { year: "numeric", month: "short", day: "numeric" }) : null;
      return <li key={document.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0 text-sm">
        <div className="min-w-0">
          <p className="font-medium">{document.key in LABEL_KEYS ? t(LABEL_KEYS[document.key as keyof typeof LABEL_KEYS][0], LABEL_KEYS[document.key as keyof typeof LABEL_KEYS][1]) : document.label}</p>
          <p className="text-xs text-muted-foreground">{modeOf(document)} · <span className={cn(needs && "font-medium text-amber-800", document.stage === "expired" && "text-red-700")}>{statusOf(document)}</span>
            {expiry && <> · {document.stage === "expired" ? t("mdExpiredOn", { defaultValue: "expired {date}", date: expiry }) : t("mdExpires", { defaultValue: "expires {date}", date: expiry })}</>}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {document.uploaded && viewLink?.(document.key)}
          {/* Before the booking requirements are sent, the step-2 form; after, the upload form on the application page. */}
          {needs && <Link href={(app.current_tier ?? 1) < 3 && !app.documentsWaivedAt && !app.tier2_completed_at ? `/apply-kitchen/${app.locationId}` : `/dashboard?view=kitchen-requests&application=${app.id}&renew=1`}
            className="!min-h-0 rounded-full border border-primary bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">{document.uploaded ? t("mdRenew", "Renew") : t("mdUpload", "Upload")}</Link>}
        </div>
      </li>;
    })}
  </ul>;
}

export function MyDocuments({ applications }: { applications: (KitchenApplicationWithLocation & { documents?: ApplicationDocument[] })[] }) {
  const { t } = useTranslation("chef");
  // Documents are collected once the first request is approved; a request still in review has nothing to do here yet.
  const rows = applications.filter(app => app.documents?.length && app.status === "approved");
  if (!rows.length) return null;
  return (
    <section aria-labelledby="my-documents" className="rounded-xl border bg-card p-5" data-testid="my-documents">
      <h2 id="my-documents" className="text-base font-semibold">{t("mdTitle", "Your documents")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("mdLead", "Each location keeps its own copy and reviews it. Renew where it’s needed.")}</p>
      <div className="mt-4 divide-y">
        {rows.map(app => (
          <div key={app.id} className="py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className="text-sm font-semibold">{app.location?.name || t("apptabKitchenFallback", "Kitchen")}</h3>
              {app.documentsWaivedAt && <span className="text-xs text-muted-foreground">{t("mdWaivedLocation", "This location doesn’t need documents from you")}</span>}
            </div>
            <div className="mt-2"><ApplicationDocumentRows app={app} /></div>
          </div>
        ))}
      </div>
    </section>
  );
}
