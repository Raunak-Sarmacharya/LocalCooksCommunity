/**
 * Access requests, the kitchen's inbox of customers asking to book (owner, Oct 24).
 *
 * Follows Food Corridor's Client Onboarding → Clients split: this list holds requests in progress only, and an
 * approved customer lives on the Customers page. Tabs say who has to act; the requests that need the kitchen come
 * first, oldest first, like an inbox.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { mt } from "@/i18n/manager";
import i18n from "@/i18n";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, X, MessageCircle, ArrowRight } from "@/components/ui/manager-icons";
import type { Application } from "./types";

export type AccessRequestTab = "review" | "waiting" | "declined";

/** Which tab a request belongs in; approved customers without anything to review are on Customers instead. */
export function accessRequestTab(app: Application): AccessRequestTab | null {
  if (app.status === "rejected") return "declined";
  if (app.status === "inReview") return "review";
  if (app.status !== "approved") return null;
  const tier = app.current_tier ?? 1;
  if (tier >= 3) return (app.documentRenewals || []).some((renewal) => renewal.status === "pending") ? "review" : null;
  return app.tier2_completed_at ? "review" : "waiting";
}

const day = (value?: string | null) => value ? new Date(value).toLocaleDateString(i18n.language, { month: "short", day: "numeric" }) : "";
const DOCUMENT_NAME_KEYS = { foodSafetyLicense: "arDocFoodSafety", foodEstablishmentCert: "arDocEstablishment", insurance: "arDocInsurance" } as const;

/** One short line saying where the request stands. */
export function accessRequestLine(app: Application): string {
  const tab = accessRequestTab(app);
  const renewal = (app.documentRenewals || []).find((item) => item.status === "pending");
  if (tab === "review" && (app.current_tier ?? 1) >= 3 && renewal) return renewal.key in DOCUMENT_NAME_KEYS
    ? mt("arLineRenewal", { document: mt(DOCUMENT_NAME_KEYS[renewal.key as keyof typeof DOCUMENT_NAME_KEYS]) }) : mt("arLineRenewalOther");
  if (tab === "review") return mt("arLineSent", { date: day(app.tier2_completed_at || app.updatedAt) });
  if (tab === "waiting") return mt("arLineWaiting", { date: day(app.tier1_completed_at || app.reviewedAt || app.createdAt) });
  if (tab === "declined") return mt("arLineDeclined", { date: day(app.reviewedAt || app.updatedAt) });
  return "";
}

const sortKey = (app: Application) => Date.parse(app.tier2_completed_at || app.updatedAt || app.createdAt) || 0;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "?";

export function AccessRequestsList({ applications, unreadCounts, onOpen, onOpenRequirements }: {
  applications: Application[];
  unreadCounts: Record<number, number>;
  onOpen: (application: Application) => void;
  onOpenRequirements: () => void;
}) {
  const grouped = useMemo(() => {
    const groups: Record<AccessRequestTab, Application[]> = { review: [], waiting: [], declined: [] };
    for (const app of applications) { const tab = accessRequestTab(app); if (tab) groups[tab].push(app); }
    // The kitchen's queue is first come, first served; the others show the newest first.
    groups.review.sort((a, b) => sortKey(a) - sortKey(b));
    groups.waiting.sort((a, b) => sortKey(b) - sortKey(a));
    groups.declined.sort((a, b) => sortKey(b) - sortKey(a));
    return groups;
  }, [applications]);
  const [tab, setTab] = useState<AccessRequestTab>(() => (grouped.review.length || !grouped.waiting.length ? "review" : "waiting"));
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? grouped[tab].filter((app) => [app.fullName, app.email, app.location?.name].some((value) => value?.toLowerCase().includes(q))) : grouped[tab];
  }, [grouped, tab, query]);

  const tabs: { id: AccessRequestTab; label: string }[] = [
    { id: "review", label: mt("arTabReview") },
    { id: "waiting", label: mt("arTabWaiting") },
    { id: "declined", label: mt("arTabDeclined") },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{mt("navRequests")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{mt("arLead")}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onOpenRequirements}>{mt("navApplicationRequirements")}</Button>
      </div>

      <div className="flex flex-col gap-3 border-b sm:flex-row sm:items-end sm:justify-between">
        <div role="tablist" aria-label={mt("navRequests")} className="-mb-px flex gap-5 overflow-x-auto pr-4">
          {tabs.map(({ id, label }) => {
            const active = tab === id;
            const count = grouped[id].length;
            return (
              <button key={id} type="button" role="tab" aria-selected={active} onClick={() => setTab(id)}
                className={cn("!min-h-0 flex shrink-0 items-center gap-2 border-b-2 pb-3 pt-1 text-sm font-medium transition-colors",
                  active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {label}
                {count > 0 && <span className={cn("rounded-full px-1.5 py-0.5 text-xs tabular-nums", active && id === "review" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{count}</span>}
              </button>
            );
          })}
        </div>
        <div className="relative mb-3 w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={mt("arSearch")} aria-label={mt("arSearch")} className="h-10 pl-9 pr-9" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label={mt("clearSearch")} className="!min-h-0 absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
        </div>
      </div>

      {rows.length ? (
        <ul role="tabpanel" className="divide-y rounded-xl border bg-card">
          {rows.map((app) => {
            const unread = unreadCounts[app.id] || 0;
            return (
              <li key={app.id}>
                <button type="button" onClick={() => onOpen(app)} className="!min-h-0 flex w-full items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-muted/40 sm:px-5">
                  <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">{initials(app.fullName)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{app.fullName}</span>
                    {/* Two lines on a phone so the status is never cut off; one line from sm up. */}
                    <span className="mt-0.5 block text-sm text-muted-foreground sm:truncate">
                      {app.location?.name && <span className="block truncate sm:inline">{app.location.name}<span className="hidden sm:inline"> · </span></span>}
                      <span className="block sm:inline">{accessRequestLine(app)}</span>
                    </span>
                  </span>
                  {unread > 0 && (
                    <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary" aria-label={mt("arUnread", { count: unread })}>
                      <MessageCircle className="h-4 w-4" />{unread}
                    </span>
                  )}
                  <span className={cn("hidden shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium sm:inline-flex",
                    tab === "review" ? "bg-primary text-primary-foreground" : "border text-foreground")}>
                    {tab === "review" ? mt("arReview") : mt("arOpen")}
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground sm:hidden" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div role="tabpanel" className="rounded-xl border border-dashed px-6 py-10 text-center">
          <p className="text-sm font-medium text-foreground">{query ? mt("arEmptySearch") : mt(tab === "review" ? "arEmptyReview" : tab === "waiting" ? "arEmptyWaiting" : "arEmptyDeclined")}</p>
          {!query && tab === "review" && <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{mt("arEmptyReviewBody")}</p>}
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        {mt("arApprovedLive")}{" "}
        <Link href="/manager/dashboard?view=customers" className="font-medium text-foreground underline underline-offset-4">{mt("arGoCustomers")}</Link>
      </p>
    </div>
  );
}
