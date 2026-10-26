/**
 * The chef's progress at one kitchen (owner-approved mock, Oct 26): Request to apply → Booking requirements → Book.
 * The same three marks on Home, My kitchens and the kitchen page, so a chef reads every surface the same way.
 * The kitchen is always the one reviewing: Local Cooks' first step never shows (hidden-admin-step rule).
 */
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { fromCalendarDate } from "@/lib/calendar-date";
import type { KitchenApplicationWithLocation } from "@/hooks/use-chef-kitchen-applications";
import { applicationTier, hasStep2BeenSubmitted } from "./status";

/** done = finished · now = needs the chef · wait = with the kitchen · todo = not yet · stop = declined here. */
export type AccessMark = "done" | "now" | "wait" | "todo" | "stop";
export interface AccessStep { mark: AccessMark; note: string }

type TrackerApp = Pick<KitchenApplicationWithLocation, "status" | "createdAt" | "tier_data" | "documentsWaivedAt" | "tier1_completed_at" | "tier2_completed_at" | "reviewedAt" | "updatedAt" | "bookingEligibility"> & { current_tier?: number | null };

export function useAccessSteps(app: TrackerApp): AccessStep[] {
  const { t, i18n } = useTranslation("chef");
  const day = (value: unknown) => {
    const date = value ? fromCalendarDate(value as string | Date) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString(i18n.language, { month: "short", day: "numeric" }) : "";
  };
  const tier = applicationTier(app);
  const status = (app.status || "").toLowerCase();
  const added = !!(app.tier_data as Record<string, unknown> | null)?.addedByKitchen;
  const waived = !!app.documentsWaivedAt;
  const step2Sent = hasStep2BeenSubmitted(app);
  const first: AccessStep = added ? { mark: "done", note: t("trAdded", "Added by the kitchen") }
    : { mark: "done", note: t("trSentOn", { defaultValue: "Sent {date}", date: day(app.createdAt) }) };
  const approvedFirst: AccessStep = added ? first : { mark: "done", note: t("trApprovedOn", { defaultValue: "Approved {date}", date: day(app.tier1_completed_at || app.reviewedAt) }) };
  const notNeeded: AccessStep = { mark: "done", note: t("trNotNeeded", "Not needed") };
  if (status === "rejected") return tier >= 2 && step2Sent
    ? [approvedFirst, { mark: "stop", note: t("trDeclined", "Declined") }, { mark: "todo", note: "" }]
    : [{ mark: "stop", note: t("trDeclined", "Declined") }, { mark: "todo", note: "" }, { mark: "todo", note: "" }];
  // Approved, but a document needs renewing (or is being checked) before new bookings: the documents step is current again.
  if (status === "approved" && tier >= 3 && app.bookingEligibility?.status === "access_ended") return [approvedFirst, { mark: "done", note: "" }, { mark: "stop", note: t("locationAccessEnded", "Access ended") }];
  if (status === "approved" && tier >= 3 && app.bookingEligibility?.canBook === false) return [approvedFirst,
    { mark: app.bookingEligibility.status === "renewal_under_review" ? "wait" : "now", note: app.bookingEligibility.status === "renewal_under_review" ? t("renewalUnderReview", "Renewal under review") : t("renewDocumentsTitle", "Renew documents") }, { mark: "todo", note: "" }];
  if (status === "approved" && tier >= 3) return [approvedFirst, waived ? notNeeded : { mark: "done", note: t("trApprovedOn", { defaultValue: "Approved {date}", date: day(app.reviewedAt || app.updatedAt) }) }, { mark: "now", note: t("trReady", "Ready to book") }];
  if (status === "approved" && step2Sent) return [approvedFirst, { mark: "wait", note: t("trSentWithKitchen", { defaultValue: "Sent {date} · with the kitchen", date: day(app.tier2_completed_at) }) }, { mark: "todo", note: "" }];
  if (status === "approved" || tier >= 2) return [approvedFirst, { mark: "now", note: t("trYourTurn", "Your turn") }, { mark: "todo", note: "" }];
  return [{ mark: "wait", note: t("trSentWithKitchen", { defaultValue: "Sent {date} · with the kitchen", date: day(app.createdAt) }) }, { mark: "todo", note: "" }, { mark: "todo", note: "" }];
}

const BAR: Record<AccessMark, string> = { done: "bg-foreground", now: "bg-primary", wait: "bg-foreground/35", todo: "bg-border", stop: "bg-muted-foreground" };

/** The tracker before anything is sent, at the top of Request to apply: what this step is and what follows. */
export function KitchenAccessIntro({ className }: { className?: string }) {
  const { t } = useTranslation("chef");
  const steps: Array<[string, string, AccessMark]> = [[t("trRequest", "Request to apply"), t("trIntroRequest", "About 3 minutes"), "now"],
    [t("trRequirements", "Booking requirements"), t("trIntroRequirements", "After the kitchen replies"), "todo"], [t("trBook", "Book"), t("trIntroBook", "By the hour or the day"), "todo"]];
  return <ol className={cn("grid grid-cols-3 gap-2 sm:gap-3", className)} aria-label={t("trLabel", "Your progress at this kitchen")}>
    {steps.map(([name, note, mark], i) => <li key={i} className="min-w-0" aria-current={mark === "now" ? "step" : undefined}>
      <span className={cn("block h-1 rounded-full", BAR[mark])} aria-hidden />
      <p className={cn("mt-2.5 text-xs font-semibold leading-tight sm:text-sm", mark === "todo" && "font-medium text-muted-foreground")}>{name}</p>
      <p className="mt-0.5 hidden text-[13px] text-muted-foreground sm:block">{note}</p></li>)}
  </ol>;
}

/** Full tracker for the kitchen page; `mini` is the three marks only, for rows (labelled for screen readers). */
export function KitchenAccessTracker({ app, mini = false, className }: { app: TrackerApp; mini?: boolean; className?: string }) {
  const { t } = useTranslation("chef");
  const steps = useAccessSteps(app);
  const names = [t("trRequest", "Request to apply"), t("trRequirements", "Booking requirements"), t("trBook", "Book")];
  if (mini) return <div className={cn("flex w-20 shrink-0 gap-1", className)} role="img"
    aria-label={steps.map((step, i) => `${names[i]}: ${step.note || t("trNotYet", "not yet")}`).join(", ")}>
    {steps.map((step, i) => <span key={i} className={cn("h-1 flex-1 rounded-full", BAR[step.mark])} />)}
  </div>;
  return <ol className={cn("grid grid-cols-3 gap-2 sm:gap-3", className)} aria-label={t("trLabel", "Your progress at this kitchen")} data-testid="kitchen-access-tracker">
    {steps.map((step, i) => <li key={i} className="min-w-0" aria-current={step.mark === "now" ? "step" : undefined}>
      <span className={cn("block h-1 rounded-full", BAR[step.mark])} aria-hidden />
      <p className={cn("mt-2.5 text-xs font-semibold leading-tight sm:text-sm", step.mark === "todo" && "font-medium text-muted-foreground")}>{names[i]}</p>
      {step.note && <p className="mt-0.5 hidden text-[13px] text-muted-foreground sm:block">{step.note}</p>}
    </li>)}
  </ol>;
}
