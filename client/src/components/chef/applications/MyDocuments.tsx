/**
 * "Your documents" (owner, Oct 23): which documents each location holds for this customer, what it asks for, and
 * what needs doing. Each location keeps its own copy and reviews it on its own, so a renewal is per location.
 * Status words follow the approved document-flow mocks (owner, Oct 27): Not sent · With the kitchen · New copy needed ·
 * Expires in N days · Expired · Verified.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { cn } from "@/lib/utils";
import { formatCalendarDate } from "@/lib/calendar-date";
import type { KitchenApplicationWithLocation } from "@/hooks/use-chef-kitchen-applications";

export type ApplicationDocument = {
  /** A built-in document, or one the kitchen added ("custom:<field id>"). */
  key: string; label: string; hasExpiry?: boolean; mode: "none" | "track" | "required"; waived: boolean;
  uploaded: boolean; status: string | null; expiry: string | null; daysLeft: number | null; stage: "expired" | "3_day" | "14_day" | "45_day" | null; renewalPending: boolean;
  /** When the current copy was sent and last checked; the kitchen's note when it asked for a new copy. */
  sentAt?: string | null; checkedAt?: string | null; note?: { text: string; at: string | null } | null;
  /** A renewed copy waiting beside the current one, or the last one the kitchen sent back (with its note). */
  renewal?: { status: string; sentAt?: string | null; expiry: string | null; note: string | null } | null;
};

/**
 * Where one document stands for the customer. `added` = uploaded early, before the booking requirements went to the
 * kitchen (still replaceable). `checking` and `renewal` = the kitchen has it; the customer can't swap it (owner, Oct 27).
 */
export type DocumentState = "waived" | "missing" | "rejected" | "expired" | "renewal" | "checking" | "added" | "expiring" | "verified";
export function documentState(document: ApplicationDocument, sentToKitchen: boolean): DocumentState {
  if (!document.uploaded) return document.waived || document.mode === "none" ? "waived" : "missing";
  if (document.status === "rejected") return "rejected";
  if (document.renewalPending) return "renewal";
  if (document.stage === "expired") return "expired";
  if (document.status !== "approved") return sentToKitchen ? "checking" : "added";
  return document.stage ? "expiring" : "verified";
}
/** What the customer should do about one document, if anything. */
export function documentNeedsAction(document: ApplicationDocument) {
  if (document.renewalPending) return false;
  if (!document.uploaded) return document.mode === "required" && !document.waived;
  return document.status === "rejected" || document.stage !== null;
}
export const blocksBooking = (document: ApplicationDocument) => document.mode === "required" && !document.waived;

/** The documents that decide booking, by state, plus when the kitchen last checked any of them (tracker and next step). */
export function documentSummary(app: { documents?: ApplicationDocument[]; tier2_completed_at?: unknown }) {
  const sent = !!app.tier2_completed_at;
  const required = (app.documents || []).filter(blocksBooking).map(document => ({ document, state: documentState(document, sent) }));
  const of = (...states: DocumentState[]) => required.filter(row => states.includes(row.state)).map(row => row.document);
  const latest = (values: (string | null | undefined)[]) => values.filter((value): value is string => !!value).sort().at(-1) ?? null;
  return { missing: of("missing"), rejected: of("rejected"), expired: of("expired"), checking: of("checking"), renewal: of("renewal"), expiring: of("expiring"),
    lastSent: latest(of("checking").map(document => document.sentAt)), lastChecked: latest((app.documents || []).map(document => document.checkedAt)) };
}

const LABEL_KEYS = { foodSafetyLicense: ["mdFoodSafety", "Food safety certificate"], foodEstablishmentCert: ["mdEstablishment", "Food establishment licence"], insurance: ["mdInsurance", "Insurance"] } as const;
export const documentName = (t: TFunction<"chef">, document: Pick<ApplicationDocument, "key" | "label">) =>
  document.key in LABEL_KEYS ? t(LABEL_KEYS[document.key as keyof typeof LABEL_KEYS][0], LABEL_KEYS[document.key as keyof typeof LABEL_KEYS][1]) : document.label;
/** "Oct 27, 2026": one format for every document date. Calendar dates (expiry) stay on their day in any time zone. */
export const documentDate = (value: string | null | undefined, locale: string, calendar = false) => {
  if (!value) return "";
  if (calendar) return formatCalendarDate(value, locale, { year: "numeric", month: "short", day: "numeric" });
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
};

const PILL = { green: "bg-emerald-50 text-emerald-800", amber: "bg-amber-50 text-amber-900", red: "bg-red-50 text-red-800", grey: "bg-muted text-foreground/75" } as const;
export function Pill({ tone, children }: { tone: keyof typeof PILL; children: ReactNode }) {
  return <span className={cn("inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-medium", PILL[tone])}>{children}</span>;
}

/** The pill and the grey line under a document's name, worded per state (shared by the kitchen page and the overview). */
export function useDocumentWords() {
  const { t, i18n } = useTranslation("chef");
  const day = (value?: string | null, calendar = false) => documentDate(value, i18n.language, calendar);
  const pill = (document: ApplicationDocument, state: DocumentState): [keyof typeof PILL, string] => {
    switch (state) {
      case "missing": return ["grey", t("dfNotSent", "Not sent")];
      case "rejected": return ["red", t("dfNewCopyNeeded", "New copy needed")];
      case "expired": return ["red", t("mdExpired", "Expired")];
      case "checking": return ["amber", t("dfWithKitchen", "With the kitchen")];
      case "added": return ["grey", t("dfAdded", "Added")];
      case "expiring": return ["amber", t("dfExpiresIn", { defaultValue: "{count, plural, one {Expires in # day} other {Expires in # days}}", count: document.daysLeft ?? 0 })];
      default: return ["green", t("mdVerified", "Verified")];
    }
  };
  const meta = (document: ApplicationDocument, state: DocumentState) => {
    const need = document.waived ? t("mdNotRequiredHere", "Not required for you here") : document.mode === "required" ? t("dfRequiredToBook", "Required to book")
      : document.mode === "track" ? t("dfOptional", "Optional") : t("mdOnFile", "On file");
    const expires = document.expiry ? t("mdExpires", { defaultValue: "expires {date}", date: day(document.expiry, true) }) : document.hasExpiry === false ? t("dfNoExpiry", "no expiry") : "";
    const sent = document.sentAt ? t("dfSentOn", { defaultValue: "sent {date}", date: day(document.sentAt) }) : "";
    const facts = state === "missing" ? [document.hasExpiry === false ? t("dfNoExpiry", "no expiry") : t("dfHasExpiry", "has an expiry date")]
      : state === "rejected" ? [sent]
      : state === "expired" ? [t("mdExpiredOn", { defaultValue: "expired {date}", date: day(document.expiry, true) })]
      : state === "checking" ? [sent, expires] : [expires];
    return [need, ...facts].filter(Boolean).join(" · ");
  };
  return { t, day, pill, meta };
}

/** One location's documents, as on "Your documents", with a View link; used on the application details too. */
export function ApplicationDocumentRows({ app, viewLink, actions = true }: { app: KitchenApplicationWithLocation & { documents?: ApplicationDocument[] }; viewLink?: (key: ApplicationDocument["key"]) => ReactNode;
  /** False while the request is still with the kitchen. */
  actions?: boolean }) {
  const { t, pill, meta } = useDocumentWords();
  const sentToKitchen = !!app.tier2_completed_at;
  return <ul className="divide-y">
    {app.documents!.map(document => {
      const state = documentState(document, sentToKitchen);
      const [tone, label] = pill(document, state);
      const needs = documentNeedsAction(document);
      return <li key={document.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 text-sm first:pt-0 last:pb-0">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><p className="font-medium">{documentName(t, document)}</p>{state !== "waived" && <Pill tone={tone}>{label}</Pill>}</div>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{meta(document, state)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {document.uploaded && viewLink?.(document.key)}
          {/* Before the booking requirements are sent, the step-2 form; after, the row on the kitchen page. */}
          {needs && actions && <Link href={(app.current_tier ?? 1) < 3 && !app.documentsWaivedAt && !app.tier2_completed_at ? `/apply-kitchen/${app.locationId}` : `/dashboard?view=kitchen-requests&application=${app.id}&renew=1`}
            className="!min-h-0 rounded-full border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted">{document.uploaded ? t("dfSendNewCopy", "Send new copy") : t("mdUpload", "Upload")}</Link>}
        </div>
      </li>;
    })}
  </ul>;
}

export function MyDocuments({ applications }: { applications: (KitchenApplicationWithLocation & { documents?: ApplicationDocument[] })[] }) {
  const { t } = useTranslation("chef");
  // Documents are collected once the first request is approved; a request still in review has nothing to do here yet.
  // A waived document that was never uploaded is nothing to show (the location line says it isn’t needed).
  const rows = applications.filter(app => app.status === "approved")
    .map(app => ({ ...app, documents: (app.documents || []).filter(doc => doc.uploaded || !doc.waived) }))
    .filter(app => app.documents.length);
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
