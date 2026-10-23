import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, values?: Record<string, unknown>) => values ? `${key}${JSON.stringify(values)}` : key }) }));
import { ExtraTimeDisputes } from "./ExtraTimeDisputes";

const disputed = { id: 25, kind: "extra_time", status: "disputed", minutes: 30, actualMinutes: 21, amountCents: 1526, note: "Closing was delayed.", escalated: true,
  paid: false, upheldAt: null, resolution: { disputeNote: "The door was locked when I arrived.", outcome: null, note: null, originalAmountCents: null } };
const posts: Array<{ url: string; body: any }> = [];
let history: unknown[];
beforeEach(() => {
  posts.length = 0; history = [disputed];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") posts.push({ url, body: JSON.parse(String(init.body)) });
    return { ok: true, json: async () => init?.method === "POST" ? {} : { history } };
  }));
});
afterEach(() => vi.unstubAllGlobals());
const show = () => render(<QueryClientProvider client={new QueryClient()}><ExtraTimeDisputes bookingId={229} currency="CAD" getFirebaseToken={async () => "t"} /></QueryClientProvider>);

describe("extra-time charges waiting on Local Cooks", () => {
  it("shows both notes; reduce needs a lower amount and a note before it sends", async () => {
    show();
    const panel = await screen.findByTestId("extra-time-dispute");
    expect(panel).toHaveTextContent("Closing was delayed.");
    expect(panel).toHaveTextContent("The door was locked when I arrived.");
    fireEvent.click(screen.getByTestId("extra-time-reduced"));
    const confirm = screen.getByRole("button", { name: "bsExtraTimeConfirm" });
    fireEvent.change(screen.getByRole("textbox", { name: /bsExtraTimeAmount/ }), { target: { value: "15.26" } });
    fireEvent.change(screen.getByRole("textbox", { name: "bsExtraTimeNote" }), { target: { value: "Half of the overstay was the kitchen's door." } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: /bsExtraTimeAmount/ }), { target: { value: "7.50" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(posts[0]).toEqual({ url: "/api/admin/bookings/229/extensions/25/resolve",
      body: { outcome: "reduced", amountCents: 750, note: "Half of the overstay was the kitchen's door." } }));
  });
  it("shows nothing once the charge is decided or paid", async () => {
    history = [{ ...disputed, status: "offered", upheldAt: "2026-10-23T01:00:00.000Z" }, { ...disputed, id: 26, status: "paid", paid: true }];
    const { container } = show();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
