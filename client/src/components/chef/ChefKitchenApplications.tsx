import { MyDocuments } from "./applications/MyDocuments";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { useChefKitchenApplications, type KitchenApplicationWithLocation } from "@/hooks/use-chef-kitchen-applications";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { KitchenStatusChip } from "./applications/status-icons";
import { getKitchenDisplayStatus } from "./applications/status";
import { KitchenAccessPage } from "./applications/KitchenAccessPage";
import { KitchenAccessTracker } from "./applications/KitchenAccessTracker";
import { chefDashboardHref } from "@/lib/chef-dashboard-nav";

export default function ChefKitchenApplications({ onOpenChat }: { onOpenChat?: (app: KitchenApplicationWithLocation) => void }) {
  const { t } = useTranslation("chef");
  const [, navigate] = useLocation();
  const search = useSearch();
  const linkedId = new URLSearchParams(search).get("application");
  const applicationId = linkedId && /^\d+$/.test(linkedId) ? Number(linkedId) : null;
  const { applications, isLoading, error, refetch } = useChefKitchenApplications();
  const renewLocation = Number(new URLSearchParams(search).get('renewLocation'));
  // From Request to apply, which knows the location rather than the application id.
  const forLocation = Number(new URLSearchParams(search).get('location'));
  // Arrived from a tour link at a kitchen already applied to (owner: no tours once applied).
  const notice = new URLSearchParams(search).get('notice');
  // The renewal form opens from a Renew link, or by itself when something needs renewing.
  const renewRequested = !!renewLocation || new URLSearchParams(search).get('renew') === '1';
  // Just sent from Request to apply (owner, Oct 26): the kitchen page shows a one-time "Request sent" banner.
  const sent = new URLSearchParams(search).get('sent');
  const { data: kitchens = [] } = useQuery<Array<{ locationId: number; imageUrl?: string | null }>>({ queryKey: ["/api/public/kitchens"], queryFn: async () => { const response = await fetch("/api/public/kitchens"); if (!response.ok) throw new Error("kitchens"); return response.json(); } });
  const selected = applications.find(app => app.id === applicationId || app.locationId === renewLocation || app.locationId === forLocation);
  useEffect(() => { window.scrollTo(0, 0); }, [applicationId]);
  const open = (id: number) => navigate(`/dashboard?view=kitchen-requests&application=${id}`);
  const displayFor = (app: KitchenApplicationWithLocation) => getKitchenDisplayStatus(app, t);
  if (isLoading) return <div role="status" aria-label={t("applicationLoading", "Loading kitchen applications")} className="space-y-3">{[0, 1, 2].map(item => <Skeleton key={item} className="h-24 rounded-xl" />)}</div>;
  if (error) return <div role="alert" className="space-y-3 rounded-xl border bg-card p-8 text-center"><p>{t("applicationLoadFailed", "We couldn’t load your kitchen applications.")}</p><Button variant="outline" onClick={() => void refetch()}>{t("applicationRetry", "Try again")}</Button></div>;
  if ((linkedId || forLocation) && !selected) return <div role="alert" className="space-y-3 rounded-xl border bg-card p-8 text-center"><p>{t("applicationUnavailable", "This application is unavailable. Check your account or try again.")}</p><Button variant="outline" onClick={() => void refetch()}>{t("applicationRetry", "Try again")}</Button><Button variant="ghost" onClick={() => navigate(chefDashboardHref("kitchen-requests"))}>{t("applicationViewAll", "View all applications")}</Button></div>;
  if (selected) return <KitchenAccessPage app={selected} sent={sent === '1' ? 'request' : sent === 'requirements' ? 'requirements' : null} notice={notice === 'tour' || notice === 'applied' ? notice : null} renewRequested={renewRequested}
    onOpenChat={onOpenChat} onChanged={() => void refetch()} onDismissNotice={() => open(selected.id)} />;
  if (!applications.length) return <div className="rounded-xl border border-dashed bg-card px-6 py-12 text-center"><FileText className="mx-auto size-7 text-muted-foreground" /><h2 className="mt-4 text-lg font-semibold">{t("applicationEmptyTitle", "No kitchen applications yet")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("applicationEmptyHelp", "Explore kitchens and request access when you find the right space.")}</p><Button className="mt-5" onClick={() => navigate(chefDashboardHref("discover-kitchens"))}>{t("applicationDiscover", "Discover kitchens")}</Button></div>;
  const order = (app: KitchenApplicationWithLocation) => ({ "complete-step": 0, book: 2, wait: 1, discover: 3 } as Record<string, number>)[displayFor(app).actionKind] ?? 4;
  const sorted = [...applications].sort((a, b) => order(a) - order(b) || Date.parse(String(b.updatedAt || b.createdAt)) - Date.parse(String(a.updatedAt || a.createdAt)));
  const needsYou = applications.filter(app => displayFor(app).actionKind === "complete-step").length;
  const photoOf = (app: KitchenApplicationWithLocation) => kitchens.find(kitchen => kitchen.locationId === app.locationId)?.imageUrl || app.location?.brandImageUrl || null;
  return <div className="min-w-0 space-y-5" data-testid="chef-kitchen-applications">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-semibold tracking-tight">{t("kaListTitle", "My kitchens")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("kaListCount", { defaultValue: "{count, plural, one {# kitchen} other {# kitchens}}", count: applications.length })}{needsYou ? ` · ${t("kaListNeedsYou", { defaultValue: "{count} needs you", count: needsYou })}` : ""}</p></div>
      <Button variant="outline" onClick={() => navigate(chefDashboardHref("discover-kitchens"))}>{t("kaFindAnother", "Find another kitchen")}</Button>
    </div>
    <ul className="divide-y rounded-xl border bg-card">
      {sorted.map(app => { const display = displayFor(app); const photo = photoOf(app);
        const primary = display.actionKind === "complete-step" || display.actionKind === "book";
        return <li key={app.id}><Link href={`/dashboard?view=kitchen-requests&application=${app.id}`} data-testid={`kitchen-access-row-${app.id}`}
          className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-x-4 gap-y-3 p-4 hover:bg-muted/30 sm:grid-cols-[96px_minmax(0,1fr)_80px_220px] sm:gap-x-5 sm:px-5">
          {photo ? <img src={photo} alt="" className="size-16 rounded-lg object-cover sm:h-[72px] sm:w-24" /> : <div className="size-16 rounded-lg bg-muted sm:h-[72px] sm:w-24" aria-hidden />}
          <div className="min-w-0"><p className="font-semibold">{app.location?.name || t("apptabKitchenFallback", "Kitchen")}</p>
            <p className="truncate text-sm text-muted-foreground">{app.location?.address}</p>
            <KitchenStatusChip display={display} /></div>
          <KitchenAccessTracker app={app} mini className="hidden sm:flex" />
          <span className={cn("col-span-2 inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-semibold sm:col-span-1 sm:justify-self-end",
            primary ? "bg-primary text-primary-foreground" : "border bg-background")}>{primary ? display.actionLabel : display.actionKind === "discover" ? t("kaViewNote", "View the kitchen’s note") : t("kaViewRequest", "View request")}</span>
        </Link></li>; })}
    </ul>
    <MyDocuments applications={applications} />
  </div>;
}
