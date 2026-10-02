import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { kitchenListingReadinessKey } from "@/lib/manager-kitchens-navigation";
import type { KitchenReadinessReview } from "@shared/kitchen-listing-readiness";
import { KitchenListingStatus } from "./KitchenListingStatus";

const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiGet: mocks.apiGet, apiPost: vi.fn() }));
vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-status-button", () => ({
  useStatusButton: () => ({ status: "idle", execute: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  mocks.apiGet.mockReset();
});

describe("KitchenListingStatus", () => {
  it("hides cached listing status while checking fresh readiness, then shows the new status", async () => {
    let finish!: (value: KitchenReadinessReview) => void;
    mocks.apiGet.mockReturnValue(new Promise<KitchenReadinessReview>((resolve) => { finish = resolve; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const review = {
      listingStatus: "active",
      adminHidden: false,
      checklist: { missingRequirementIds: [], openRecommendationIds: [] },
      details: { kitchenName: "Test Kitchen" },
    } as unknown as KitchenReadinessReview;
    client.setQueryData(kitchenListingReadinessKey(7), review);

    render(<QueryClientProvider client={client}>
      <KitchenListingStatus kitchenId={7} selector={<button type="button">Choose kitchen</button>} />
    </QueryClientProvider>);

    expect(screen.getByRole("status", { name: "listingStatusLoading" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Choose kitchen" })).toBeInTheDocument();
    expect(screen.queryByText("listingStatusLiveLabel")).not.toBeInTheDocument();

    finish({ ...review, listingStatus: "draft" });
    expect(await screen.findByText("listingStatusDraftLabel")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "listingStatusLoading" })).not.toBeInTheDocument();
  });
});
