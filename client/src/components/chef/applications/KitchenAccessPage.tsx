/**
 * One kitchen, from the chef's side (owner-approved mock, Oct 26): who, where, the tracker, ONE next step, the kitchen's
 * booking requirements, then what the chef sent. Airbnb Trips / Turo pattern: the trip itself is the hub, so "request sent"
 * lands here with a one-time banner instead of a separate confirmation page. The kitchen is always the one reviewing.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Check, MessageCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fromCalendarDate } from "@/lib/calendar-date";
import { formatCurrency } from "@/lib/formatters";
import { kitchenPreviewPath } from "@/lib/discover-location-groups";
import { chefDashboardHref } from "@/lib/chef-dashboard-nav";
import { SecureDocumentLink } from "@/components/common/SecureDocumentLink";
import type { KitchenApplicationWithLocation } from "@/hooks/use-chef-kitchen-applications";
import { getKitchenDisplayStatus, hasStep2BeenSubmitted } from "./status";
import { KitchenAccessTracker } from "./KitchenAccessTracker";
import { KitchenApplicationDetails, type ApplicationFieldDefinitions } from "./KitchenApplicationDetails";
import { documentName, documentNeedsAction, documentState, documentSummary } from "./MyDocuments";
import { YourDocuments, lowerFirst } from "./YourDocuments";
import { customDocumentFields } from "@shared/location-booking-eligibility";

type PublicKitchen = { id: number; locationId: number; name: string; imageUrl?: string | null; hourlyRate?: number | null; currency?: string | null; brandImageUrl?: string | null };

export function KitchenAccessPage({ app, sent, notice, renewRequested, onOpenChat, onChanged, onDismissNotice }: {
  app: KitchenApplicationWithLocation;
  /** Just sent (the request, or the booking requirements): show the one-time banner. */
  sent: "request" | "requirements" | "joined" | null;
  /** Arrived from a tour link or a Request to apply link after already applying. */
  notice: "tour" | "applied" | null;
  renewRequested: boolean;
  onOpenChat?: (app: KitchenApplicationWithLocation) => void;
  onChanged: () => void;
  onDismissNotice: () => void;
}) {
  const { t, i18n } = useTranslation("chef");
  const [, navigate] = useLocation();
  // The one document row with its upload form open; documents sent from this page this visit (for the banner).
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [sentDocs, setSentDocs] = useState<string[]>([]);
  const display = getKitchenDisplayStatus(app, t);
  const tier = app.current_tier ?? 1;
  const step2Sent = hasStep2BeenSubmitted(app);
  const kitchenName = app.location?.name || t("apptabKitchenFallback", "Kitchen");
  const day = (value: unknown) => { const date = value ? fromCalendarDate(value as string) : null; return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString(i18n.language, { month: "short", day: "numeric" }) : ""; };

  const definitions = useQuery<ApplicationFieldDefinitions>({
    queryKey: [`/api/public/locations/${app.locationId}/requirements`],
    queryFn: async () => { const response = await fetch(`/api/public/locations/${app.locationId}/requirements`); if (!response.ok) throw new Error("Could not load field labels"); return response.json(); },
  });
  // Same cached list Find kitchens uses: the photo and price of this location's kitchen.
  const { data: kitchens = [] } = useQuery<PublicKitchen[]>({ queryKey: ["/api/public/kitchens"], queryFn: async () => { const response = await fetch("/api/public/kitchens"); if (!response.ok) throw new Error("kitchens"); return response.json(); } });
  const kitchen = kitchens.find(item => item.locationId === app.locationId);
  const photo = kitchen?.imageUrl || app.location?.brandImageUrl || kitchen?.brandImageUrl || null;
  const rate = kitchen?.hourlyRate ? t("kaRate", { defaultValue: "{amount}/hr", amount: formatCurrency(kitchen.hourlyRate, kitchen.currency || "CAD", i18n.language) }) : null;

  // Waived: only what they did upload; the rest is noise ("not required · not uploaded").
  const documents = (app.documents || []).filter(doc => !app.documentsWaivedAt || doc.uploaded);
  const neededDocs = documents.filter(documentNeedsAction);
  // Added after the booking requirements were sent: the kitchen asked for something more (owner, Oct 24).
  // Missing or sent back only: one that merely expires soon is the reminder/renewal flow, not "the kitchen asked for more".
  const addNow = tier < 3 && step2Sent ? neededDocs.filter(doc => !doc.uploaded || doc.status === "rejected") : [];
  const inFirstReview = display.actionKind === "wait" && !step2Sent && tier < 2 && !display.bookingBlocked;
  const docs = documentSummary(app);
  const toSend = [...docs.rejected, ...docs.expired, ...docs.missing];
  const book = () => navigate(kitchenPreviewPath(app.locationId));
  // Rows upload through the documents PATCH once the kitchen approved the request (or early, while it is in review);
  // between those, the step-2 form sends documents and answers together.
  const canUpload = inFirstReview || (app.status === "approved" && !app.documentsWaivedAt && (step2Sent || tier >= 3));
  const showSendDocuments = (first = toSend[0] ?? documents.find(doc => ["missing", "rejected", "expired", "expiring"].includes(documentState(doc, step2Sent)))) => {
    if (first && canUpload) setOpenKey(first.key);
    requestAnimationFrame(() => { const section = document.getElementById("your-documents"); section?.scrollIntoView?.({ behavior: "smooth", block: "start" }); section?.focus?.({ preventScroll: true }); });
  };
  // Arrived from an Upload / Send new copy link (email, Home, My kitchens): open the first document that needs them.
  const opened = useRef(false);
  useEffect(() => { if (renewRequested && !opened.current && documents.length) { opened.current = true; showSendDocuments(); } }, [renewRequested, documents.length]);
  const docName = (doc: (typeof documents)[number]) => documentName(t, doc);
  const docList = (list: typeof documents) => new Intl.ListFormat(i18n.language, { type: "conjunction" }).format(list.map(doc => lowerFirst(docName(doc))));
  const chat = app.chat_conversation_id && onOpenChat
    ? <Button variant="outline" onClick={() => onOpenChat(app)}><MessageCircle className="mr-1.5 size-4" aria-hidden />{t("kaMessageKitchen", "Message the kitchen")}</Button> : null;

  // The one next step: a heading, a sentence and its action, worded from the kitchen's side.
  type Next = { tone: "act" | "ok" | "wait"; title: string; body: ReactNode; actions: ReactNode };
  const next: Next = (() => {
    if (addNow.length) return { tone: "act", title: t("kaAddTitleCount", { defaultValue: "{count, plural, one {The kitchen needs one more document} other {The kitchen needs # more documents}}", count: addNow.length }), body: t("applicationAddDocumentsHelp", { defaultValue: "The kitchen also asks for: {documents}. Add them below. Your application stays in review meanwhile.", documents: addNow.map(doc => doc.label).join(", ") }), actions: chat };
    // Booking paused by a document (owner-approved mocks c1–c5): name the document and the one thing to do.
    if (display.bookingBlocked && app.bookingEligibility?.status !== "access_ended") {
      const send = toSend.length ? <Button className="sm:hidden" onClick={() => showSendDocuments()}>{docs.rejected.length || docs.expired.length ? t("dfSendNewCopy", "Send new copy") : t("dfSendDocuments", "Send documents")}</Button> : null;
      const actions = <>{chat}{send}</>;
      if (docs.rejected.length) return { tone: "act", title: t("kaNewCopyTitle", { defaultValue: "The kitchen asked for a new {document}", document: lowerFirst(docName(docs.rejected[0])) }),
        body: t("kaNewCopyBody", "Send a new copy below. New bookings open once the kitchen verifies it. Bookings you already have stay as they are."), actions };
      if (docs.expired.length) return { tone: "act", title: t("kaExpiredTitle", { defaultValue: "Your {document} expired on {date}", document: lowerFirst(docName(docs.expired[0])), date: day(docs.expired[0].expiry) }),
        body: t("kaExpiredBody", { defaultValue: "New bookings at {kitchen} are paused until you send a current one and the kitchen verifies it. Bookings you already have stay as they are.", kitchen: kitchenName }), actions };
      if (docs.missing.length) return { tone: "act", title: t("kaNeedsDocsTitle", { defaultValue: "{kitchen} needs {count, plural, one {one more document} other {# more documents}}", count: docs.missing.length, kitchen: kitchenName }),
        body: t("kaNeedsDocsBody", { defaultValue: "Send your {documents}. New bookings open once the kitchen checks them. Bookings you already have stay as they are.", documents: docList(docs.missing) }), actions };
      const checking = [...docs.checking, ...docs.renewal];
      if (checking.length) return { tone: "wait", title: checking.length === 1 ? t("kaCheckingOneTitle", { defaultValue: "{kitchen} is checking your {document}", kitchen: kitchenName, document: lowerFirst(docName(checking[0])) })
          : t("kaCheckingDocsTitle", { defaultValue: "{kitchen} is checking {count} documents", kitchen: kitchenName, count: checking.length }),
        body: t("kaCheckingDocsBody", { defaultValue: "{count, plural, one {You sent it on {date}. New bookings open as soon as the kitchen verifies it.} other {You sent them on {date}. New bookings open as soon as the kitchen verifies them.}} Bookings you already have stay as they are.",
          count: checking.length, date: day(docs.lastSent ?? checking[0].renewal?.sentAt) }), actions: chat };
    }
    if (display.bookingBlocked) return { tone: "act", title: display.label, body: app.bookingEligibility?.status === "access_ended" ? t("locationAccessEndedHelp") : app.bookingEligibility?.status === "renewal_under_review" ? t("renewalUnderReviewHelp")
        : t("kaRenewBody", "New bookings are paused until the kitchen has the documents marked below. Bookings you already have stay as they are."),
      actions: <>{chat}{display.actionKind === "complete-step" && <Button onClick={() => showSendDocuments()}>{t("dfSendDocuments", "Send documents")}</Button>}</> };
    if (display.listingPaused) return { tone: "wait", title: display.label, body: t("applicationPausedHelp", "Your kitchen access is approved. Booking will be available when this kitchen opens for reservations again."), actions: chat };
    if (display.actionKind === "book") return { tone: "ok", title: t("kaBookTitle", { defaultValue: "You can book {kitchen}", kitchen: kitchenName }),
      body: app.documentsWaivedAt ? t("kaBookBodyWaived", "The kitchen doesn’t need booking requirements from you. Book by the hour or the day; your card is charged only when the kitchen accepts.")
        // A new copy waiting, or one expiring soon: booking stays open, but say until when (mocks c4, c6).
        : docs.renewal.length ? t("kaRenewalWaitingBody", { defaultValue: "The kitchen is checking your new {document}. Your current one counts until {date}, so nothing pauses meanwhile.", document: lowerFirst(docName(docs.renewal[0])), date: day(docs.renewal[0].expiry) })
        : docs.expiring.length ? t("kaExpiringBody", { defaultValue: "Your {document} expires {date}. Send the new one before then so booking doesn’t pause.", document: lowerFirst(docName(docs.expiring[0])), date: day(docs.expiring[0].expiry) })
        : t("kaBookBody", "Book by the hour or the day. Your card is charged only when the kitchen accepts your booking."),
      actions: <>{chat}<Button onClick={book}>{t("kdBook", "Book kitchen time")}</Button></> };
    if (display.actionKind === "complete-step") return { tone: "act", title: t("kaSendTitle", "Send your booking requirements"),
      body: (app.tier_data as Record<string, unknown> | null)?.addedByKitchen ? t("kaSendBodyAdded", { defaultValue: "{kitchen} added you as a customer. Send what it asks for below; once it checks them, you can book.", kitchen: kitchenName })
        : t("kaSendBody", { defaultValue: "{kitchen} approved your request on {date}. Send what it asks for below; once it checks them, you can book.", kitchen: kitchenName, date: day(app.tier1_completed_at || app.reviewedAt) }),
      actions: <>{chat}<Button asChild><Link href={`/apply-kitchen/${app.locationId}`}>{t("kdUploadDocuments", "Send booking requirements")}</Link></Button></> };
    if (display.actionKind === "discover") return { tone: "wait", title: t("kaDeclinedTitle", { defaultValue: "{kitchen} declined your request", kitchen: kitchenName }),
      body: app.feedback ? <q className="whitespace-pre-wrap">{app.feedback}</q> : t("kaDeclinedBody", "You can send a new request when you’re ready, or find another kitchen."),
      actions: <><Button variant="outline" onClick={() => navigate(chefDashboardHref("discover-kitchens"))}>{t("kaFindOther", "Find other kitchens")}</Button><Button asChild><Link href={`/apply-kitchen/${app.locationId}`}>{t("kdApplyAgain", "Send a new request")}</Link></Button></> };
    if (step2Sent) return { tone: "wait", title: t("kaCheckingTitle", { defaultValue: "{kitchen} is checking your booking requirements", kitchen: kitchenName }),
      body: t("kaCheckingBody", { defaultValue: "You sent them on {date}. We’ll email you as soon as you can book.", date: day(app.tier2_completed_at) }), actions: chat };
    return { tone: "wait", title: t("kaWaitingTitle", { defaultValue: "Waiting for {kitchen}", kitchen: kitchenName }),
      body: t("kaWaitingBody", { defaultValue: "You sent your request on {date}. We’ll email you when the kitchen replies. Nothing is reserved or charged.", date: day(app.createdAt) }), actions: chat };
  })();

  const viewLink = (key: string) => { const url = key.startsWith("custom:") ? customDocumentFields(app as any, key.slice(7)).url : key === "foodSafetyLicense" ? app.foodSafetyLicenseUrl : key === "foodEstablishmentCert" ? app.foodEstablishmentCertUrl : (app as any).insuranceUrl;
    return url ? <SecureDocumentLink url={url} label={t("apptabViewDocument", "View")} showExternalIcon={false} /> : null; };
  const requirementsTitle = inFirstReview ? t("kaNextAsks", "Next, the kitchen asks for these") : tier >= 3 || step2Sent ? t("dfTitle", { defaultValue: "Your documents for {kitchen}", kitchen: kitchenName }) : t("kitchenDocuments", "Booking requirements");
  const requirementsLead = inFirstReview ? t("kaNextAsksLead", "Optional for now. Adding them early speeds things up once the kitchen replies.")
    : app.documentsWaivedAt ? t("mdWaivedLocation", "This location doesn’t need documents from you") : tier >= 3 || step2Sent ? t("dfLead", "Each kitchen keeps its own copy. We’ll remind you 45, 14 and 3 days before one expires.") : null;
  const panelTone = { act: "bg-primary/[0.06]", ok: "bg-emerald-50", wait: "bg-muted/60" }[next.tone];

  const showDocuments = documents.length > 0 && display.actionKind !== "discover";
  // Added by the kitchen: there was no request, so only show it when the kitchen left feedback.
  const showRequest = !(app.tier_data as Record<string, unknown> | null)?.addedByKitchen || !!app.feedback;
  const mainEmpty = !showDocuments && !showRequest;
  return <section className="min-w-0 space-y-6 [overflow-wrap:anywhere]" aria-labelledby="kitchen-access-title" data-testid="kitchen-access-page">
    {sentDocs.length > 0 && <div role="status" className="flex items-start gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900" data-testid="documents-sent-banner">
      <Check className="mt-0.5 size-4 shrink-0" aria-hidden /><p className="min-w-0 flex-1"><span className="font-semibold">{t("dfSentBanner", { defaultValue: "{documents} sent to {kitchen}.", documents: new Intl.ListFormat(i18n.language, { type: "conjunction" }).format(sentDocs.map((name, i) => i ? lowerFirst(name) : name)), kitchen: kitchenName })}</span> {t("dfSentBannerNext", "The kitchen checks it next. This page shows when you can book.")}</p>
      <button type="button" aria-label={t("tourNoticeDismiss", "Dismiss")} onClick={() => setSentDocs([])} className="-m-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-emerald-100"><X className="size-4" aria-hidden /></button></div>}
    {sent && <div role="status" className="flex items-start gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900" data-testid="request-sent-banner">
      <Check className="mt-0.5 size-4 shrink-0" aria-hidden /><p className="min-w-0 flex-1"><span className="font-semibold">{sent === "joined" ? t("kaJoinedBanner", { defaultValue: "You joined {kitchen}.", kitchen: kitchenName }) : sent === "requirements" ? t("kaSentReqBanner", { defaultValue: "Booking requirements sent to {kitchen}.", kitchen: kitchenName }) : t("kaSentBanner", { defaultValue: "Request sent to {kitchen}.", kitchen: kitchenName })}</span>{sent !== "joined" && <> {t("kaSentCopy", "We emailed you a copy.")}</>}</p>
      <button type="button" aria-label={t("tourNoticeDismiss", "Dismiss")} onClick={onDismissNotice} className="-m-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-emerald-100"><X className="size-4" aria-hidden /></button></div>}
    {notice && <div role="status" data-testid="application-tour-notice" className="flex items-start justify-between gap-3 rounded-xl bg-muted/60 px-4 py-3 text-sm">
      <p className="min-w-0 pt-0.5">{notice === "tour" ? t("applicationNoticeTour", { defaultValue: "You’ve already applied to {kitchen}, so there’s no tour to request. Your application is below.", kitchen: kitchenName })
        : t("kaNoticeApplied", { defaultValue: "You’ve already sent {kitchen} a request. Here’s where it stands.", kitchen: kitchenName })}</p>
      <button type="button" aria-label={t("tourNoticeDismiss", "Dismiss")} onClick={onDismissNotice} className="-m-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"><X className="size-4" aria-hidden /></button></div>}

    <header className="flex items-center gap-4 sm:gap-5">
      {photo ? <img src={photo} alt="" className="size-16 shrink-0 rounded-xl object-cover sm:h-[90px] sm:w-[120px]" /> : <div className="size-16 shrink-0 rounded-xl bg-muted sm:h-[90px] sm:w-[120px]" aria-hidden />}
      <div className="min-w-0"><h1 id="kitchen-access-title" className="text-2xl font-semibold tracking-tight sm:text-[28px]">{kitchenName}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{[app.location?.address, rate].filter(Boolean).join(" · ")}</p></div>
    </header>

    <div className="rounded-xl border bg-card px-5 py-5 sm:px-6"><KitchenAccessTracker app={app} stacked /></div>

    <div className={cn("grid gap-4 rounded-xl p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6 sm:p-6", panelTone)} data-testid="kitchen-access-next">
      <div className="min-w-0"><h2 className="text-lg font-semibold">{next.title}</h2><p className="mt-1 max-w-prose text-sm leading-6 text-foreground/80">{next.body}</p></div>
      {next.actions && <div className="flex flex-col gap-2 sm:flex-row [&>*]:w-full sm:[&>*]:w-auto">{next.actions}</div>}
    </div>

    <div className={cn("grid items-start gap-6", mainEmpty ? "max-w-md" : "lg:grid-cols-[minmax(0,1fr)_320px]")}>
      {!mainEmpty && <div className="min-w-0 space-y-6">
        {showDocuments && <YourDocuments applicationId={app.id} documents={documents} kitchenName={kitchenName} sentToKitchen={step2Sent} canUpload={canUpload}
          title={requirementsTitle} lead={requirementsLead} openKey={openKey} onOpen={setOpenKey} viewLink={viewLink}
          onSent={name => { setSentDocs(current => current.includes(name) ? current : [...current, name]); onChanged(); requestAnimationFrame(() => document.querySelector("[data-testid=documents-sent-banner]")?.scrollIntoView?.({ behavior: "smooth", block: "nearest" })); }} />}
        {showRequest && <section aria-labelledby="kitchen-access-request">
          <h2 id="kitchen-access-request" className="mb-3 text-base font-semibold">{t("kaYourRequest", "Your request")}</h2>
          {definitions.isLoading ? <Skeleton className="h-64 rounded-xl" /> : <KitchenApplicationDetails app={app} display={display} onBookKitchen={book} compact requirements={definitions.data} showActions={false} hideDocuments={(app.documents || []).length > 0} hideFeedback={display.actionKind === "discover"} />}
        </section>}
      </div>}
      <aside className="space-y-4 lg:sticky lg:top-4">
        <section className="overflow-hidden rounded-xl border bg-card">
          {photo && <img src={photo} alt="" className="h-40 w-full object-cover" />}
          <div className="p-5"><h2 className="text-sm font-semibold">{kitchen?.name || kitchenName}</h2><p className="text-sm text-muted-foreground">{app.location?.address}</p>
            {rate && <p className="mt-3 text-sm">{rate} <span className="text-muted-foreground">{t("kaPlusFees", "+ HST and service fee")}</span></p>}
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm font-medium text-primary">
              <Link className="hover:underline" href={kitchenPreviewPath(app.locationId)}>{t("kaViewKitchen", "View kitchen")}</Link>
              {app.sourceTourId && <Link className="hover:underline" href={`/dashboard?view=viewings&viewing=${app.sourceTourId}`}>{t("applicationViewTour", "View kitchen tour")}</Link>}
            </div></div>
        </section>
        <p className="px-1 text-xs text-muted-foreground">{t("applicationNeedHelp", "Need a hand?")} <a className="underline underline-offset-2" href="mailto:support@localcooks.ca">support@localcooks.ca</a></p>
      </aside>
    </div>
  </section>;
}
