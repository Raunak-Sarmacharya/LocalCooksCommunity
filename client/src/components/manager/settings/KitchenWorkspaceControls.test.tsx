import { createRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import KitchenWorkspaceControls from "./KitchenWorkspaceControls";
import type { KitchenPoliciesHandle } from "./KitchenWorkspaceControls";
import { kitchenWorkspaceSettingsKey } from "@/lib/manager-kitchens-navigation";

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiGet: api.get, apiPut: api.put, apiPutWithMessage: api.put }));
vi.mock("@/i18n/manager", () => ({ mt: (key: string, args?: { kitchen?: string }) => args?.kitchen ? `${key}: ${args.kitchen}` : key }));
vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => key }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));
vi.mock("@/hooks/use-presigned-document-url", () => ({
  usePresignedDocumentUrl: () => ({ url: null, isLoading: false, error: null }),
}));

const location = { id: 33, name: "Shared location" };
const defaults = { cancellationPolicyHours: 24, minimumBookingWindowHours: 2, defaultDailyBookingLimit: 8 };
const original = { kitchen: { name: "Prep Kitchen", cancellationPolicyHours: null, minimumBookingWindowHours: null,
  defaultDailyBookingLimit: null, minimumBookingHours: 0, checkinCheckoutEnabled: false },
  effective: defaults, defaults };

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(kitchenWorkspaceSettingsKey(40), original);
  client.setQueryData(kitchenWorkspaceSettingsKey(47), original);
  const ref = createRef<KitchenPoliciesHandle>();
  render(<QueryClientProvider client={client}><KitchenWorkspaceControls kitchenId={40} location={location}
    mode="policies" saveRef={ref} /></QueryClientProvider>);
  return { client, ref };
}

describe("kitchen policy write scope", () => {
  it("highlights the check-in card itself without an outer layout box", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(kitchenWorkspaceSettingsKey(40), original);
    render(<QueryClientProvider client={client}><KitchenWorkspaceControls kitchenId={40} location={location}
      mode="tracking" highlight /></QueryClientProvider>);
    const card = document.getElementById("tracking-settings");
    expect(card).toHaveClass("border-primary/70");
    expect(card?.querySelector('[role="switch"]')).toBeInTheDocument();
    client.clear();
  });

  it("saves a zero cutoff to this kitchen without altering the sibling or location defaults", async () => {
    const { client, ref } = mount();
    api.put.mockResolvedValue({ ...original, kitchen: { ...original.kitchen, cancellationPolicyHours: 0 },
      effective: { ...defaults, cancellationPolicyHours: 0 } });
    fireEvent.change(screen.getByRole("textbox", { name: "cancellationWindow" }), { target: { value: "0" } });
    expect(screen.queryByText("kitchenPolicyPendingOverride")).not.toBeInTheDocument();
    await ref.current!.saveAllChanges("kitchen");
    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/manager/kitchens/40/workspace-settings", { cancellationPolicyHours: 0 }));
    expect(client.getQueryData(kitchenWorkspaceSettingsKey(47))).toEqual(original);
    expect(client.getQueryData<any>(kitchenWorkspaceSettingsKey(40)).defaults).toEqual(defaults);
    client.clear();
  });

  it("clears only the kitchen override when restoring a location default", async () => {
    const { client } = mount();
    client.setQueryData(kitchenWorkspaceSettingsKey(40), { ...original,
      kitchen: { ...original.kitchen, cancellationPolicyHours: 0 }, effective: { ...defaults, cancellationPolicyHours: 0 } });
    api.put.mockResolvedValue(original);
    fireEvent.click(await screen.findByRole("button", { name: "kitchenPolicyReset" }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/manager/kitchens/40/workspace-settings", { cancellationPolicyHours: null }));
    expect(client.getQueryData(kitchenWorkspaceSettingsKey(47))).toEqual(original);
    client.clear();
  });

  it("sends edited rules to the whole location when that scope is chosen", async () => {
    const { client, ref } = mount();
    api.put.mockResolvedValue({ updatedKitchens: 2 });
    api.get.mockResolvedValue(original);
    fireEvent.change(screen.getByRole("textbox", { name: "minimumBookingWindow" }), { target: { value: "3" } });
    expect(await ref.current!.saveAllChanges("location")).toBe(true);
    expect(api.put).toHaveBeenCalledWith("/manager/locations/33/kitchen-booking-policies", { minimumBookingWindowHours: 3 });
    expect(api.put).not.toHaveBeenCalledWith("/manager/kitchens/40/workspace-settings", expect.anything());
    client.clear();
  });

  it("protects other unsaved policy edits before restoring a default", async () => {
    const { client } = mount();
    client.setQueryData(kitchenWorkspaceSettingsKey(40), { ...original,
      kitchen: { ...original.kitchen, cancellationPolicyHours: 0 }, effective: { ...defaults, cancellationPolicyHours: 0 } });
    await screen.findByRole("button", { name: "kitchenPolicyReset" });
    fireEvent.change(screen.getByRole("textbox", { name: "minimumBookingWindow" }), { target: { value: "3" } });
    expect(screen.getByRole("button", { name: "kitchenPolicyReset" })).toBeDisabled();
    expect(screen.getByText("kitchenPolicyResetAfterSave")).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
    client.clear();
  });
});
