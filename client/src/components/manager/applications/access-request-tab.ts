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
