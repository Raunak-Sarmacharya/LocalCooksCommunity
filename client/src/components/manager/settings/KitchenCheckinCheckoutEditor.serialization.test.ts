import { describe, expect, it } from "vitest";
import { findUnifiedItemProblems, itemsToStorage, unifyStorageToItems, type UnifiedChecklistItem } from "./KitchenCheckinCheckoutEditor";
import type { ChecklistItem, PhotoRequirement } from "./shared/ChecklistEditor";

const duty = (id: string, required: boolean, photoRequired?: boolean): ChecklistItem => ({
  id, label: id, required, category: "safety", ...(photoRequired === undefined ? {} : { photoRequired }),
});
const photo = (id: string, required: boolean): PhotoRequirement => ({ id, label: `Photo ${id}`, required, exampleUrl: "/example.jpg" });
const legacy = () => ({
  checkinItems: [duty("same", false, false), duty("arrival", true, true)],
  checkoutItems: [duty("departure", false), { ...duty("same", true, true), label: "Departure wording", description: "Departure hint" }],
  checkinPhotoRequirements: [photo("orphan", false), photo("same", false)],
  checkoutPhotoRequirements: [photo("same", true), photo("orphan", true)],
});

describe("kitchen duty serialization", () => {
  it("round trips exact saved stage requiredness, photo flags, category, wording, examples, orphan photos and stage order", () => {
    const original = legacy();
    const result = itemsToStorage(unifyStorageToItems(original));
    expect(result).toEqual(original);
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(JSON.parse(JSON.stringify(original)));
    expect(result.checkinItems.some(item => item.id === "orphan")).toBe(false);
    expect(result.checkoutItems.some(item => item.id === "orphan")).toBe(false);
  });

  it("preserves optional flags when editing a label and description", () => {
    const original = legacy();
    const items = unifyStorageToItems(original).map(item => item.id === "same"
      ? { ...item, label: "Updated task", description: "New hint" } : item);
    const result = itemsToStorage(items);
    expect(result.checkinItems[0]).toEqual({ ...original.checkinItems[0], label: "Updated task", description: "New hint" });
    expect(result.checkoutItems[1]).toEqual({ ...original.checkoutItems[1], label: "Updated task", description: "New hint" });
    expect(result.checkinPhotoRequirements[1]).toEqual({ ...original.checkinPhotoRequirements[1], label: "Updated task", description: "New hint" });
    expect(result.checkoutPhotoRequirements[0]).toEqual({ ...original.checkoutPhotoRequirements[0], label: "Updated task", description: "New hint" });
  });

  it("keeps new tasks and photos required and trims newly typed text", () => {
    const item: UnifiedChecklistItem = { id: "new", label: " Clean counters ", description: " Use sanitizer ",
      requiredOnCheckin: true, requiredOnCheckout: true, photoRequired: true };
    const result = itemsToStorage([item]);
    const expected = { id: "new", label: "Clean counters", description: "Use sanitizer", required: true };
    expect(result).toEqual({ checkinItems: [{ ...expected, category: "general", photoRequired: true }],
      checkoutItems: [{ ...expected, category: "general", photoRequired: true }],
      checkinPhotoRequirements: [expected], checkoutPhotoRequirements: [expected] });
  });

  it("requires new stage assignments while retaining original stage optionality", () => {
    const items = unifyStorageToItems({ checkinItems: [duty("old", false)], checkoutItems: [],
      checkinPhotoRequirements: [], checkoutPhotoRequirements: [] });
    const result = itemsToStorage(items.map(item => ({ ...item, requiredOnCheckout: true, photoRequired: true })));
    expect(result.checkinItems[0].required).toBe(false);
    expect(result.checkoutItems[0].required).toBe(true);
    expect(result.checkinPhotoRequirements[0].required).toBe(true);
    expect(result.checkoutPhotoRequirements[0].required).toBe(true);
  });

  it("only removes photos when explicitly deselected, retaining optional checklist duties", () => {
    const result = itemsToStorage(unifyStorageToItems(legacy()).map(item => ({ ...item, photoRequired: false })));
    expect(result.checkinPhotoRequirements).toEqual([]);
    expect(result.checkoutPhotoRequirements).toEqual([]);
    expect(result.checkinItems[0].required).toBe(false);
    expect(result.checkoutItems[1].required).toBe(true);
    expect(result.checkinItems.some(item => item.id === "orphan")).toBe(false);
  });

  it("blocks ambiguous duplicate IDs rather than silently merging records", () => {
    const original = { checkinItems: [duty("duplicate", false), duty("duplicate", true)], checkoutItems: [],
      checkinPhotoRequirements: [], checkoutPhotoRequirements: [] };
    const items = unifyStorageToItems(original);
    expect(findUnifiedItemProblems(items).ambiguous.map(item => item.id)).toEqual(["duplicate"]);
    expect(() => itemsToStorage(items)).toThrow("Duplicate saved duty IDs");
    expect(original.checkinItems).toHaveLength(2);
  });


  it("blocks duplicate orphan photo IDs even when their requiredness differs", () => {
    const items = unifyStorageToItems({ checkinItems: [], checkoutItems: [],
      checkinPhotoRequirements: [photo("duplicate", false), photo("duplicate", true)], checkoutPhotoRequirements: [] });
    expect(findUnifiedItemProblems(items).ambiguous).toHaveLength(1);
    expect(() => itemsToStorage(items)).toThrow("Duplicate saved duty IDs");
  });

  it("honors explicit reorder without changing optional flags", () => {
    const result = itemsToStorage(unifyStorageToItems(legacy()).reverse());
    expect(result.checkinItems.map(item => item.id)).toEqual(["arrival", "same"]);
    expect(result.checkoutItems.map(item => item.id)).toEqual(["departure", "same"]);
    expect(result.checkinItems[1].required).toBe(false);
  });
});
