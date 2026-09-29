import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The dashboard's kitchen create form, which is the wizard's part 1 in another host.
 *
 * What is under test is the GATE and the PAYLOAD — the two things the old modal got wrong:
 *
 *  - it demanded an hourly rate, so a manager who charges by the day could not create a kitchen
 *    from My Kitchens at all, even though the listing gate's own label is "Hourly or daily rate";
 *  - and it always sent an hourly figure, `Math.round(NaN * 100)`, which `JSON.stringify` turned
 *    into `null` and the endpoint rejected (`null !== undefined`) — so the daily-only manager who
 *    got past the button still could not save.
 *
 * Everything around it is mocked, because none of it is the question: the photo field is the
 * shared, separately-tested one, and the upload and the HTTP call are the boundaries.
 */
const h = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  invalidateQueries: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => key }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useSessionFileUpload", () => ({
  useSessionFileUpload: () => ({ uploadFile: h.uploadFile }),
}));
vi.mock("@/lib/firebase", () => ({
  auth: { currentUser: { getIdToken: async () => "token" } },
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: h.invalidateQueries }),
}));
/*
 * The cover field is the shared one from the Photos tab. Standing it in with a button that hands
 * back a real `File` is what makes the cover settable from a test at all — mocking it to `null`
 * would leave the form permanently incomplete and every assertion vacuous.
 */
vi.mock("@/components/manager/kitchen/KitchenPhotoFields", () => ({
  ACCEPTED_IMAGE_TYPES: ["image/png"],
  CoverPhotoField: ({ onSelectFile }: { onSelectFile: (file: File) => void }) => (
    <button
      type="button"
      onClick={() => onSelectFile(new File(["x"], "cover.png", { type: "image/png" }))}
    >
      pick-cover
    </button>
  ),
}));
/* The real one animates its label per character; the label is all this file reads. */
vi.mock("@/components/ui/status-button", () => ({
  StatusButton: ({ labels, disabled, onClick }: any) => (
    <button type="button" disabled={disabled} onClick={onClick}>{labels?.idle}</button>
  ),
}));

import { KitchenSetupForm } from "./KitchenSetupForm";

const createButton = () => screen.getByRole("button", { name: "createKitchen" });

/**
 * `SettingsRow` renders the required asterisk INSIDE the label, so the label's text is
 * "kitchenName*" — and `getByLabelText` matches on text content, not on the accessible name. Hence
 * a prefix match rather than an equality.
 */
const setField = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(new RegExp(`^${label}`)), { target: { value } });

/**
 * Everything the form requires EXCEPT the rates, so each test chooses those.
 *
 * The cover upload is async, so the click is not enough on its own: the URL lands a tick later and
 * the button only unlocks after it does. The `act` flush is what makes the following assertion
 * meaningful rather than a race.
 */
const fillEssentials = async (rates: { hourly?: string; daily?: string }) => {
  setField("kitchenName", "Harbour Kitchen");
  setField("description", "A bright prep kitchen");
  fireEvent.click(screen.getByRole("button", { name: "pick-cover" }));
  setField("hourlyRateCAD", rates.hourly ?? "");
  setField("dailyRateCAD", rates.daily ?? "");

  await waitFor(() => expect(h.uploadFile).toHaveBeenCalled());
  await act(async () => {});
};

beforeEach(() => {
  h.invalidateQueries = vi.fn();
  h.uploadFile = vi.fn(async () => ({ url: "https://cdn.example.com/cover.png" }));
  h.fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ id: 1, name: "Harbour Kitchen" }),
  }));
  vi.stubGlobal("fetch", h.fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Kitchen create form — the rate rule", () => {
  it("unlocks on an hourly rate alone", async () => {
    render(<KitchenSetupForm locationId={7} />);
    await fillEssentials({ hourly: "25.00" });

    expect(createButton()).toBeEnabled();
  });

  it("unlocks on a DAILY rate alone — the reported bug", async () => {
    render(<KitchenSetupForm locationId={7} />);
    await fillEssentials({ daily: "150.00" });

    expect(createButton()).toBeEnabled();
    // The old modal's own words, which named the hourly and so described a rule the gate does not have.
    expect(screen.queryByText("completeKitchenEssentials")).not.toBeInTheDocument();
  });

  it("unlocks on both, which is a kitchen bookable either way", async () => {
    render(<KitchenSetupForm locationId={7} />);
    await fillEssentials({ hourly: "25.00", daily: "150.00" });

    expect(createButton()).toBeEnabled();
  });

  it("stays locked with neither rate, and says what is missing", async () => {
    render(<KitchenSetupForm locationId={7} />);
    await fillEssentials({});

    expect(createButton()).toBeDisabled();
    expect(screen.getByText("completeKitchenEssentials")).toBeInTheDocument();
  });

  it("does not accept a rate of zero", async () => {
    /*
     * The gate reads a saved 0.00 as "no rate", so a form that treated a typed 0 as set would let
     * through a kitchen the gate then calls unconfigured.
     */
    render(<KitchenSetupForm locationId={7} />);
    await fillEssentials({ hourly: "0" });

    expect(createButton()).toBeDisabled();
  });
});

describe("Kitchen create form — what it sends", () => {
  it("sends a daily-only kitchen WITHOUT a broken hourly rate", async () => {
    render(<KitchenSetupForm locationId={7} />);
    await fillEssentials({ daily: "150.00" });
    fireEvent.click(createButton());

    await waitFor(() => expect(h.fetchMock).toHaveBeenCalled());
    const [url, init] = h.fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));

    expect(url).toBe("/api/manager/kitchens");
    expect(body.locationId).toBe(7);
    expect(body.name).toBe("Harbour Kitchen");
    expect(body.dailyRate).toBe(15000);
    /*
     * The load-bearing assertion. `"hourlyRate" in body` rather than `body.hourlyRate === undefined`,
     * because the difference IS the bug: `undefined` is dropped by `JSON.stringify` and the endpoint
     * treats an absent key as "not priced hourly", while an explicit `null` is a 400.
     */
    expect("hourlyRate" in body).toBe(false);
  });

  it("sends an hourly-only kitchen WITHOUT a daily rate", async () => {
    render(<KitchenSetupForm locationId={7} />);
    await fillEssentials({ hourly: "25.00" });
    fireEvent.click(createButton());

    await waitFor(() => expect(h.fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String((h.fetchMock.mock.calls[0] as [string, RequestInit])[1].body));

    expect(body.hourlyRate).toBe(2500);
    expect("dailyRate" in body).toBe(false);
  });

  it("refreshes BOTH kitchen lists and tells its host the kitchen exists", async () => {
    /*
     * Two lists, because two readers: this page's own query, and the all-kitchens cache the shell's
     * Availability sidebar reads. Invalidating one leaves the other offering a kitchen that is not
     * there.
     */
    const onCreated = vi.fn();
    render(<KitchenSetupForm locationId={7} onCreated={onCreated} />);
    await fillEssentials({ hourly: "25.00" });
    fireEvent.click(createButton());

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const keys = h.invalidateQueries.mock.calls.map(([arg]: any[]) => JSON.stringify(arg.queryKey));
    expect(keys).toContain(JSON.stringify(["managerKitchens", 7]));
    expect(keys).toContain(JSON.stringify(["/api/manager/all-kitchens"]));
  });

  it("does NOT report success when the endpoint refuses", async () => {
    /*
     * The counterpart to the assertion above: the host closes the form on `onCreated`, so a failed
     * write that still reported success would put the manager back on a page with no kitchen on it
     * and only a toast, already fading, to explain.
     */
    const onCreated = vi.fn();
    h.fetchMock = vi.fn(async () => ({ ok: false, json: async () => ({ error: "nope" }) }));
    vi.stubGlobal("fetch", h.fetchMock);

    render(<KitchenSetupForm locationId={7} onCreated={onCreated} />);
    await fillEssentials({ hourly: "25.00" });
    fireEvent.click(createButton());

    await waitFor(() => expect(h.fetchMock).toHaveBeenCalled());
    await act(async () => {});
    expect(onCreated).not.toHaveBeenCalled();
  });
});

describe("Kitchen create form — the way out", () => {
  it("offers Cancel only when there is something to go back to", () => {
    const { unmount } = render(<KitchenSetupForm locationId={7} />);
    // Nothing behind it: a Cancel here would only close a form the manager never opened.
    expect(screen.queryByRole("button", { name: "cancel" })).not.toBeInTheDocument();

    unmount();
    render(<KitchenSetupForm locationId={7} onCancel={vi.fn()} />);
    expect(screen.getByRole("button", { name: "cancel" })).toBeInTheDocument();
  });
});
