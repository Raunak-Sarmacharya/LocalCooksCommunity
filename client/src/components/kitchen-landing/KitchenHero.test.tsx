import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useInView, useReducedMotion } from "framer-motion";
import english from "@shared/i18n/locales/en-CA/kitchen.json";
import french from "@shared/i18n/locales/fr-CA/kitchen.json";
import ukrainian from "@shared/i18n/locales/uk/kitchen.json";
import KitchenHero from "./KitchenHero";
import KitchenOpportunity from "./KitchenOpportunity";
import KitchenGettingStarted from "./KitchenGettingStarted";
import KitchenEarningControl from "./KitchenEarningControl";
import KitchenHostNextSteps, { kitchenHostFaqs } from "./KitchenHostNextSteps";

vi.mock("framer-motion", async importOriginal => ({
  ...await importOriginal<typeof import("framer-motion")>(),
  useInView: vi.fn(() => true),
  useReducedMotion: vi.fn(() => true),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.mocked(useInView).mockReturnValue(true);
  vi.mocked(useReducedMotion).mockReturnValue(true);
});

describe("Kitchen earning and control", () => {
  it("keeps earnings and host decisions together in every locale, with the shared registration action", async () => {
    for (const [locale, copy] of Object.entries({ "en-CA": english, "fr-CA": french, uk: ukrainian })) {
      const i18n = createInstance();
      await i18n.use(initReactI18next).init({ lng: locale, fallbackLng: false, resources: { [locale]: { kitchen: copy } } });
      const onStart = vi.fn();
      const { container } = render(<I18nextProvider i18n={i18n}><KitchenEarningControl onStart={onStart} /></I18nextProvider>);
      expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
      expect(screen.getByText(copy.earnKitchenBody)).toBeVisible();
      expect(screen.getByText(copy.earnStorageBody)).toBeVisible();
      expect(screen.getByText(copy.earnEquipmentBody)).toBeVisible();
      expect(screen.getByText(copy.earnAccessBody)).toBeVisible();
      expect(screen.getByText(copy.earnPoliciesBody)).toBeVisible();
      expect(container.querySelector("#revenue-streams")).toBeTruthy();
      expect(container.querySelector("#everything-included")).toBeTruthy();
      expect(container.textContent).not.toMatch(/earn[A-Z]\w+|heroHost[A-Z]\w+|start[A-Z]\w+/);
      expect(container.textContent).not.toMatch(/three ways|0%|100%|insurance|insured|guaranteed|weekly payout|assurance|страхуван|sample revenue|—/i);
      expect(screen.getAllByRole("button")).toHaveLength(1);
      fireEvent.click(screen.getByRole("button", { name: copy.heroHostStart }));
      expect(onStart).toHaveBeenCalledOnce();
      cleanup();
    }
  });
});

describe("Kitchen host next steps", () => {
  it("uses real destinations and the same translated questions as SEO, with honest answers in every locale", async () => {
    for (const [locale, copy] of Object.entries({ "en-CA": english, "fr-CA": french, uk: ukrainian })) {
      const i18n = createInstance();
      await i18n.use(initReactI18next).init({ lng: locale, fallbackLng: false, resources: { [locale]: { kitchen: copy } } });
      const onStart = vi.fn();
      const { container } = render(<I18nextProvider i18n={i18n}><KitchenHostNextSteps onStart={onStart} /></I18nextProvider>);
      expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(4);
      expect(screen.queryByText(copy.hostGuideNote)).not.toBeInTheDocument();
      for (const link of screen.getAllByRole("link")) expect(link).toHaveAttribute("href", "/resources");
      for (const faq of kitchenHostFaqs) {
        const button = screen.getByRole("button", { name: copy[faq.question] });
        fireEvent.click(button);
        expect(button).toHaveAttribute("aria-expanded", "true");
        expect(screen.getByText(copy[faq.answer])).toBeVisible();
        fireEvent.click(button);
        expect(button).toHaveAttribute("aria-expanded", "false");
      }
      expect(container.textContent).not.toMatch(/host(?:Guide|Support|Faq|Closing)[A-Z]\w+|0%|100%|guaranteed income|full insurance coverage|weekly payout|—/i);
      expect(screen.getByText(copy.hostSupportReviewNote)).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: copy.hostSupportCta }));
      fireEvent.click(screen.getByRole("button", { name: copy.heroHostStart }));
      expect(onStart).toHaveBeenCalledTimes(2);
      cleanup();
    }
  });
});

describe("Kitchen getting started", () => {
  it("shows the real hosting tools in every locale without a repeated CTA or payment footer", async () => {
    for (const [locale, copy] of Object.entries({ "en-CA": english, "fr-CA": french, uk: ukrainian })) {
      const i18n = createInstance();
      await i18n.use(initReactI18next).init({ lng: locale, fallbackLng: false, resources: { [locale]: { kitchen: copy } } });
      const { container } = render(<I18nextProvider i18n={i18n}><KitchenGettingStarted /></I18nextProvider>);
      expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
      expect(screen.getAllByRole("button")).toHaveLength(3);
      const stages = [
        [copy.startListingTitle, copy.startListingPreview, [copy.startKitchenLicence, copy.startKitchenTour]],
        [copy.startPreferencesTitle, copy.startPreferencesPreview, [copy.startConnected, copy.startBookingPolicies]],
        [copy.startAccessTitle, copy.startAccessPreview, [copy.heroHostApplication, copy.startDamageClaims, copy.startStorageOverstay]],
      ];
      for (const [title, label, previewTexts] of stages as [string, string, string[]][]) {
        const button = screen.getByText(title).closest("button")!;
        fireEvent.click(button);
        expect(button).toHaveAttribute("aria-current", "step");
        await waitFor(() => { for (const text of previewTexts) expect(screen.getByRole("region", { name: label })).toHaveTextContent(text); });
        expect(container.textContent).not.toContain(copy.heroHostStripe);
        expect(container.textContent).not.toMatch(/start[A-Z]\w+|heroHost[A-Z]\w+/);
        expect(container.textContent).not.toMatch(/0%|100%|insurance|insured|guaranteed|24 hrs|15 minutes|weekly payout|assurance|страхуван|—/i);
      }
      expect(container.querySelector<HTMLElement>(".kitchen-walkthrough-progress")!.style.animationName).toBe("none");
      expect(screen.queryByRole("button", { name: copy.heroHostStart })).not.toBeInTheDocument();
      cleanup();
    }
  });

  it("keeps the progress indicator and selected step in sync, pausing without restarting on interaction", async () => {
    const i18n = createInstance();
    await i18n.use(initReactI18next).init({ lng: "en-CA", resources: { "en-CA": { kitchen: english } } });
    vi.mocked(useReducedMotion).mockReturnValue(false);
    const ui = <I18nextProvider i18n={i18n}><KitchenGettingStarted /></I18nextProvider>;
    const { container, rerender } = render(ui);
    const wrapper = container.querySelector("ol")!.parentElement!.parentElement!;
    const progress = () => container.querySelector<HTMLElement>(".kitchen-walkthrough-progress")!;
    expect(progress().style.animationPlayState).toBe("running");
    expect(progress().style.animationDuration).toBe("8000ms");
    fireEvent.animationEnd(progress());
    const secondStep = screen.getByText(english.startPreferencesTitle).closest("button")!;
    expect(secondStep).toHaveAttribute("aria-current", "step");
    const pausedIndicator = progress();
    fireEvent.mouseEnter(wrapper);
    expect(progress().style.animationPlayState).toBe("paused");
    fireEvent.animationEnd(progress());
    expect(secondStep).toHaveAttribute("aria-current", "step");
    fireEvent.mouseLeave(wrapper);
    expect(progress()).toBe(pausedIndicator);
    expect(progress().style.animationPlayState).toBe("running");
    fireEvent.focus(secondStep);
    expect(progress().style.animationPlayState).toBe("paused");
    fireEvent.animationEnd(progress());
    expect(secondStep).toHaveAttribute("aria-current", "step");
    fireEvent.blur(secondStep);
    fireEvent.animationEnd(progress());
    expect(screen.getByText(english.startAccessTitle).closest("button")).toHaveAttribute("aria-current", "step");
    vi.mocked(useInView).mockReturnValue(false);
    rerender(<I18nextProvider i18n={i18n}><KitchenGettingStarted /></I18nextProvider>);
    expect(progress().style.animationPlayState).toBe("paused");
    fireEvent.animationEnd(progress());
    expect(screen.getByText(english.startAccessTitle).closest("button")).toHaveAttribute("aria-current", "step");
    vi.mocked(useReducedMotion).mockReturnValue(true);
    rerender(<I18nextProvider i18n={i18n}><KitchenGettingStarted /></I18nextProvider>);
    expect(progress().style.animationName).toBe("none");
  });
});

describe("Kitchen hero", () => {
  it("explains the offer in every locale and activates both real actions without coverage or fee promises", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addListener: vi.fn(), removeListener: vi.fn() }));
    for (const [locale, copy] of Object.entries({ "en-CA": english, "fr-CA": french, uk: ukrainian })) {
      const i18n = createInstance();
      await i18n.use(initReactI18next).init({ lng: locale, fallbackLng: false, resources: { [locale]: { kitchen: copy } } });
      const onStart = vi.fn();
      const onHowItWorks = vi.fn();
      const { container } = render(<I18nextProvider i18n={i18n}><KitchenHero onStart={onStart} onHowItWorks={onHowItWorks} /></I18nextProvider>);
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(screen.getByText(copy.heroPlacesOfWorship)).toBeVisible();
      expect(screen.getByText(copy.heroNonprofits)).toBeVisible();
      expect(screen.getByText(copy.heroHostRevenue)).toBeVisible();
      expect(screen.queryByText(copy.heroHostIncomeSources)).not.toBeInTheDocument();
      expect(screen.getByText(copy.heroHostActivityCentre)).toBeVisible();
      expect(screen.getByText(copy.startKitchenTour)).toBeVisible();
      expect(screen.getByText(copy.heroHostExtrasBooking)).toBeVisible();
      expect(screen.getByText(copy.startDamageClaims)).toBeVisible();
      expect(within(screen.getByText(copy.startDamageClaims).closest("li")!).getByText(copy.heroHostUnderReview)).toBeVisible();
      expect(screen.getByText(copy.heroHostApprovalNote)).toBeVisible();
      expect(container.querySelector("figure")).not.toHaveTextContent(copy.heroHostStripe);
      expect(screen.getByText(copy.heroHostStripe)).toBeVisible();
      expect(screen.getAllByRole("button")).toHaveLength(2);
      expect(container.textContent).not.toMatch(/heroHost\w+|hero(?:Restaurants|Community|Places|Nonprofits|Shared|Kitchen|Storage|Equipment|Monday|Tuesday|Wednesday|Thursday|Friday)\w*/);
      expect(container.textContent).not.toMatch(/0%|100%|insurance|insured|coverage|guaranteed|assurance|страхуван|sample revenue|illustrative dashboard|sample activity/i);
      fireEvent.click(screen.getByRole("button", { name: copy.heroHostStart }));
      fireEvent.click(screen.getByRole("button", { name: copy.heroHostHow }));
      expect(onStart).toHaveBeenCalledOnce();
      expect(onHowItWorks).toHaveBeenCalledOnce();
      cleanup();
    }
  });
});

describe("Kitchen opportunity", () => {
  it("shows the right story for every kitchen type and sends each CTA to the shared start action", async () => {
    for (const [locale, copy] of Object.entries({ "en-CA": english, "fr-CA": french, uk: ukrainian })) {
      const i18n = createInstance();
      await i18n.use(initReactI18next).init({ lng: locale, fallbackLng: false, resources: { [locale]: { kitchen: copy } } });
      const onStart = vi.fn();
      const { container } = render(<I18nextProvider i18n={i18n}><KitchenOpportunity onStart={onStart} /></I18nextProvider>);
      const types = [
        [copy.heroRestaurants, copy.opportunityRestaurantHeading, "Restaurant_and_cafe.webp"],
        [copy.heroCommunityCentres, copy.opportunityCommunityHeading, "Community_centres.webp"],
        [copy.heroPlacesOfWorship, copy.opportunityWorshipHeading, "Places_of_worship.webp"],
        [copy.heroNonprofits, copy.opportunityNonprofitHeading, "Nonprofits.webp"],
        [copy.heroSharedKitchens, copy.opportunitySharedHeading, "Shared_kitchens.webp"],
      ];
      const images = [...container.querySelectorAll("img")];
      expect(images).toHaveLength(5);
      fireEvent.mouseDown(screen.getByRole("tab", { name: copy.heroCommunityCentres }), { button: 0, ctrlKey: false });
      expect(screen.getByRole("img")).toHaveAttribute("src", expect.stringContaining("Restaurant_and_cafe.webp"));
      fireEvent.load(images[1]);
      await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("src", expect.stringContaining("Community_centres.webp")));
      images.forEach(image => fireEvent.load(image));
      expect(screen.getAllByRole("tab")).toHaveLength(5);
      for (const [label, heading, image] of types) {
        const tab = screen.getByRole("tab", { name: label });
        fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
        expect(tab).toHaveAttribute("aria-selected", "true");
        expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
        await waitFor(() => expect(screen.getByRole("heading", { name: heading })).toBeVisible());
        expect(screen.getByRole("img")).toHaveAttribute("src", expect.stringContaining(image));
        fireEvent.click(screen.getByRole("button", { name: copy.heroHostStart }));
      }
      expect(onStart).toHaveBeenCalledTimes(5);
      expect(container.textContent).not.toMatch(/opportunity[A-Z]\w+|40%|85%|\$500|0%|insurance|guaranteed|—/i);
      cleanup();
    }
  });

  it("cycles while visible, pauses during interaction, and resumes without preview controls", async () => {
    const i18n = createInstance();
    await i18n.use(initReactI18next).init({ lng: "en-CA", resources: { "en-CA": { kitchen: english } } });
    vi.mocked(useReducedMotion).mockReturnValue(false);
    const ui = <I18nextProvider i18n={i18n}><KitchenOpportunity onStart={vi.fn()} /></I18nextProvider>;
    const { container, rerender } = render(ui);
    container.querySelectorAll("img").forEach(image => fireEvent.load(image));
    expect(screen.getAllByRole("button")).toHaveLength(1);
    const carousel = container.querySelector('[role="tablist"]')!.parentElement!.parentElement!;
    const progress = () => container.querySelector<HTMLElement>(".kitchen-opportunity-progress")!;
    const finishCycle = () => fireEvent.animationEnd(progress());
    expect(progress().style.animationDuration).toBe("8000ms");
    expect(progress().style.animationPlayState).toBe("running");
    finishCycle();
    expect(screen.getByRole("tab", { name: english.heroCommunityCentres })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("img")).toHaveAttribute("src", expect.stringContaining("Community_centres.webp"));
    fireEvent.mouseEnter(carousel);
    expect(progress().style.animationPlayState).toBe("paused");
    finishCycle();
    expect(screen.getByRole("tab", { name: english.heroCommunityCentres })).toHaveAttribute("aria-selected", "true");
    fireEvent.mouseLeave(carousel);
    finishCycle();
    expect(screen.getByRole("tab", { name: english.heroPlacesOfWorship })).toHaveAttribute("aria-selected", "true");
    fireEvent.focus(screen.getByRole("button", { name: english.heroHostStart }));
    expect(progress().style.animationPlayState).toBe("paused");
    finishCycle();
    expect(screen.getByRole("tab", { name: english.heroPlacesOfWorship })).toHaveAttribute("aria-selected", "true");
    fireEvent.blur(screen.getByRole("button", { name: english.heroHostStart }));
    vi.mocked(useInView).mockReturnValue(false);
    rerender(<I18nextProvider i18n={i18n}><KitchenOpportunity onStart={vi.fn()} /></I18nextProvider>);
    expect(progress().style.animationPlayState).toBe("paused");
    finishCycle();
    expect(screen.getByRole("tab", { name: english.heroPlacesOfWorship })).toHaveAttribute("aria-selected", "true");
    vi.mocked(useInView).mockReturnValue(true);
    rerender(<I18nextProvider i18n={i18n}><KitchenOpportunity onStart={vi.fn()} /></I18nextProvider>);
    const sharedTab = screen.getByRole("tab", { name: english.heroSharedKitchens });
    fireEvent.mouseEnter(carousel);
    fireEvent.mouseDown(sharedTab, { button: 0 });
    fireEvent.focus(sharedTab);
    expect(progress().style.animationPlayState).toBe("paused");
    finishCycle();
    expect(screen.getByRole("tab", { name: english.heroSharedKitchens })).toHaveAttribute("aria-selected", "true");
    fireEvent.mouseLeave(carousel);
    expect(progress().style.animationPlayState).toBe("paused");
    finishCycle();
    expect(sharedTab).toHaveAttribute("aria-selected", "true");
    fireEvent.blur(sharedTab);
    finishCycle();
    expect(screen.getByRole("tab", { name: english.heroRestaurants })).toHaveAttribute("aria-selected", "true");
    vi.mocked(useReducedMotion).mockReturnValue(true);
    rerender(<I18nextProvider i18n={i18n}><KitchenOpportunity onStart={vi.fn()} /></I18nextProvider>);
    expect(progress().style.animationPlayState).toBe("paused");
    finishCycle();
    expect(progress().style.animationName).toBe("none");
    expect(screen.getByRole("tab", { name: english.heroRestaurants })).toHaveAttribute("aria-selected", "true");
  });
});
