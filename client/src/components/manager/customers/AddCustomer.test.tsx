import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));
vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
import { AddCustomer } from "./AddCustomer";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("a one-location kitchen can send once its locations arrive after the form opened (refresh on ?add=1)", () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (locations: { id: number; name: string }[]) =>
    <QueryClientProvider client={client}><AddCustomer locations={locations} defaultLocationId={null} onDone={() => {}} /></QueryClientProvider>;
  const { rerender } = render(view([]));
  fireEvent.change(document.getElementById("ac-name")!, { target: { value: "Jo Invite" } });
  fireEvent.change(document.getElementById("ac-email")!, { target: { value: "jo@example.com" } });
  expect(screen.getByRole("button", { name: "acSend" })).toBeDisabled();
  rerender(view([{ id: 7, name: "Harbour" }]));
  expect(screen.getByRole("button", { name: "acSend" })).toBeEnabled();
});
