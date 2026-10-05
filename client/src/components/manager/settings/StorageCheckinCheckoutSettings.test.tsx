import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import StorageCheckinCheckoutSettings from "./StorageCheckinCheckoutSettings";

const state = vi.hoisted(() => ({ put: vi.fn(), toast: vi.fn() }));
vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => key }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock("@/lib/api", () => ({ apiGet: vi.fn(), apiPut: (...args: unknown[]) => state.put(...args) }));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

it("edits storage in the booking layout and saves only storage fields with stage and photo requirements preserved", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const item = { id: "shelf", label: "Shelf clean", required: true };
  client.setQueryData(["checkin-checkout-settings", 33], { id: 1, locationId: 33, checkinEnabled: true, storageCheckinEnabled: true, storageCheckoutEnabled: false, storageCheckinItems: [item], storageCheckoutItems: [item], storageCheckinPhotoRequirements: [item], storageCheckoutPhotoRequirements: [], storageCheckinInstructions: 'Use the labelled shelf.', storageCheckoutInstructions: 'Remove your belongings.' });
  const saveRef = createRef<{ saveAllChanges: () => Promise<boolean> }>();
  render(<QueryClientProvider client={client}><StorageCheckinCheckoutSettings location={{ id: 33, name: "Sunlight" }} saveRef={saveRef} /></QueryClientProvider>);
  expect(await screen.findByRole("textbox", { name: "item" })).toHaveValue("Shelf clean");
  expect(screen.queryByText("checklistDormantCheckout")).not.toBeInTheDocument();
  expect(screen.getAllByRole('switch')).toHaveLength(1);
  fireEvent.change(screen.getByRole("textbox", { name: "item" }), { target: { value: "Shelf and floor clean" } });
  await waitFor(() => expect(screen.getByText("unsavedChanges")).toBeInTheDocument());
  await act(async () => { expect(await saveRef.current!.saveAllChanges()).toBe(true); });
  const [path, payload] = state.put.mock.calls[0];
  expect(path).toBe("/manager/locations/33/checkin-checkout-settings");
  expect(payload).not.toHaveProperty("checkinEnabled");
  expect(payload.storageCheckinEnabled).toBe(true);
  expect(payload.storageCheckoutEnabled).toBe(true);
  expect(payload.storageCheckinItems[0].label).toBe("Shelf and floor clean");
  expect(payload.storageCheckinPhotoRequirements[0].id).toBe("shelf");
  expect(payload.storageCheckoutItems[0].id).toBe("shelf");
  client.clear();
});

it('requires both notes when enabled, but saves an empty duties checklist', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(['checkin-checkout-settings', 33], { id: 1, storageCheckinEnabled: false, storageCheckoutEnabled: false,
    storageCheckinItems: [], storageCheckoutItems: [], storageCheckinPhotoRequirements: [], storageCheckoutPhotoRequirements: [] });
  const saveRef = createRef<{ saveAllChanges: () => Promise<boolean> }>();
  render(<QueryClientProvider client={client}><StorageCheckinCheckoutSettings location={{ id: 33, name: 'Sunlight' }} saveRef={saveRef} /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('switch'));
  expect(screen.getByRole('textbox', { name: 'arrivalInstructionsTitle' })).toBeRequired();
  await act(async () => { expect(await saveRef.current!.saveAllChanges()).toBe(false); });
  expect(state.put).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox', { name: 'arrivalInstructionsTitle' }), { target: { value: 'Use shelf A.' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'departureInstructionsTitle' }), { target: { value: 'Empty shelf A.' } });
  await act(async () => { expect(await saveRef.current!.saveAllChanges()).toBe(true); });
  expect(state.put).toHaveBeenCalledWith('/manager/locations/33/checkin-checkout-settings', expect.objectContaining({
    storageCheckinEnabled: true, storageCheckoutEnabled: true, storageCheckinInstructions: 'Use shelf A.', storageCheckoutInstructions: 'Empty shelf A.',
    storageCheckinItems: [], storageCheckoutItems: [], storageCheckinPhotoRequirements: [], storageCheckoutPhotoRequirements: [] }));
  client.clear();
});

it('keeps incomplete notes as a draft while storage tracking is off', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(['checkin-checkout-settings', 33], { id: 1, storageCheckinEnabled: false, storageCheckoutEnabled: false,
    storageCheckinItems: [], storageCheckoutItems: [], storageCheckinPhotoRequirements: [], storageCheckoutPhotoRequirements: [] });
  const saveRef = createRef<{ saveAllChanges: () => Promise<boolean> }>();
  render(<QueryClientProvider client={client}><StorageCheckinCheckoutSettings location={{ id: 33, name: 'Sunlight' }} saveRef={saveRef} /></QueryClientProvider>);
  const arrival = await screen.findByRole('textbox', { name: 'arrivalInstructionsTitle' });
  expect(arrival).not.toBeRequired();
  expect(screen.getByText('trackingDisabledHint')).toBeInTheDocument();
  fireEvent.change(arrival, { target: { value: 'Draft arrival instructions.' } });
  await act(async () => { expect(await saveRef.current!.saveAllChanges()).toBe(true); });
  expect(state.put).toHaveBeenCalledWith('/manager/locations/33/checkin-checkout-settings', expect.objectContaining({
    storageCheckinEnabled: false, storageCheckoutEnabled: false, storageCheckinInstructions: 'Draft arrival instructions.', storageCheckoutInstructions: null }));
  client.clear();
});
