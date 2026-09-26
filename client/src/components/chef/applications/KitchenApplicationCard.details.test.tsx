/**
 * RENDER HARNESS — KitchenApplicationDetails (chef's own application details)
 *
 * Why this file exists.
 *
 * This is the only view where a chef reads back what they submitted. It rendered the two
 * certificate COLUMNS (food safety, food establishment) but nothing from
 * `tier_data.tierFiles`, so the insurance document a chef uploaded was stored, shown to
 * the manager, and invisible to the chef who uploaded it. Real data confirmed the gap:
 * application 57 (chef 325, location 17) holds
 * `tier_data.tierFiles.tier2_insurance_document` = a real PDF URL, and the details view
 * showed no trace of it.
 *
 * The rule being pinned: every document the chef uploaded must be visible and openable in
 * their own details view — including the ones stored outside a column.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import React from "react";

/* jsdom lacks the observer APIs the Radix primitives reach for on mount. */
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

/* `t` accepts either a string fallback or a `{ defaultValue }` bag, exactly as the component calls it. */
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, second?: unknown) => {
      if (typeof second === "string") return second;
      if (second && typeof second === "object" && "defaultValue" in (second as Record<string, unknown>)) {
        return String((second as Record<string, unknown>).defaultValue);
      }
      return key;
    },
    i18n: { language: "en-CA" },
  }),
}));

/* Keep the harness offline: the real hook signs the URL with a network call. */
vi.mock("@/hooks/use-presigned-document-url", () => ({
  usePresignedDocumentUrl: (url: string | null | undefined) => ({
    url: url ?? null,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));

import { KitchenApplicationDetails } from "./KitchenApplicationCard";

const INSURANCE_URL = "https://files.localcooks.ca/documents/325_insurance.pdf";

function makeApp(tierFiles: Record<string, string>) {
  return {
    id: 57,
    createdAt: "2026-09-26T06:48:54.640Z",
    status: "approved",
    current_tier: 2,
    tier1_completed_at: "2026-09-26T06:48:54.640Z",
    tier2_completed_at: "2026-09-26T09:54:43.341Z",
    fullName: "Test Chef",
    email: "chef@example.test",
    phone: "555-0100",
    foodSafetyLicense: "yes",
    foodSafetyLicenseUrl: "https://files.localcooks.ca/documents/safety.pdf",
    foodSafetyLicenseStatus: "approved",
    foodSafetyLicenseExpiry: "2099-12-31",
    foodEstablishmentCertUrl: "https://files.localcooks.ca/documents/establishment.pdf",
    foodEstablishmentCertStatus: "pending",
    locationId: 17,
    location: { id: 17, name: "Harbour Kitchen Commissary", address: "14 Suez St" },
    tier_data: { tier2: {}, tierFiles, tier2_custom_fields_data: {} },
  };
}

const display = {
  label: "Approved",
  stepCaption: "Chef Application Requirements",
  tone: "success",
  actionKind: "book",
} as unknown as Parameters<typeof KitchenApplicationDetails>[0]["display"];

function renderDetails(tierFiles: Record<string, string>) {
  return render(
    <KitchenApplicationDetails
      app={makeApp(tierFiles) as never}
      display={display}
      onBookKitchen={() => {}}
    />,
  );
}

describe("KitchenApplicationDetails — documents the chef uploaded", () => {
  it("shows the insurance document stored in tier_data.tierFiles", () => {
    renderDetails({ tier2_insurance_document: INSURANCE_URL });

    // The name appears twice on purpose — the row's heading and the link's file name.
    const label = screen.getAllByText(/insurance document/i)[0];
    // It must be openable, not just named.
    const card = label.closest("div.rounded-xl") as HTMLElement;
    expect(within(card).getByRole("link")).toHaveAttribute("href", INSURANCE_URL);
  });

  it("humanises an unrecognised tier-file key instead of printing the raw identifier", () => {
    renderDetails({ tier3_cleaning_schedule: "https://files.localcooks.ca/cleaning.pdf" });

    const card = screen.getAllByText(/cleaning schedule/i)[0].closest("div.rounded-xl") as HTMLElement;
    expect(within(card).getByRole("link")).toHaveAttribute(
      "href",
      "https://files.localcooks.ca/cleaning.pdf",
    );
    expect(screen.queryByText(/tier3_cleaning_schedule/)).toBeNull();
  });

  it("renders no tier-file row when nothing is stored", () => {
    renderDetails({});

    expect(screen.queryByText(/insurance document/i)).toBeNull();
  });
});
