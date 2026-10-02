import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import StorageCheckinCheckoutSettings from "./StorageCheckinCheckoutSettings";

const state = vi.hoisted(() => ({ put: vi.fn(), toast: vi.fn() }));
vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => key }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock("@/lib/api", () => ({ apiGet: vi.fn(), apiPut: (...args: unknown[]) => state.put(...args) }));
afterEach(cleanup);

it("edits storage in the booking layout and saves only storage fields with stage and photo requirements preserved", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const item = { id: "shelf", label: "Shelf clean", required: true };
  client.setQueryData(["checkin-checkout-settings", 33], { id: 1, locationId: 33, checkinEnabled: true, storageCheckinEnabled: true, storageCheckoutEnabled: false, storageCheckinItems: [item], storageCheckoutItems: [item], storageCheckinPhotoRequirements: [item], storageCheckoutPhotoRequirements: [], storageCheckinInstructions: null, storageCheckoutInstructions: null });
  const saveRef = createRef<{ saveAllChanges: () => Promise<boolean> }>();
  render(<QueryClientProvider client={client}><StorageCheckinCheckoutSettings location={{ id: 33, name: "Sunlight" }} saveRef={saveRef} /></QueryClientProvider>);
  expect(await screen.findByRole("textbox", { name: "item" })).toHaveValue("Shelf clean");
  expect(screen.getByText("checklistDormantCheckout")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "item" }), { target: { value: "Shelf and floor clean" } });
  await waitFor(() => expect(screen.getByText("unsavedChanges")).toBeInTheDocument());
  await act(async () => { expect(await saveRef.current!.saveAllChanges()).toBe(true); });
  const [path, payload] = state.put.mock.calls[0];
  expect(path).toBe("/manager/locations/33/checkin-checkout-settings");
  expect(payload).not.toHaveProperty("checkinEnabled");
  expect(payload.storageCheckinEnabled).toBe(true);
  expect(payload.storageCheckoutEnabled).toBe(false);
  expect(payload.storageCheckinItems[0].label).toBe("Shelf and floor clean");
  expect(payload.storageCheckinPhotoRequirements[0].id).toBe("shelf");
  expect(payload.storageCheckoutItems[0].id).toBe("shelf");
  client.clear();
});
