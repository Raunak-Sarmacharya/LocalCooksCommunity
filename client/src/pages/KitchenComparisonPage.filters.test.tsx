import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({ user: null as any, applications: [] as any[], navigate: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useFirebaseAuth: () => ({ user: state.user, loading: false }) }));
vi.mock("@/hooks/use-chef-kitchen-applications", () => ({ useChefKitchenApplicationsStatus: () => ({ applications: state.applications, isLoading: false }) }));
vi.mock("wouter", async (original) => ({ ...(await original<typeof import("wouter")>()), useLocation: () => ["/", state.navigate] }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, options?: any) => typeof options === "string" ? options
  : (options?.defaultValue ?? key).replace(/\{count, plural, one \{# ([^}]*)\} other \{# ([^}]*)\}\}/, (_: string, one: string, other: string) => `${options.count} ${options.count === 1 ? one : other}`)
    .replace(/\{(\w+)\}/g, (_: string, name: string) => String(options?.[name] ?? "")), i18n: { language: "en-CA" } }) }));
vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => key }));
vi.mock("@/components/kitchen/KitchensMap", () => ({ default: () => <div data-testid="map" /> }));
vi.mock("@/components/layout/Header", () => ({ default: () => null }));
vi.mock("@/components/SEO/SEOHead", () => ({ default: () => null }));
vi.mock("framer-motion", () => ({ AnimatePresence: ({ children }: any) => children, motion: new Proxy({}, { get: () => ({ children, initial, animate, exit, transition, whileInView, viewport, ...rest }: any) => <div {...rest}>{children}</div> }) }));
import { KitchenBrowser } from "./KitchenComparisonPage";

const kitchens = [
  { id: 1, name: "Harbour", locationId: 10, hourlyRate: 2500, dailyRate: 18000, equipment: ["Oven", "Mixer"], latitude: 47.5, longitude: -52.7,
    storageSummary: { hasDryStorage: true, hasColdStorage: true, hasFreezerStorage: false, totalStorageUnits: 2 }, equipmentSummary: { included: 8, rental: 9 } },
  { id: 2, name: "North", locationId: 11, hourlyRate: 1000, dailyRate: null, equipment: ["Oven"], latitude: 47.6, longitude: -52.7,
    storageSummary: { hasDryStorage: false, hasColdStorage: false, hasFreezerStorage: false, totalStorageUnits: 0 }, equipmentSummary: { included: 1, rental: 0 } },
];
let client: QueryClient;
beforeEach(() => {
  state.user = null; state.applications = []; state.navigate.mockClear();
  window.scrollTo = vi.fn();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["/api/public/kitchens"], kitchens);
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });
const page = (embedded = false) => render(<QueryClientProvider client={client}><KitchenBrowser embedded={embedded} /></QueryClientProvider>);
const names = () => screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);

it("filters by storage and shows the hour and day price, storage and equipment on each card", () => {
  page();
  expect(names()).toEqual(["Harbour", "North"]);
  expect(screen.getByText("$180", { exact: false })).toBeInTheDocument();
  expect(screen.getAllByTestId("kb-facts")[0]).toHaveTextContent("Dry + Cold storage · 2 spaces");
  expect(screen.getAllByTestId("kb-facts")[1]).toHaveTextContent("No storage");
  fireEvent.click(within(screen.getByTestId("kb-filters")).getByRole("button", { name: "Has storage" }));
  expect(names()).toEqual(["Harbour"]);
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(names()).toEqual(["Harbour", "North"]);
});

it("inside the app: no sign-up card, the chef's next step on each card, waiting opens the kitchen page", () => {
  state.user = { uid: "chef" };
  state.applications = [{ locationId: 10, status: "inReview" }];
  page(true);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Kitchens in St. John’s");
  expect(screen.queryByText("Ready to book a kitchen?")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Waiting for the kitchen/ }));
  expect(state.navigate).toHaveBeenCalledWith("/dashboard?view=kitchen-requests&location=10");
});
