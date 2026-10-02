import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { afterEach, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import english from "@shared/i18n/locales/en-CA/common.json";
import Header from "./Header";
import { scrollToPageSection } from "@/lib/scroll-to-page-section";

const context = vi.hoisted(() => ({ subdomain: "kitchen", user: null as { uid: string; email: string; role: string } | null }));
vi.mock("@shared/subdomain-utils", async importOriginal => ({
  ...await importOriginal<typeof import("@shared/subdomain-utils")>(),
  getSubdomainFromHostname: () => context.subdomain,
}));
vi.mock("@/hooks/use-auth", () => ({ useFirebaseAuth: () => ({ user: context.user, logout: vi.fn() }) }));
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: undefined }) }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/logo", () => ({ default: () => <span /> }));
vi.mock("@/lib/scroll-to-page-section", () => ({ scrollToPageSection: vi.fn(() => true) }));

afterEach(() => { cleanup(); context.user = null; vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

it("opts host pages into distinct links and preserves account and chef navigation", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({ lng: "en-CA", resources: { "en-CA": { common: english } } });
  const showHeader = (kitchenHostLinks = false) => render(<I18nextProvider i18n={i18n}><Header kitchenHostLinks={kitchenHostLinks} /></I18nextProvider>);

  context.subdomain = "kitchen";
  showHeader(true);
  const login = screen.getByRole("link", { name: english.loginRegister });
  expect(login).toHaveAttribute("href", "/manager/login");
  fireEvent.click(screen.getByRole("link", { name: english.howItWorks }));
  expect(scrollToPageSection).toHaveBeenLastCalledWith("how-it-works");
  fireEvent.keyDown(screen.getByRole("button", { name: english.services }), { key: "ArrowDown" });
  const earning = await screen.findByRole("menuitem", { name: new RegExp(english.kitchenLandingEarn) });
  expect(earning).toHaveAttribute("href", "/en-CA#revenue-streams");
  expect(screen.getByRole("menuitem", { name: new RegExp(english.kitchenLandingControls) })).toHaveAttribute("href", "/en-CA#everything-included");
  expect(screen.getByRole("menuitem", { name: new RegExp(english.chefPartnerLink) })).toHaveAttribute("href", expect.stringContaining("chef."));
  fireEvent.click(earning);
  expect(scrollToPageSection).toHaveBeenLastCalledWith("revenue-streams");
  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: english.openMenu }));
  const services = document.querySelectorAll<HTMLAnchorElement>("[data-service-row]");
  expect([...services].map(link => link.getAttribute("href"))).toEqual(["/en-CA#revenue-streams", "/en-CA#everything-included"]);
  vi.mocked(scrollToPageSection).mockClear();
  fireEvent.click(services[1]);
  await waitFor(() => expect(scrollToPageSection).toHaveBeenLastCalledWith("everything-included"));
  cleanup();

  showHeader();
  expect(screen.queryByRole("link", { name: english.howItWorks })).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("button", { name: english.services }), { key: "ArrowDown" });
  expect(await screen.findByRole("menuitem", { name: new RegExp(english.kitchenServiceListSpace) })).toHaveAttribute("href", "/#how-it-works");
  cleanup();

  context.subdomain = "chef";
  showHeader();
  expect(screen.queryByRole("link", { name: english.howItWorks })).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("button", { name: english.services }), { key: "ArrowDown" });
  expect(await screen.findByRole("menuitem", { name: new RegExp(english.chefServiceBookKitchen) })).toHaveAttribute("href", "/#kitchen-access");
});

it("returns from kitchen resources to the right landing section without changing the URL locale", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  context.subdomain = "kitchen";
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({ lng: "en-CA", resources: { "en-CA": { common: english } } });
  for (const locale of ["en-CA", "fr-CA", "uk"]) {
    const navigation = memoryLocation({ path: `/${locale}/resources`, record: true });
    render(<Router hook={navigation.hook}><I18nextProvider i18n={i18n}><Header kitchenHostLinks /></I18nextProvider></Router>);
    const how = screen.getByRole("link", { name: english.howItWorks });
    expect(how).toHaveAttribute("href", `/${locale}#how-it-works`);
    fireEvent.click(how);
    expect(navigation.history.at(-1)).toBe(`/${locale}#how-it-works`);
    cleanup();
  }
});

it("hides on deliberate downward scroll, reveals upward, and protects menu and keyboard interaction", async () => {
  context.subdomain = "kitchen";
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("innerHeight", 800);
  vi.stubGlobal("scrollY", 0);
  vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(2800);
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({ lng: "en-CA", resources: { "en-CA": { common: english } } });
  const navigation = memoryLocation({ path: "/en-CA", record: true });
  const { container } = render(<Router hook={navigation.hook}><I18nextProvider i18n={i18n}><Header kitchenHostLinks /></I18nextProvider></Router>);
  const header = container.querySelector("header")!;
  const scroll = (y: number) => { vi.stubGlobal("scrollY", y); fireEvent.scroll(window); };
  const hidden = (value: boolean) => expect(header).toHaveAttribute("data-scroll-hidden", String(value));

  scroll(50); hidden(false); // Stay visible near the top.
  scroll(100); hidden(true);
  scroll(98); scroll(101); hidden(true); // Trackpad jitter does not toggle it.
  scroll(97); hidden(true);
  scroll(93); hidden(false);
  scroll(95); hidden(false);
  scroll(113); hidden(true);

  fireEvent.keyDown(window, { key: "Tab" });
  const how = screen.getByRole("link", { name: english.howItWorks });
  act(() => how.focus()); hidden(false);
  scroll(300); hidden(false);
  act(() => how.blur());
  scroll(330); hidden(true);

  fireEvent.keyDown(screen.getByRole("button", { name: english.services }), { key: "ArrowDown" });
  await screen.findByRole("menu"); hidden(false);
  scroll(450); hidden(false);
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  act(() => (document.activeElement as HTMLElement).blur());
  fireEvent.click(screen.getByRole("button", { name: english.openMenu }));
  scroll(600); hidden(false); // The expanded mobile menu must never slide away.
  fireEvent.click(screen.getByRole("button", { name: english.closeMenu }));
  scroll(630); hidden(true);

  scroll(2000); hidden(true);
  scroll(2060); scroll(2000); hidden(true); // Bottom bounce is not an upward intent.
  scroll(1992); hidden(false);
  scroll(-40); scroll(0); hidden(false);
  scroll(100); hidden(true);
  act(() => navigation.navigate("/en-CA/resources")); hidden(false);
  expect(header.className).toContain("motion-reduce:transition-none");
});

it("leaves other headers and static layouts out of scroll behavior", () => {
  vi.stubGlobal("scrollY", 0);
  for (const props of [{}, { kitchenHostLinks: true, position: "static" as const }, { hideOnScroll: true, position: "static" as const }]) {
    const { container } = render(<Header {...props} />);
    vi.stubGlobal("scrollY", 500);
    fireEvent.scroll(window);
    expect(container.querySelector("header")).toHaveAttribute("data-scroll-hidden", "false");
    expect(container.querySelector("header")?.className).not.toContain("translate-y");
    cleanup();
  }
});

it("shares scroll behavior with chef pages while preserving chef links and mobile section navigation", async () => {
  context.subdomain = "chef";
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("innerHeight", 800);
  vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(2800);
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({ lng: "en-CA", resources: { "en-CA": { common: english } } });

  for (const path of ["/en-CA", "/en-CA/resources", "/fr-CA/resources", "/uk/resources"]) {
    vi.stubGlobal("scrollY", 0);
    const navigation = memoryLocation({ path, record: true });
    const { container } = render(<Router hook={navigation.hook}><I18nextProvider i18n={i18n}><Header hideOnScroll /></I18nextProvider></Router>);
    const header = container.querySelector("header")!;
    expect(screen.getByRole("link", { name: english.loginRegister })).toHaveAttribute("href", "/auth");
    expect(screen.queryByRole("link", { name: english.howItWorks })).not.toBeInTheDocument();
    vi.stubGlobal("scrollY", 100); fireEvent.scroll(window);
    expect(header).toHaveAttribute("data-scroll-hidden", "true");
    vi.stubGlobal("scrollY", 92); fireEvent.scroll(window);
    expect(header).toHaveAttribute("data-scroll-hidden", "false");

    fireEvent.keyDown(screen.getByRole("button", { name: english.services }), { key: "ArrowDown" });
    const kitchen = await screen.findByRole("menuitem", { name: new RegExp(english.chefServiceBookKitchen) });
    expect(kitchen).toHaveAttribute("href", "/#kitchen-access");
    expect(screen.getByRole("menuitem", { name: new RegExp(english.chefServiceSell) })).toHaveAttribute("href", "/#how-it-works");
    vi.stubGlobal("scrollY", 200); fireEvent.scroll(window);
    expect(header).toHaveAttribute("data-scroll-hidden", "false");
    fireEvent.click(kitchen);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    if (path.endsWith("/resources")) {
      expect(window.sessionStorage.getItem("chef-landing-scroll-target")).toBe("kitchen-access");
      expect(navigation.history.at(-1)).toBe("/");
      window.sessionStorage.removeItem("chef-landing-scroll-target");
    } else {
      fireEvent.click(screen.getByRole("button", { name: english.openMenu }));
      vi.stubGlobal("scrollY", 300); fireEvent.scroll(window);
      expect(header).toHaveAttribute("data-scroll-hidden", "false");
      vi.mocked(scrollToPageSection).mockClear();
      fireEvent.click(container.querySelector<HTMLAnchorElement>("[data-service-row]")!);
      await waitFor(() => expect(scrollToPageSection).toHaveBeenLastCalledWith("how-it-works"));
    }
    cleanup();
  }
});

it("keeps the signed-in account menu anchored while scrolling", async () => {
  context.subdomain = "kitchen";
  context.user = { uid: "host", email: "host@example.com", role: "manager" };
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("scrollY", 0);
  vi.stubGlobal("innerHeight", 800);
  vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(2800);
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({ lng: "en-CA", resources: { "en-CA": { common: english } } });
  const { container } = render(<I18nextProvider i18n={i18n}><Header kitchenHostLinks /></I18nextProvider>);
  for (const link of screen.getAllByRole("link", { name: english.managerDashboard })) {
    expect(link).toHaveAttribute("href", "/manager/dashboard");
  }
  fireEvent.keyDown(screen.getByRole("button", { name: english.accountMenu }), { key: "ArrowDown" });
  await screen.findByRole("menu");
  vi.stubGlobal("scrollY", 400);
  fireEvent.scroll(window);
  expect(container.querySelector("header")).toHaveAttribute("data-scroll-hidden", "false");
});
