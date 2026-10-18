import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@shared/i18n/locales/en-CA/admin.json";
import { KitchenChangeRecovery, type KitchenChangeOpen } from "./KitchenChangeRecovery";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en-CA", resolvedLanguage: "en-CA" },
    t: (key: string, options?: Record<string, unknown>) => {
      const raw = (en as Record<string, string>)[key] ?? (typeof options === "object" ? String(options?.defaultValue ?? key) : key);
      return Object.entries(typeof options === "object" ? options ?? {} : {}).reduce(
        (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), raw,
      );
    },
  }),
}));

const schedule = (date: string, start: string, end: string) => ({
  date, windowStart: start, slots: [{ startTime: start, endTime: end }],
});

const recoveryChange = {
  id: "chg-recovery-1",
  state: "recovery_required",
  revision: 4,
  original: schedule("2026-10-20", "14:00", "16:00"),
  destination: schedule("2026-10-20", "08:00", "10:00"),
  money: { oldTotalCents: 6100, newTotalCents: 9150, payCents: 3050, refundCents: 0, feeKeptCents: 0, currency: "CAD", lines: [] },
  steps: [{ state: "recovery_required", message: "The booking could not be moved after the extra charge was captured.", at: "2026-10-16T12:00:00.000Z" }],
};

let fetcher: ReturnType<typeof vi.fn>;

function mount(open: KitchenChangeOpen = recoveryChange) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/changes") && (!init || !init.method || init.method === "GET")) {
      return { ok: true, json: async () => ({ open, timezone: "America/St_Johns" }) };
    }
    return { ok: true, json: async () => ({ change: { ...open, state: "applied" } }) };
  });
  render(
    <QueryClientProvider client={client}>
      <KitchenChangeRecovery bookingId={197} getFirebaseToken={async () => "token"} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("KitchenChangeRecovery", () => {
  it("makes Finish primary and explains the payout hold for dated refund recovery", async () => {
    const dated = { version: 'days-v1' as const, days: [{ ...schedule('2026-10-20', '14:00', '16:00'), pricingMode: 'hourly' as const, equipmentIds: [] }] };
    mount({ ...recoveryChange, original: dated, destination: dated,
      money: { ...recoveryChange.money, payCents: 0, refundCents: 31969 } });
    await screen.findByTestId('kitchen-change-recovery');
    expect(screen.getByTestId('change-recovery-finish')).toHaveClass('bg-[#E10939]');
    expect(screen.getByTestId('change-recovery-close_keep_refund')).not.toHaveClass('bg-[#E10939]');
    expect(screen.getByText(en.bsChangeDatedKeepRefundHold)).toBeVisible();
  });

  it("renders the three recovery actions for a recovery_required change and posts the right body", async () => {
    mount();
    expect(await screen.findByTestId("kitchen-change-recovery")).toBeVisible();
    expect(screen.getByTestId("change-recovery-reason")).toHaveTextContent("could not be moved");
    expect(screen.getByTestId("change-money-moved")).toHaveTextContent("$30.50");

    for (const action of ["finish", "compensate", "close_keep_refund"] as const) {
      expect(screen.getByTestId(`change-recovery-${action}`)).toBeVisible();
    }

    fireEvent.click(screen.getByTestId("change-recovery-finish"));
    expect(await screen.findByTestId("change-recovery-confirm")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: en.bsChangeConfirmDo }));

    await waitFor(() => {
      const post = fetcher.mock.calls.find(([url, init]) =>
        String(url).endsWith("/changes/chg-recovery-1/recovery") && init?.method === "POST");
      expect(post).toBeTruthy();
      expect(JSON.parse(String(post![1].body))).toEqual({ action: "finish", revision: 4 });
    });
  });

  it("does not render when there is no recovery_required change", async () => {
    mount({ ...recoveryChange, state: "requested" });
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(screen.queryByTestId("kitchen-change-recovery")).toBeNull();
  });
});
