import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import copy from "@shared/i18n/locales/en-CA/chef.json";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, vars?: Record<string, unknown>) =>
  ((copy as Record<string, string>)[key] || key).replace(/\{(\w+)\}/g, (_, name) => String(vars?.[name] ?? "")) }) }));
vi.mock("@/hooks/use-auth", () => ({ useFirebaseAuth: () => ({ user: { uid: "u1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: { getIdToken: async () => "t" } } }));
vi.mock("@/components/training/TrainingVideoPlayer", () => ({ default: () => <p>player</p> }));
import ChefResourcesPanel from "./ChefResourcesPanel";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const mount = (watched: number, confirmed = false, kitchenSetting: "commercial" | "home" | null = "home") => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes("/progress/")
    ? { progress: Array.from({ length: watched }, (_, i) => ({ videoId: i < 14 ? `basics-${i}` : `howto-${i}`, completed: true })) }
    : { confirmed } })));
  return render(<QueryClientProvider client={new QueryClient()}><ChefResourcesPanel onViewModeChange={vi.fn()} kitchenSetting={kitchenSetting} onFindKitchens={vi.fn()} /></QueryClientProvider>);
};

it("marks the chef's own kitchen and keeps home cooking open to more with a licence", async () => {
  mount(9);
  const table = screen.getByRole("table");
  expect(within(table).getByText(copy.res_yourSetting)).toBeInTheDocument();
  expect(within(table).getByText(copy.res_home_makeNote)).toBeInTheDocument();
  expect(within(table).getByRole("link", { name: copy.res_linkLicenceHome })).toHaveAttribute("href", expect.stringContaining("gov.nl.ca"));
  expect(screen.getByRole("tab", { name: `${copy.res_tab_home} · ${copy.res_yours}` })).toHaveAttribute("aria-selected", "true");
});

it("shows progress and credits Unilever; the certificate of completion only once finished", async () => {
  mount(9);
  expect(await screen.findByText("9")).toBeInTheDocument();
  expect(screen.getByText(copy.res_videosSource)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: copy.res_continue })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: copy.res_certDownload })).not.toBeInTheDocument();
  cleanup();
  mount(22, true);
  expect(await screen.findByRole("button", { name: copy.res_certDownload })).toBeInTheDocument();
  expect(screen.getByText(copy.res_certNote)).toBeInTheDocument();
});

it("guides open the public guide at their chapter", () => {
  mount(0, false, null);
  expect(screen.getByRole("link", { name: new RegExp(copy.res_guide_insurance) })).toHaveAttribute("href", "/resources#liability-insurance");
  expect(screen.queryByText(copy.res_yourSetting)).not.toBeInTheDocument();
});
