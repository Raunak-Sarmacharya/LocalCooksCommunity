import { apiClient } from "@/lib/api";

/** Use the existing Stripe route for both dashboard access and unfinished onboarding. */
export async function getManagerStripeDashboardLink(fromSetup = false) {
  const response = await apiClient.get(
    `/manager/stripe-connect/dashboard-link${fromSetup ? "?from=setup" : ""}`,
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to get dashboard link");
  if (!data.url) throw new Error("Dashboard link URL not provided");
  return { url: data.url, requiresOnboarding: data.requiresOnboarding || false };
}
