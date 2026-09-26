/**
 * RENDER HARNESS — KitchenApplicationCard navigation
 *
 * "View details" is about the chef's APPLICATION, not the kitchen advert. It must open
 * the My Kitchen Applications tab — a local Sheet held a second copy of the details that
 * would drift from the one the chef edits against, and the public preview page answers a
 * different question entirely (what the kitchen looks like, not what was submitted).
 *
 * The card click on the Approved tab deliberately still opens the public preview; only
 * the "View details" button changes.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!("IntersectionObserver" in globalThis)) {
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    };
  }
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

/* The one binding the test asserts on — hoisted so the module mock can capture it. */
const { navigateSpy } = vi.hoisted(() => ({ navigateSpy: vi.fn() }));

vi.mock("wouter", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useLocation: () => ["/dashboard", navigateSpy],
}));

const LABELS: Record<string, string> = { apptabViewDetails: "View details" };
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, second?: unknown) =>
      LABELS[key] ??
      (typeof second === "string" ? second : (second as Record<string, unknown>)?.defaultValue ?? key),
    i18n: { language: "en-CA" },
  }),
}));

/* The image resolver needs no storage in a harness. */
vi.mock("@/components/ui/smart-image", () => ({
  SmartImage: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

import KitchenApplicationCard from "./KitchenApplicationCard";

const app = {
  id: 57,
  createdAt: "2026-09-26T06:48:54.640Z",
  status: "approved",
  current_tier: 2,
  tier1_completed_at: "2026-09-26T06:48:54.640Z",
  tier2_completed_at: "2026-09-26T09:54:43.341Z",
  fullName: "Test Chef",
  email: "chef@example.test",
  foodSafetyLicense: "yes",
  locationId: 17,
  location: { id: 17, name: "Harbour Kitchen Commissary", address: "14 Suez St" },
};

function renderCard() {
  return render(
    <KitchenApplicationCard
      application={app as never}
      kitchenImageUrl={null}
      onBookKitchen={() => {}}
      onDiscoverKitchens={() => {}}
    />,
  );
}

describe("KitchenApplicationCard — View details", () => {
  it("opens the My Kitchen Applications tab", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /view details/i }));

    // The URL carries the target tab…
    expect(navigateSpy).toHaveBeenCalledWith("/dashboard?view=kitchen-requests");
    /*
     * …but a query-only change on the same pathname does not switch the dashboard's
     * tab on its own (its effect depends on the pathname, and its tab sync listens
     * for popstate). The button must fire one, or the chef lands nowhere.
     */
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "popstate" }));

    dispatchSpy.mockRestore();
  });

  it("does not hold the details in a local Sheet any more", () => {
    renderCard();

    // A Sheet would keep a second, drifting copy of the details in the DOM.
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
