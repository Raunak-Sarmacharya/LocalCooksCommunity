import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StorageTrackingSetup } from "./StorageTrackingSetup";

const state = vi.hoisted(() => ({ settings: {} as Record<string, unknown>, put: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiGet: async () => structuredClone(state.settings), apiPut: (...args: unknown[]) => state.put(...args) }));
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: { uid: "manager-a" } } }));
vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: state.toast }) }));

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear(); state.put.mockReset(); state.toast.mockReset();
  state.settings = { storageCheckinEnabled: false, storageCheckoutEnabled: false, storageCheckinItems: [], storageCheckoutItems: [], storageCheckinPhotoRequirements: [], storageCheckoutPhotoRequirements: [], storageCheckinInstructions: 'Use the marked shelf.', storageCheckoutInstructions: 'Remove all items.' };
  state.put.mockImplementation(async (_path, patch) => { state.settings = { ...state.settings, ...patch }; });
});
afterEach(cleanup);
const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const configure = vi.fn();
  const page = render(<QueryClientProvider client={client}><StorageTrackingSetup locationId={33} onConfigure={configure} /></QueryClientProvider>);
  return { ...page, client, configure };
};

it("edits and saves the shared instructions without changing optional tasks or kitchen settings", async () => {
  const page = mount();
  fireEvent.change(await screen.findByRole("textbox", { name: "slMoveInInstructions" }), { target: { value: "Use shelf B" } });
  fireEvent.click(screen.getByRole("button", { name: "saveChanges" }));
  await waitFor(() => expect(state.put).toHaveBeenCalledWith("/manager/locations/33/checkin-checkout-settings", {
    storageCheckinInstructions: "Use shelf B", storageCheckoutInstructions: "Remove all items.",
  }));
  expect(state.settings.storageCheckinEnabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "slOptionalChecklist" }));
  expect(page.configure).toHaveBeenCalledOnce();
  page.client.clear();
});
it("requires both instructions and retains the draft after a failed save", async () => {
  state.put.mockRejectedValue(new Error("Unable to save"));
  const page = mount();
  fireEvent.change(await screen.findByRole("textbox", { name: "slMoveOutInstructions" }), { target: { value: " " } });
  expect(screen.getByRole("button", { name: "saveChanges" })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "slMoveOutInstructions" }), { target: { value: "Empty shelf B" } });
  fireEvent.click(screen.getByRole("button", { name: "saveChanges" }));
  await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "Unable to save", variant: "destructive" })));
  expect(screen.getByRole("textbox", { name: "slMoveOutInstructions" })).toHaveValue("Empty shelf B");
  page.client.clear();
});
