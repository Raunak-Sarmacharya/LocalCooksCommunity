import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Link, useLocation, useSearch } from "wouter";
import { useTranslation } from "react-i18next";
import { ArrowUpDown, FileText, MessageCircle } from "lucide-react";
import { useChefKitchenApplications, type KitchenApplicationWithLocation } from "@/hooks/use-chef-kitchen-applications";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { KitchenStatusChip } from "./applications/status-icons";
import { getKitchenDisplayStatus, hasStep2BeenSubmitted } from "./applications/status";
import { KitchenApplicationDetails, type ApplicationFieldDefinitions } from "./applications/KitchenApplicationDetails";
import { kitchenPreviewPath } from "@/lib/discover-location-groups";
import { chefDashboardHref } from "@/lib/chef-dashboard-nav";

export default function ChefKitchenApplications({ onOpenChat }: { onOpenChat?: (app: KitchenApplicationWithLocation) => void }) {
  const { t, i18n } = useTranslation("chef");
  const [, navigate] = useLocation();
  const search = useSearch();
  const linkedId = new URLSearchParams(search).get("application");
  const applicationId = linkedId && /^\d+$/.test(linkedId) ? Number(linkedId) : null;
  const { applications, isLoading, error, refetch } = useChefKitchenApplications();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");
  const selected = applications.find(app => app.id === applicationId);
  const definitions = useQuery<ApplicationFieldDefinitions>({
    queryKey: [`/api/public/locations/${selected?.locationId}/requirements`],
    queryFn: async () => {
      const response = await fetch(`/api/public/locations/${selected!.locationId}/requirements`);
      if (!response.ok) throw new Error("Could not load field labels");
      return response.json();
    },
    enabled: !!selected,
  });
  useEffect(() => { window.scrollTo(0, 0); }, [applicationId]);
  const open = (id: number) => navigate(`/dashboard?view=kitchen-requests&application=${id}`);
  const formatDate = (value: string | Date | null) => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toLocaleDateString(i18n.language, { month: "short", day: "numeric", year: "numeric" }) : "—";
  const displayFor = (app: KitchenApplicationWithLocation) => getKitchenDisplayStatus(app, t);
  const matchesGroup = (app: KitchenApplicationWithLocation, key: string) => key === "all" || (key === "action" ? ["complete-step", "discover"].includes(displayFor(app).actionKind) : key === "approved" ? app.status === "approved" && (app.current_tier ?? 1) >= 3 : displayFor(app).actionKind === "wait" && !displayFor(app).listingPaused);
  const filtered = useMemo(() => applications.filter(app => matchesGroup(app, group) && [`APPLICATION-${app.id}`, app.location?.name, app.location?.address, app.fullName, displayFor(app).label].some(value => value?.toLowerCase().includes(query.trim().toLowerCase()))), [applications, group, query, t]);
  const columns: ColumnDef<KitchenApplicationWithLocation>[] = [
    { accessorKey: "id", header: t("applicationReference", "Application reference"), cell: ({ row }) => <Link className="font-medium hover:underline" href={`/dashboard?view=kitchen-requests&application=${row.original.id}`}>APPLICATION-{row.original.id}</Link> },
    { id: "kitchen", accessorFn: app => app.location?.name || "", header: t("applicationKitchenLocation", "Kitchen / location"), cell: ({ row }) => <div className="max-w-xs whitespace-normal"><p className="font-medium">{row.original.location?.name || t("apptabKitchenFallback", "Kitchen")}</p><p className="text-xs text-muted-foreground">{row.original.location?.address}</p></div> },
    { accessorKey: "createdAt", meta: { mobileLabel: t("apptabSubmitted", "Submitted") }, header: ({ column }) => <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>{t("apptabSubmitted", "Submitted")}<ArrowUpDown className="ml-2 size-4" /></Button>, cell: ({ row }) => formatDate(row.original.createdAt) },
    { id: "status", accessorFn: app => displayFor(app).label, header: t("apptabStatus", "Status"), cell: ({ row }) => <KitchenStatusChip display={displayFor(row.original)} /> },
    { id: "next", header: t("applicationNextAction", "Next action"), meta: { mobileSpan: "full" }, cell: ({ row }) => <span className="text-sm">{displayFor(row.original).actionKind === "wait" ? t("applicationNoAction", "No action needed") : displayFor(row.original).actionKind === "complete-step" ? t("applicationUploadDocuments", "Upload documents") : displayFor(row.original).actionLabel}</span> },
    { id: "actions", header: t("applicationDetails", "Details"), cell: ({ row }) => <Button variant="outline" size="sm" onClick={() => open(row.original.id)}>{t("apptabViewDetails", "View details")}</Button> },
  ];
  if (isLoading) return <div role="status" aria-label={t("applicationLoading", "Loading kitchen applications")} className="space-y-3">{[0, 1, 2].map(item => <Skeleton key={item} className="h-24 rounded-xl" />)}</div>;
  if (error) return <div role="alert" className="space-y-3 rounded-xl border bg-card p-8 text-center"><p>{t("applicationLoadFailed", "We couldn’t load your kitchen applications.")}</p><Button variant="outline" onClick={() => void refetch()}>{t("applicationRetry", "Try again")}</Button></div>;
  if (linkedId && !selected) return <div role="alert" className="space-y-3 rounded-xl border bg-card p-8 text-center"><p>{t("applicationUnavailable", "This application is unavailable. Check your account or try again.")}</p><Button variant="outline" onClick={() => void refetch()}>{t("applicationRetry", "Try again")}</Button><Button variant="ghost" onClick={() => navigate(chefDashboardHref("kitchen-requests"))}>{t("applicationViewAll", "View all applications")}</Button></div>;
  if (selected) {
    const display = displayFor(selected);
    const submittedDocuments = hasStep2BeenSubmitted(selected);
    const book = () => navigate(kitchenPreviewPath(selected.locationId));
    const nextCopy = display.listingPaused ? t("applicationPausedHelp", "Your kitchen access is approved. Booking will be available when this kitchen opens for reservations again.")
      : display.actionKind === "book" ? t("applicationBookHelp", "Your kitchen access is approved. Choose available dates and hours to book your kitchen time.")
      : display.actionKind === "complete-step" ? t("applicationDocumentsHelp", "Upload the required kitchen documents to continue your application.")
      : display.actionKind === "discover" ? t("applicationClosedHelp", "Review the feedback below. You can start a new request when you’re ready.")
      : t("applicationReviewHelp", "Your application is in review. We’ll email you when there’s an update. Nothing else is needed from you right now.");
    return <section className="min-w-0 space-y-6 [overflow-wrap:anywhere]" aria-label={t("applicationPageTitle", "Kitchen application")}>
      <header className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="mb-1 text-xs font-medium text-muted-foreground">APPLICATION-{selected.id}</p><h1 className="text-2xl font-semibold tracking-tight">{t("applicationPageTitle", "Kitchen application")}</h1><p className="mt-1 text-sm text-muted-foreground">{selected.location?.name || t("apptabKitchenFallback", "Kitchen")}</p></div><KitchenStatusChip display={display} /></header>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <section className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-5"><h2 className="text-sm font-semibold">{t("applicationWhatNext", "What to do next")}</h2><p className="text-sm leading-6">{nextCopy}</p><div className="flex flex-wrap gap-2">{display.actionKind === "book" && <Button size="sm" onClick={book}>{t("apptabBookKitchen", "Book kitchen")}</Button>}{display.actionKind === "complete-step" && <Button size="sm" asChild><Link href={`/apply-kitchen/${selected.locationId}`}>{t("continueKitchenApplication", "Continue application")}</Link></Button>}{display.actionKind === "discover" && <Button variant="outline" size="sm" asChild><Link href={`/apply-kitchen/${selected.locationId}`}>{t("kdApplyAgain", "Apply again")}</Link></Button>}{selected.chat_conversation_id && onOpenChat && <Button variant="outline" size="sm" onClick={() => onOpenChat(selected)}><MessageCircle className="mr-1.5 size-4" />{t("openChat", "Open chat")}</Button>}</div></section>
          {definitions.isLoading ? <Skeleton className="h-96 rounded-xl" /> : definitions.error ? <div role="alert" className="space-y-3 rounded-xl border bg-card p-5"><p className="text-sm">{t("applicationFieldsFailed", "We couldn’t load your submitted answer labels.")}</p><Button variant="outline" size="sm" onClick={() => void definitions.refetch()}>{t("applicationRetry", "Try again")}</Button><KitchenApplicationDetails app={selected} display={display} onBookKitchen={book} compact showActions={false} /></div> : <KitchenApplicationDetails app={selected} display={display} onBookKitchen={book} compact requirements={definitions.data} showActions={false} />}
        </div>
        <aside className="space-y-4 lg:sticky lg:top-4">
          <section className="rounded-xl border bg-card p-5"><h2 className="mb-4 text-sm font-semibold">{t("applicationSummary", "Application summary")}</h2><dl className="space-y-4 text-sm">{[[t("applicationReference", "Application reference"), `APPLICATION-${selected.id}`], [t("applicationKitchenLocation", "Kitchen / location"), selected.location?.name], [t("applicationAddress", "Address"), selected.location?.address], [t("apptabSubmitted", "Submitted"), formatDate(selected.createdAt)], [t("applicationUpdated", "Last updated"), formatDate(selected.updatedAt)], ...(submittedDocuments ? [[t("applicationDocumentsSubmitted", "Documents submitted"), formatDate(selected.tier2_completed_at || (selected.tier_data as any)?.tier2_submitted_at)]] : [])].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words">{value || "—"}</dd></div>)}</dl></section>
          {selected.sourceTourId && <Button variant="outline" className="w-full" asChild><Link href={`/dashboard?view=viewings&viewing=${selected.sourceTourId}`}>{t("applicationViewTour", "View kitchen tour")}</Link></Button>}
          <p className="px-1 text-xs text-muted-foreground">{t("applicationNeedHelp", "Need a hand?")} <a className="underline underline-offset-2" href="mailto:support@localcooks.ca">support@localcooks.ca</a></p>
        </aside>
      </div>
    </section>;
  }
  if (!applications.length) return <div className="rounded-xl border border-dashed bg-card px-6 py-12 text-center"><FileText className="mx-auto size-7 text-muted-foreground" /><h2 className="mt-4 text-lg font-semibold">{t("applicationEmptyTitle", "No kitchen applications yet")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("applicationEmptyHelp", "Explore kitchens and request access when you find the right space.")}</p><Button className="mt-5" onClick={() => navigate(chefDashboardHref("discover-kitchens"))}>{t("applicationDiscover", "Discover kitchens")}</Button></div>;
  return <div className="min-w-0 space-y-5" data-testid="chef-kitchen-applications">
    <Input aria-label={t("applicationSearch", "Search kitchen applications")} placeholder={t("applicationSearch", "Search kitchen applications")} value={query} onChange={event => setQuery(event.target.value)} className="sm:max-w-md" />
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">{[["all", t("applicationAll", "All applications")], ["action", t("applicationActionRequired", "Action required")], ["review", t("kdInReview", "In review")], ["approved", t("kdApproved", "Approved")]].map(([key, label]) => <button key={key} type="button" aria-pressed={group === key} onClick={() => setGroup(key)} className={`rounded-xl border p-3 text-left sm:p-4 ${group === key ? "border-primary bg-primary/[0.04]" : "bg-card hover:bg-muted/30"}`}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{applications.filter(app => matchesGroup(app, key)).length}</p></button>)}</div>
    <DataTable columns={columns} data={filtered} defaultSorting={[{ id: "createdAt", desc: true }]} pageSize={15} onRowClick={app => open(app.id)} />
  </div>;
}
