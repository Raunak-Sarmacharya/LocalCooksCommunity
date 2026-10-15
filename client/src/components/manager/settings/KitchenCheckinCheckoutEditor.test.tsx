import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { KitchenCheckinCheckoutEditor, findUnifiedItemProblems, itemsToStorage, unifyStorageToItems, type UnifiedChecklistItem } from "./KitchenCheckinCheckoutEditor";

vi.mock("@/i18n/manager", () => ({ mt: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }));
vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => key }));
vi.mock("@/lib/setting-impact", () => ({ useSettingImpact: () => ({ impact: { upcoming: 3, inSession: 0, pending: 0 } }) }));
afterEach(cleanup);
function Editor({ coupled = false, kitchen = false, initial = [], onChange = () => {} }: {
  coupled?: boolean; kitchen?: boolean; initial?: UnifiedChecklistItem[]; onChange?: (items: UnifiedChecklistItem[]) => void;
}) {
  const [items, setItems] = useState(initial);
  const [arrival, setArrival] = useState<string | null>("Main door.");
  const [departure, setDeparture] = useState<string | null>("Lock up.");
  return <KitchenCheckinCheckoutEditor coupledStages={coupled} setupLocationName={kitchen ? "Sunlight" : undefined}
    items={items} onItemsChange={next => { setItems(next); onChange(next); }}
    checkinEnabled onCheckinEnabledChange={() => {}} checkoutEnabled onCheckoutEnabledChange={() => {}}
    checkinInstructions={arrival} onCheckinInstructionsChange={setArrival}
    checkoutInstructions={departure} onCheckoutInstructionsChange={setDeparture}
    onFlowToggleClick={() => {}} onFlowToggleMouseDown={() => {}} onFlowToggleKeyDown={() => {}} />;
}

it("preserves the non-coupled storage review dialog and its close action", () => {
  render(<Editor />);
  expect(screen.queryByRole("region", { name: "At check-in (arrival)" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "reviewCheckinCta" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(within(screen.getByRole("dialog")).getByText("Main door.")).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("keeps the current coupled storage panel out of kitchen setup copy and inline preview", () => {
  render(<Editor coupled />);
  expect(screen.getByRole("textbox", { name: "arrivalInstructionsTitle" })).toBeRequired();
  expect(screen.queryByRole("region", { name: "At check-in (arrival)" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Arrival and departure instructions" })).not.toBeInTheDocument();
  expect(screen.getAllByText("storageTrackingOptionalDuties")).toHaveLength(2);
});

it("validates unassigned and whitespace tasks", () => {
  const item: UnifiedChecklistItem = { id: "a", label: "Task", requiredOnCheckin: false, requiredOnCheckout: false, photoRequired: false };
  expect(findUnifiedItemProblems([item]).unassigned).toEqual([item]);
  expect(findUnifiedItemProblems([{ ...item, label: "   " }]).empty).toHaveLength(1);
});

it("duplicates a legacy optional task as a new required task", () => {
  const onChange = vi.fn();
  const initial = unifyStorageToItems({ checkinItems: [{ id: "old", label: "Clean", required: false, category: "general" }],
    checkoutItems: [], checkinPhotoRequirements: [], checkoutPhotoRequirements: [] });
  render(<Editor coupled kitchen initial={initial} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "duplicateItem" }));
  const result = itemsToStorage(onChange.mock.lastCall![0]);
  expect(result.checkinItems.map(item => item.required)).toEqual([false, true]);
});

it("reorders with the keyboard under a filter without dropping hidden tasks", () => {
  const onChange = vi.fn();
  const initial = unifyStorageToItems({ checkinItems: [
    { id: "a", label: "First", required: false, category: "general" },
    { id: "b", label: "Second", required: true, category: "general" }],
    checkoutItems: [{ id: "c", label: "Hidden", required: false, category: "general" }],
    checkinPhotoRequirements: [], checkoutPhotoRequirements: [] });
  render(<Editor coupled kitchen initial={initial} onChange={onChange} />);
  fireEvent.click(within(screen.getByRole("group", { name: "filterTasks" })).getByRole("button", { name: /checkIn/ }));
  fireEvent.keyDown(screen.getAllByRole("button", { name: "dragToReorder" })[0], { key: "ArrowDown" });
  const result = itemsToStorage(onChange.mock.lastCall![0]);
  expect(result.checkinItems.map(item => item.id)).toEqual(["b", "a"]);
  expect(result.checkinItems[1].required).toBe(false);
  expect(result.checkoutItems[0]).toEqual({ id: "c", label: "Hidden", required: false, category: "general" });
});
