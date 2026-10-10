import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { ArrowRight, Building2, CalendarDays, Check, Circle, Clock, MapPin, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SmartImage } from "@/components/ui/smart-image";
import { SecureDocumentLink } from "@/components/common/SecureDocumentLink";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useChefKitchenApplicationForLocation } from "@/hooks/use-chef-kitchen-applications";
import { useTourRequestAccess } from "@/hooks/use-tour-request-access";
import { getKitchenDisplayStatus, hasStep2BeenSubmitted } from "@/components/chef/applications/status";
import { chefDashboardHref } from "@/lib/chef-dashboard-nav";
import { getAuthHeaders } from "@/lib/api";
import { useChefShellChrome } from "@/layouts/chef-shell-context";
import ChefDashboardLayout from "@/layouts/ChefDashboardLayout";
import Header from "@/components/layout/Header";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Fragment } from "react";
import { kitchenPreviewHref } from "@/lib/kitchen-preview-url";
import { getConversationForApplication } from "@/services/chat-service";

export default function KitchenRequirementsPage() {
  const { t } = useTranslation("kitchen");
  const { t: tChef } = useTranslation("chef");
  const [path, navigate] = useLocation();
  const locationId = Number(path.match(/\/kitchen-requirements\/(\d+)/)?.[1]) || null;
  const requestedKitchenId = new URLSearchParams(window.location.search).get("kitchenId");
  const { user, loading: authLoading } = useFirebaseAuth();
  const [activeView, setActiveView] = useState("discover-kitchens");
  const [savedDates, setSavedDates] = useState<string | null>(null);
  const [openingChat, setOpeningChat] = useState(false);
  const [chatError, setChatError] = useState(false);

  const locationQuery = useQuery({
    queryKey: [`/api/public/locations/${locationId}/details`],
    queryFn: async () => {
      const response = await fetch(`/api/public/locations/${locationId}/details`);
      if (!response.ok) throw new Error("Could not load this kitchen");
      return response.json();
    },
    enabled: !!locationId,
  });
  const requirementsQuery = useQuery({
    queryKey: [`/api/public/locations/${locationId}/requirements`],
    queryFn: async () => {
      const response = await fetch(`/api/public/locations/${locationId}/requirements`);
      if (!response.ok) throw new Error("Could not load kitchen requirements");
      return response.json();
    },
    enabled: !!locationId,
  });
  const kitchensQuery = useQuery<Array<{ id: number; locationId: number; name: string; slug?: string | null; locationSlug?: string; imageUrl?: string | null }>>({
    queryKey: ["/api/public/kitchens"],
    queryFn: async () => {
      const response = await fetch("/api/public/kitchens");
      if (!response.ok) throw new Error("Could not load kitchens");
      return response.json();
    },
  });
  const location = locationQuery.data;
  const requirements = requirementsQuery.data;
  const kitchen = kitchensQuery.data?.find(item => item.locationId === locationId && (!requestedKitchenId || item.id === Number(requestedKitchenId)));
  const applicationQuery = useChefKitchenApplicationForLocation(user ? locationId : null);
  const application = applicationQuery.application;
  const display = application ? getKitchenDisplayStatus(application, tChef) : null;
  const tourQuery = useTourRequestAccess(kitchen?.id, user?.uid);
  const tour = tourQuery.data?.tour;
  const tourStatusQuery = useQuery<{ toursAvailable?: boolean; isActive?: boolean }>({
    queryKey: [`/api/viewings/kitchen/${kitchen?.id}/is-active`],
    queryFn: async () => {
      const response = await fetch(`/api/viewings/kitchen/${kitchen!.id}/is-active`, { headers: await getAuthHeaders(), credentials: "include" });
      if (!response.ok) throw new Error("Could not check tour availability");
      return response.json();
    },
    enabled: !!kitchen,
  });

  useEffect(() => { window.scrollTo(0, 0); }, [locationId]);
  useEffect(() => {
    setSavedDates(null);
    if (!kitchen) return;
    try {
      const value = localStorage.getItem(`kitchen_dates_${kitchen.id}`) || sessionStorage.getItem(`kitchen_dates_${kitchen.id}`);
      const dates = value ? JSON.parse(value) : null;
      if (!dates?.from) return;
      const from = new Date(dates.from);
      if (Number.isNaN(from.getTime())) return;
      const format = (date: Date) => date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
      const to = dates.to ? new Date(dates.to) : null;
      setSavedDates(to && !Number.isNaN(to.getTime()) && dates.to !== dates.from ? `${format(from)} – ${format(to)}` : format(from));
    } catch { /* An optional booking preference must not block the request. */ }
  }, [kitchen?.id]);

  const name = kitchen?.name || location?.name || t("kitchenWord", "Kitchen");
  const applyHref = `/apply-kitchen/${locationId}${kitchen ? `?kitchenId=${kitchen.id}` : ""}`;
  const previewHref = kitchen ? kitchenPreviewHref(kitchen.locationSlug || location?.slug || locationId!, kitchen) : `/kitchen-preview/${locationId}`;
  const requestSubmitted = !!application && display?.actionKind !== "discover";
  const documentsSubmitted = !!application && hasStep2BeenSubmitted(application);
  const approved = application?.status === "approved" && (application.current_tier ?? 1) >= 3;
  const canBook = display?.actionKind === "book" && location?.canAcceptApplications !== false && !!kitchen;
  const needsDocuments = display?.actionKind === "complete-step";
  const canCoordinate = requestSubmitted && (needsDocuments || documentsSubmitted || approved);
  const openKitchenChat = async () => {
    if (!application?.id || openingChat) return;
    setOpeningChat(true);
    setChatError(false);
    try {
      const conversationId = application.chat_conversation_id || (await getConversationForApplication(application.id))?.id;
      if (!conversationId) throw new Error("Kitchen messaging unavailable");
      navigate(`/dashboard?view=messages&conversation=${encodeURIComponent(conversationId)}`);
    } catch { setChatError(true); }
    finally { setOpeningChat(false); }
  };
  const closed = !requestSubmitted && (location?.canAcceptApplications === false || !kitchen);
  const step = approved ? 3 : needsDocuments || documentsSubmitted ? 2 : 1;
  const waiting = display?.actionKind === "wait";
  const title = closed ? t("requirementsClosedTitle", "Requests are currently paused")
    : approved ? canBook ? t("requirementsApprovedTitle", "You’re ready to book") : t("requirementsApprovedPausedTitle", "Your kitchen access is approved")
    : needsDocuments ? t("requirementsDocumentsTitle", "Your request is approved")
    : waiting ? documentsSubmitted ? t("requirementsDocumentsReviewTitle", "Your documents are in review") : t("requirementsRequestReviewTitle", "Your request is in review")
    : display?.actionKind === "discover" ? t("requirementsApplyAgainTitle", "Ready to apply again?")
    : t("requirementsStartTitle", "Make this your next kitchen");
  const description = closed ? t("requirementsClosedHelp", "This kitchen isn’t accepting new requests right now. Explore another space or check back later.")
    : approved ? canBook ? t("requirementsApprovedHelp", "Choose available dates and hours to book your kitchen time.") : t("requirementsApprovedPausedHelp", "Your approval stays on file. Booking will be available when this kitchen opens for reservations again.")
    : needsDocuments ? t("requirementsDocumentsHelp", "Upload the required kitchen documents to continue your application.")
    : waiting ? t("requirementsReviewHelp", "Your application is in review. We’ll email you when there’s an update. Nothing else is needed from you right now.")
    : t("requirementsStartHelp", "Tell us about yourself and your food business. After your request is approved, you’ll share the documents this kitchen requires.");
  const actionLabel = closed ? t("backToDiscoverKitchens", "Explore kitchens")
    : canBook ? t("requirementsBookAction", "Choose booking times")
    : approved || waiting ? t("viewApplicationBtn", "View application")
    : needsDocuments ? t("submitKitchenDocuments", "Submit kitchen documents")
    : display?.actionKind === "discover" ? t("requirementsApplyAgainAction", "Apply again")
    : t("requestToApply", "Request to apply");
  const actionHref = closed ? chefDashboardHref("discover-kitchens") : canBook ? `/book/${locationId}?kitchenId=${kitchen!.id}`
    : approved || waiting ? `/dashboard?view=kitchen-requests${application?.id ? `&application=${application.id}` : ""}` : applyHref;

  const step1Items = requirements ? [
    t("requirementsContactItem", "Your name and contact details"),
    (requirements.requireBusinessName || requirements.requireBusinessType || requirements.requireBusinessDescription) && t("requirementsBusinessItem", "Your food business"),
    requirements.requireFoodHandlerCert && t("requirementsCertificateAnswerItem", "Your food safety certification status"),
    (requirements.requireUsageFrequency || requirements.requireSessionDuration) && t("requirementsUsageItem", "How often you’ll use the kitchen"),
    requirements.tier1_years_experience_required && t("professionalExperience", "Professional experience"),
    ...(Array.isArray(requirements.tier1_custom_fields) ? requirements.tier1_custom_fields.filter((field: { required?: boolean }) => field.required).map((field: { label: string }) => field.label) : []),
    t("requirementsAgreementsItem", "Kitchen terms and application agreements"),
  ].filter(Boolean) as string[] : [];
  const step2Items = requirements ? [
    requirements.requireFoodSafetyUpload && (t("foodSafetyLicense", "Food Safety Certificate") + (requirements.requireFoodHandlerExpiry ? ` · ${t("requirementsExpiry", "expiry date")}` : "")),
    requirements.tier2_food_establishment_cert_required && (t("foodEstablishmentCertificate", "Food Establishment Certificate") + (requirements.tier2_food_establishment_expiry_required ? ` · ${t("requirementsExpiry", "expiry date")}` : "")),
    (requirements.tier2_insurance_document_required || requirements.tier2_insurance_minimum_amount > 0) && (t("insuranceDocument", "Insurance document") + (requirements.tier2_insurance_minimum_amount > 0 ? t("requirementsInsuranceMinimum", { defaultValue: " · minimum ${amount}", amount: requirements.tier2_insurance_minimum_amount }) : "")),
    requirements.tier2_kitchen_experience_required && t("kitchenExperienceDescription", "Kitchen experience description"),
    ...(Array.isArray(requirements.tier2_custom_fields) ? requirements.tier2_custom_fields.filter((field: { required?: boolean }) => field.required !== false).map((field: { label: string }) => field.label) : []),
  ].filter(Boolean) as string[] : [];

  const breadcrumbs = useMemo(() => [
    { label: t("shellDiscoverKitchens", "Discover Kitchens"), href: chefDashboardHref("discover-kitchens"), onClick: () => navigate(chefDashboardHref("discover-kitchens")), navId: "discover-kitchens" as const },
    ...(location?.name && location.name !== name ? [{ label: location.name, href: `/kitchen-preview/${locationId}`, onClick: () => navigate(`/kitchen-preview/${locationId}`) }] : []),
    { label: name, href: previewHref, onClick: () => navigate(previewHref) },
    { label: t("requirementsBreadcrumb", "Kitchen access") },
  ], [t, navigate, location?.name, locationId, name, previewHref]);
  const onViewChange = (view: string) => { setActiveView(view); navigate(chefDashboardHref(view), { replace: true }); };
  const inShell = useChefShellChrome({ activeView, onViewChange, breadcrumbs });
  const isLoading = authLoading || locationQuery.isLoading || requirementsQuery.isLoading || kitchensQuery.isLoading || (!!user && applicationQuery.isLoading);
  const error = locationQuery.error || requirementsQuery.error || kitchensQuery.error || applicationQuery.error;
  const retry = () => { void locationQuery.refetch(); void requirementsQuery.refetch(); void kitchensQuery.refetch(); if (user) void applicationQuery.refetch(); };
  const toursAvailable = tourStatusQuery.data?.toursAvailable ?? tourStatusQuery.data?.isActive ?? false;
  const showTour = !!kitchen && (!!tour || (!requestSubmitted && toursAvailable));

  const content = isLoading ? (
    <div className="mx-auto max-w-6xl space-y-6" role="status" aria-label={t("checkingApplication", "Checking your application…")}>
      <Skeleton className="h-56 rounded-2xl" /><div className="grid gap-6 lg:grid-cols-[1fr_340px]"><Skeleton className="h-96 rounded-2xl" /><Skeleton className="h-80 rounded-2xl" /></div>
    </div>
  ) : error ? (
    <Alert variant="destructive"><AlertTitle>{t("requirementsLoadFailed", "Couldn’t load your kitchen access details")}</AlertTitle><AlertDescription className="mt-3"><Button variant="outline" onClick={retry}>{t("requirementsRetry", "Try again")}</Button></AlertDescription></Alert>
  ) : !locationId || !location || !requirements || (requestedKitchenId && !kitchen) ? (
    <div className="rounded-2xl border bg-white p-10 text-center"><Building2 className="mx-auto mb-4 h-8 w-8 text-muted-foreground" /><h1 className="text-xl font-semibold">{t("requirementsNotFound", "Kitchen unavailable")}</h1><p className="mt-2 text-sm text-muted-foreground">{t("couldNotFindRequirements", "We couldn’t find the requirements for this kitchen.")}</p><Button className="mt-6" onClick={() => navigate(chefDashboardHref("discover-kitchens"))}>{t("backToDiscoverKitchens", "Explore kitchens")}</Button></div>
  ) : (
    <div className="mx-auto max-w-6xl space-y-6 pb-8">
      {!user && <Breadcrumb><BreadcrumbList>{breadcrumbs.map((crumb, index) => <Fragment key={`${crumb.label}-${index}`}><BreadcrumbItem>{crumb.onClick ? <BreadcrumbLink href={crumb.href} onClick={event => { event.preventDefault(); crumb.onClick(); }}>{crumb.label}</BreadcrumbLink> : <BreadcrumbPage>{crumb.label}</BreadcrumbPage>}</BreadcrumbItem>{index < breadcrumbs.length - 1 && <BreadcrumbSeparator />}</Fragment>)}</BreadcrumbList></Breadcrumb>}
      <header className={`grid overflow-hidden rounded-2xl border border-border/70 bg-white ${kitchen?.imageUrl ? "sm:grid-cols-[1fr_260px]" : ""}`}>
        <div className="flex flex-col justify-center p-6 sm:p-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">{t("requirementsEyebrow", "Kitchen access")}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{name}</h1>
          {location.address && <p className="mt-3 flex items-start gap-2 text-sm leading-6 text-muted-foreground"><MapPin className="mt-1 h-4 w-4 shrink-0" />{location.address}</p>}
          <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">{t("requirementsHeroHelp", "A clear path from your first request to your first day in the kitchen.")}</p>
        </div>
        {kitchen?.imageUrl && <SmartImage src={kitchen.imageUrl} alt={name} className="h-32 w-full object-cover sm:h-full sm:min-h-56" />}
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="row-start-2 overflow-hidden rounded-2xl border border-border/70 bg-white lg:row-start-auto" aria-labelledby="access-steps-heading">
          <div className="border-b px-6 py-5 sm:px-7"><h2 id="access-steps-heading" className="text-lg font-semibold tracking-tight">{t("requirementsPathTitle", "Your path to kitchen access")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("requirementsPathHelp", "Complete each step when it’s ready. We’ll keep you updated along the way.")}</p></div>
          {[
            { number: 1, title: t("requestToApply", "Request to apply"), help: t("requirementsStep1Help", "Introduce yourself and your food business to Local Cooks."), items: step1Items,
              complete: needsDocuments || documentsSubmitted || approved, status: needsDocuments || documentsSubmitted || approved ? t("requirementsStageApproved", "Approved") : requestSubmitted ? t("requirementsStageReview", "In review") : t("requirementsStageStart", "Start here") },
            { number: 2, title: t("requirementsStep2Title", "Kitchen documents"), help: t("requirementsStep2Help", "Upload the documents this kitchen requires for access."), items: step2Items,
              complete: approved, status: approved ? t("requirementsStageApproved", "Approved") : documentsSubmitted ? t("requirementsStageReview", "In review") : needsDocuments ? t("requirementsStageReady", "Ready to submit") : t("requirementsStageLater", "After request approval") },
            { number: 3, title: t("requirementsStep3Title", "Book your kitchen time"), help: t("requirementsStep3Help", "Once approved, choose available dates and hours and confirm your booking."), items: [], complete: approved,
              status: approved ? canBook ? t("requirementsStageBookingReady", "Ready to book") : t("requirementsStageBookingPaused", "Bookings paused") : t("requirementsStageAfterDocuments", "After document approval") },
          ].map(stage => <div key={stage.number} className="flex gap-4 border-b p-6 last:border-b-0 sm:gap-5 sm:p-7" aria-current={stage.number === step ? "step" : undefined}>
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${stage.complete ? "border-emerald-200 bg-emerald-50 text-emerald-700" : stage.number === step ? "border-primary/20 bg-primary/5 text-primary" : "border-border bg-muted/30 text-muted-foreground"}`}>
              {stage.complete ? <Check className="h-4 w-4" aria-label={t("requirementsStageApproved", "Approved")} /> : stage.number}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold tracking-tight">{stage.title}</h3><span className={`rounded-md px-2 py-1 text-[11px] font-medium ${stage.complete ? "bg-emerald-50 text-emerald-700" : stage.number === step ? "bg-primary/5 text-primary" : "bg-muted/50 text-muted-foreground"}`}>{stage.status}</span></div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{stage.help}</p>
              {stage.items.length > 0 && <ul className="mt-4 space-y-2.5">{stage.items.map((item, index) => <li key={`${item}-${index}`} className="flex items-start gap-2.5 text-sm leading-5 text-foreground/80"><Circle className="mt-1.5 h-1.5 w-1.5 shrink-0 fill-muted-foreground text-muted-foreground" aria-hidden />{item}</li>)}</ul>}
              {stage.number === 2 && !stage.items.length && <p className="mt-3 text-sm text-muted-foreground">{t("noDocsRequiredStep2", "No specific kitchen documents are required.")}</p>}
            </div>
          </div>)}
        </section>

        <aside className="row-start-1 space-y-4 lg:sticky lg:top-6 lg:row-start-auto">
          <section className="overflow-hidden rounded-2xl border border-border/70 bg-white">
            <div className="border-b bg-[#faf7f5] p-6"><p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{t("requirementsNextStep", "Your next step")}</p><h2 className="mt-3 text-2xl font-semibold leading-tight tracking-tight">{title}</h2>{requestSubmitted && <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">{waiting ? <Clock className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}{display?.label}</p>}</div>
            <div className="space-y-5 p-6">
              <p className="text-sm leading-6 text-muted-foreground">{description}</p>
              <Button className="h-11 w-full justify-between rounded-xl shadow-none" data-testid={needsDocuments ? "kitchen-requirements-submit-documents" : "kitchen-requirements-start-apply"} onClick={() => navigate(actionHref)}>{actionLabel}<ArrowRight className="h-4 w-4" /></Button>
              {!requestSubmitted && !closed && <p className="text-xs leading-5 text-muted-foreground">{t("requirementsNoPayment", "No payment is due with your request. Booking becomes available after approval.")}</p>}
              {savedDates && <div className="border-t pt-4"><p className="flex items-center gap-2 text-xs font-medium"><CalendarDays className="h-4 w-4 text-muted-foreground" />{t("requirementsSavedPreferences", "Saved booking preferences")}</p><p className="mt-2 text-sm">{savedDates}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{t("requirementsDatesNotReserved", "These dates are preferences. Your kitchen time is reserved only when you complete a booking.")}</p></div>}
              {user && location.kitchenTermsUrl && <div className="border-t pt-4"><SecureDocumentLink url={location.kitchenTermsUrl} label={t("viewKitchenTerms", "View kitchen terms and policies")} showExternalIcon={false} /></div>}
            </div>
          </section>
          {canCoordinate && <section className="rounded-2xl border border-border/70 bg-white p-6" aria-labelledby="kitchen-coordination-heading">
            <MessageCircle className="mb-3 h-5 w-5 text-primary" aria-hidden />
            <h2 id="kitchen-coordination-heading" className="text-base font-semibold">{t("requirementsCoordinateTitle", "Coordinate with kitchen")}</h2>
            {application?.location?.managerName && <p className="mt-2 text-sm font-medium">{application.location.managerName}</p>}
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("requirementsCoordinateHelp", "Message your kitchen manager to arrange access, discuss your Food Establishment Licence, or ask about the kitchen’s document requirements.")}</p>
            <Button variant="outline" className="mt-4 w-full rounded-xl" disabled={openingChat} onClick={() => void openKitchenChat()}>{openingChat ? t("requirementsOpeningChat", "Opening messages…") : t("requirementsMessageManager", "Message kitchen manager")}</Button>
            {chatError && <p role="alert" className="mt-3 text-xs leading-5 text-destructive">{t("requirementsChatError", "Couldn’t open kitchen messages. Please try again.")}</p>}
          </section>}
          {showTour && <section className="rounded-2xl border border-border/70 bg-white p-5"><div className="flex items-start gap-3"><CalendarDays className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" /><div className="min-w-0"><h3 className="text-sm font-semibold">{tour ? tour.kind === "completed" ? t("requirementsTourCompleted", "Your kitchen tour is complete") : t("requirementsTourExisting", "Your kitchen tour") : t("requirementsTourTitle", "Want to see the space first?")}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{tour ? t("requirementsTourExistingHelp", "Your tour details and next steps are saved in My tours.") : t("requirementsTourHelp", "A tour is optional. Get to know the kitchen before you request access.")}</p><Button variant="ghost" size="sm" className="-ml-3 mt-2 h-auto whitespace-normal text-primary" disabled={!tour && !!user && (tourQuery.isLoading || !!tourQuery.error || !tourQuery.data?.canRequest)} onClick={() => navigate(tour ? `/dashboard?view=viewings&viewing=${tour.id}` : `/request-tour/${locationId}?kitchenId=${kitchen!.id}`)}>{tour ? t("requirementsViewTour", "View your tour") : tourQuery.error ? t("requirementsTourCheckFailed", "Couldn’t check tour access") : t("applyFlowScheduleTourButton", "Request tour")}<ArrowRight className="ml-2 h-3.5 w-3.5" /></Button></div></div></section>}
          <p className="px-2 text-xs leading-5 text-muted-foreground">{t("requirementsNeedHelp", "Need a hand?")} <a href="mailto:support@localcooks.ca" className="underline underline-offset-4 hover:text-foreground">support@localcooks.ca</a></p>
        </aside>
      </div>
    </div>
  );

  if (user) return inShell ? content : <ChefDashboardLayout activeView={activeView} onViewChange={onViewChange} breadcrumbs={breadcrumbs}>{content}</ChefDashboardLayout>;
  return <div className="min-h-screen bg-gray-50"><Header /><main className="mx-auto max-w-6xl px-4 pb-12 pt-[calc(var(--header-total)_+_2rem)] sm:px-6">{content}</main></div>;
}
