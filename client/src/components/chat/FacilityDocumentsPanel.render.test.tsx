/**
 * REGRESSION HARNESS — FacilityDocumentsPanel
 *
 * Why this file exists.
 *
 * The panel reads three things: the location the chef's application belongs to,
 * the kitchen's own facility documents for that location, and the chef's
 * application documents.
 *
 * Two bugs made the panel show nothing for a chef whose application was
 * perfectly valid:
 *
 *  1. The application list endpoint only returns applications that are already
 *     approved or past tier 1 (`chefApplicationService.getApplicationsByLocation`).
 *     The panel treated a chef missing from that list as a hard failure and threw,
 *     which replaced the whole panel — including the facility documents that had
 *     loaded fine — with a red "Failed to load documents".
 *
 *  2. The panel trusted the chat conversation's own `locationId`. One real thread
 *     pointed at a location id that no longer existed, so both queries 403'd and
 *     the panel reported a failure even though the application sat on a valid
 *     location. The location is now resolved from the application instead.
 *
 * These tests drive the real component through a real QueryClient and a mocked
 * `fetch`, so the actual `queryFn`s run. Mocking `useQuery` instead would skip
 * the very branches under test.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import FacilityDocumentsPanel from "./FacilityDocumentsPanel";

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
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
});

vi.mock("@/lib/firebase", () => ({
  auth: { currentUser: { getIdToken: async () => "test-token" } },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: () => {} }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

/** Minimal stand-in for a fetch Response. */
function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

/**
 * Point `fetch` at the three endpoints the panel reads. `applications` is the
 * manager-scoped list, which omits not-yet-approved chefs.
 */
function mockEndpoints(options: {
  facility: () => Response;
  applications: () => Response;
  applicationLocation?: () => Response;
}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/location")) {
      return (options.applicationLocation ?? (() => jsonResponse({ locationId: 17 })))();
    }
    if (url.includes("/kitchen-applications/location/")) return options.applications();
    if (url.includes("/requirements")) return options.facility();
    throw new Error(`Unexpected fetch in test: ${url}`);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function renderPanel(locationId = 17) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <FacilityDocumentsPanel
        locationId={locationId}
        applicationId={42}
        onAttachDocuments={() => {}}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FacilityDocumentsPanel", () => {
  it("does not report a failure when the chef is not in the manager's application list", async () => {
    // Chef awaiting approval -> empty application list.
    mockEndpoints({
      facility: () => jsonResponse({}),
      applications: () => jsonResponse([]),
    });

    renderPanel();

    expect(
      await screen.findByText(/No documents uploaded for this application or kitchen/i),
    ).toBeTruthy();
    expect(screen.queryByText(/Failed to load documents/i)).toBeNull();
  });

  it("uses the application's location when the conversation's locationId is stale", async () => {
    // The reported bug: the thread carried locationId 84, which does not exist.
    // The application says 17, and that is where the facility documents live.
    const fetchMock = mockEndpoints({
      applicationLocation: () => jsonResponse({ locationId: 17 }),
      facility: () =>
        jsonResponse({
          kitchen_license_url: "https://files.localcooks.ca/documents/license.pdf",
          floor_plans_url: "https://files.localcooks.ca/documents/plans.pdf",
        }),
      applications: () => jsonResponse([]),
    });

    renderPanel(84);

    // The count badge renders outside the collapsed content, so this proves the
    // facility documents were fetched from the resolved location.
    expect(await screen.findByText("2")).toBeTruthy();
    expect(screen.queryByText(/Failed to load documents/i)).toBeNull();

    const requested = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(requested).toContain("/api/manager/locations/17/requirements");
    expect(requested.some((u) => u.includes("/locations/84/"))).toBe(false);
  });

  it("still lists the kitchen's facility documents when the application is missing", async () => {
    mockEndpoints({
      facility: () =>
        jsonResponse({
          kitchen_license_url: "https://files.localcooks.ca/documents/license.pdf",
          floor_plans_url: "https://files.localcooks.ca/documents/plans.pdf",
        }),
      applications: () => jsonResponse([]),
    });

    renderPanel();

    expect(await screen.findByText("2")).toBeTruthy();
    expect(screen.queryByText(/Failed to load documents/i)).toBeNull();
  });

  it("still reports a real failure when the facility documents cannot be fetched", async () => {
    mockEndpoints({
      facility: () => jsonResponse({ error: "boom" }, false),
      applications: () => jsonResponse([]),
    });

    renderPanel();

    expect(await screen.findByText(/Failed to load documents/i)).toBeTruthy();
  });
});
