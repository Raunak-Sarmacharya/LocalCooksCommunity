/**
 * REGRESSION HARNESS — NotificationCenter
 *
 * Why this file exists.
 *
 * The admin portal used to carry its own 81-line notification popover while the
 * manager and chef portals had ~900-line centres with filter tabs, time
 * grouping, mark-all-read, archive and delete. The admin bell is now this same
 * component pointed at `/api/admin/notifications` through the `endpoint` prop,
 * so all three portals share one implementation.
 *
 * That parameterisation is load-bearing: every URL in the component is built
 * from `endpoint`, so getting it wrong breaks the bell for all three portals at
 * once. The first attempt rewrote the prop's own default value into
 * `endpoint = `${api}`` — a self-reference that throws a TDZ `ReferenceError` the
 * moment the component renders. **esbuild compiled it without complaint and the
 * whole suite stayed green, because nothing rendered this component.** Only a
 * render harness catches that class of bug, hence this file.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import NotificationCenter from "./NotificationCenter";

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
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

vi.mock("@/lib/firebase", () => ({
  auth: { currentUser: { uid: 'manager-1', getIdToken: async () => "test-token" } },
}));

vi.mock("@/hooks/use-auth", () => ({
  useFirebaseAuth: () => ({ user: { uid: 'manager-1' }, loading: false }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: () => {} }),
  toast: () => {},
}));

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

let requested: string[] = [];
let kitchenAccessAlert = false;

function stubFetch() {
  requested = [];
  globalThis.fetch = vi.fn(async (input: unknown) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("/unread-count")) return json({ count: 2 });
    if (url.includes("filter=")) {
      return json({
        notifications: [
          {
            id: 1,
            manager_id: 1,
            location_id: null,
            type: "application_new",
            priority: "high",
            title: kitchenAccessAlert ? "Chef Application Requirements Submitted" : "Seller application awaiting review",
            message: kitchenAccessAlert ? "A chef submitted their Chef Application Requirements." : "A chef submitted a seller application.",
            metadata: kitchenAccessAlert ? { chefName: "Mina", chefEmail: "mina@example.com", applicationId: 7, step: 2 } : {},
            is_read: false,
            read_at: null,
            is_archived: false,
            archived_at: null,
            action_url: kitchenAccessAlert ? "/manager/dashboard?view=applications" : "/admin?section=applications",
            action_label: "Review application",
            created_at: new Date().toISOString(),
            expires_at: null,
          },
        ],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasMore: false },
      });
    }
    return json({ updated: 1 });
  }) as unknown as typeof fetch;
}

function renderCenter(props: Record<string, unknown> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <NotificationCenter {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  kitchenAccessAlert = false;
  stubFetch();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NotificationCenter endpoint parameterisation", () => {
  it("displays saved kitchen application alerts as access requests", async () => {
    kitchenAccessAlert = true;
    const { getByRole } = renderCenter();
    const trigger = getByRole("button", { name: /notifications/i });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    expect(await screen.findByText("Kitchen Access Documents Submitted")).toBeInTheDocument();
    expect(screen.getByText(/Mina \(mina@example.com\) submitted kitchen access documents/)).toBeInTheDocument();
    expect(screen.queryByText("Chef Application Requirements Submitted")).not.toBeInTheDocument();
  });
  it("renders the bell and defaults to the manager endpoints", async () => {
    renderCenter();
    expect(screen.getByRole("button", { name: /notifications/i })).toBeInTheDocument();
    await waitFor(() =>
      expect(requested.some((u) => u.startsWith("/api/manager/notifications/unread-count"))).toBe(true),
    );
  });

  it("uses the admin endpoints when the admin portal passes them", async () => {
    renderCenter({ endpoint: "/api/admin/notifications", linkRole: null });
    await waitFor(() =>
      expect(requested.some((u) => u.startsWith("/api/admin/notifications/unread-count"))).toBe(true),
    );
    // And it must not have leaked a request to the manager endpoints.
    expect(requested.some((u) => u.startsWith("/api/manager/notifications"))).toBe(false);
  });

  it("shows the unread badge from the count endpoint", async () => {
    renderCenter();
    expect(await screen.findByText("2")).toBeInTheDocument();
  });

  it("lists notifications when the popover opens", async () => {
    const { getByRole } = renderCenter();
    const trigger = getByRole("button", { name: /notifications/i });
    // Radix's PopoverTrigger toggles on pointerdown, not click - a bare click()
    // leaves the popover shut and the assertion below would fail for the wrong reason.
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    expect(await screen.findByText("Seller application awaiting review")).toBeInTheDocument();
    expect(requested.some((u) => u.includes("filter="))).toBe(true);
  });
});
