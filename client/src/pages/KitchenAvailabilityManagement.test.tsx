import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The availability screen must RENDER when there is no kitchen, not throw.
 *
 * It threw. `AvailabilityContent` is a separate component from `KitchenAvailabilityManagement`, and
 * the empty state inside it reached for `availableKitchens` — which belongs to the component ABOVE
 * it. The result was `ReferenceError: availableKitchens is not defined`, thrown during render, so
 * "Exit setup" on the Availability step took the whole wizard down with it.
 *
 * Why nothing caught it: the step's own test MOCKS this module (`vi.mock("@/pages/…")`), so the real
 * component never ran, and `esbuild` resolves syntax and imports but not identifiers — a name from
 * the wrong scope bundles perfectly happily. This file renders the real thing for that reason.
 *
 * The two scopes are the point. Anything this component needs from the one above it arrives as a
 * PROP; anything it needs for itself is a hook of its own.
 */
const h = vi.hoisted(() => ({
  kitchens: [] as any[],
  navigate: vi.fn(),
}));

vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => key }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-manager-dashboard", () => ({
  useManagerDashboard: () => ({ kitchens: h.kitchens, isLoadingKitchens: false }),
}));
vi.mock("wouter", () => ({
  Link: ({ children }: { children?: unknown }) => children,
  useLocation: () => ["/manager/dashboard", h.navigate],
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [], isLoading: false }),
  useMutation: () => ({ mutateAsync: vi.fn(), mutate: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
}));
vi.mock("@/components/manager/ViewingSettingsPanel", () => ({ default: () => null }));

import KitchenAvailabilityManagement from "./KitchenAvailabilityManagement";

beforeEach(() => {
  h.kitchens = [];
  h.navigate = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("KitchenAvailabilityManagement — no kitchen", () => {
  it("renders the prerequisite screen instead of throwing", () => {
    /*
     * The regression, stated as the thing the manager sees. If this throws, the error surfaces as
     * "Something went wrong, please refresh" over the entire setup wizard.
     */
    render(<KitchenAvailabilityManagement />);

    expect(screen.getByText("noKitchenTitle")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "addYourKitchen" })).toBeInTheDocument();
  });

  it("renders the embedded path too — the one the wizard uses", () => {
    /*
     * `KitchenAvailabilityManagement` has TWO render paths: the tabbed one and an `embedded` early
     * return. Only the first was wired when the empty state was replaced, and `tsc` caught the second
     * — a missing required prop, which at runtime would have been `undefined` (falsy, i.e. silently
     * the wrong words rather than a crash). Both paths are asserted now.
     */
    render(<KitchenAvailabilityManagement embedded initialLocationId={7} initialKitchenId={null} />);

    expect(screen.getByText("noKitchenTitle")).toBeInTheDocument();
  });

  it("does not tell a manager who HAS a kitchen to add one", () => {
    // `hasKitchen` is a prop precisely because this component cannot see the list above it. Getting
    // it wrong is not a crash — it is wrong advice, which is harder to notice.
    h.kitchens = [{ id: 99, name: "Harbour Kitchen", locationId: 7 }];
    render(<KitchenAvailabilityManagement />);

    // With a kitchen, the component resolves it and never reaches the prerequisite screen.
    expect(screen.queryByText("noKitchenTitle")).not.toBeInTheDocument();
  });
});
