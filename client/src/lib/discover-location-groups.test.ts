import assert from "node:assert/strict";
import {
  groupKitchensByLocation,
  kitchenPreviewPath,
  type DiscoverKitchenLike,
} from "./discover-location-groups";

function kitchen(
  overrides: Partial<DiscoverKitchenLike> & Pick<DiscoverKitchenLike, "id" | "locationId">
): DiscoverKitchenLike {
  return {
    name: `Kitchen ${overrides.id}`,
    locationName: `Location ${overrides.locationId}`,
    address: "1 Main St",
    canAcceptBookings: true,
    ...overrides,
  };
}

{
  const cards = groupKitchensByLocation([
    kitchen({
      id: 1,
      locationId: 10,
      name: "A",
      imageUrl: null,
      hourlyRate: 5000,
      equipment: ["fryer"],
      storageSummary: {
        hasDryStorage: false,
        hasColdStorage: true,
        hasFreezerStorage: false,
        totalStorageUnits: 1,
      },
    }),
    kitchen({
      id: 2,
      locationId: 10,
      name: "B",
      imageUrl: "https://img/b.jpg",
      hourlyRate: 3000,
      equipment: ["commercial-oven"],
      storageSummary: {
        hasDryStorage: true,
        hasColdStorage: false,
        hasFreezerStorage: false,
        totalStorageUnits: 2,
      },
    }),
    kitchen({ id: 3, locationId: 20, name: "C", hourlyRate: 4000 }),
  ]);

  assert.equal(cards.length, 2);
  assert.equal(cards[0].locationId, 10);
  assert.equal(cards[0].kitchenCount, 2);
  assert.equal(cards[0].displayKitchen.id, 2); // prefers image
  assert.equal(cards[0].hourlyRate, 3000); // min rate
  // Aggregates inventory from ALL kitchens at the location (not just display kitchen)
  assert.deepEqual(cards[0].equipment, ["Deep Fryer", "Commercial Oven"]);
  assert.deepEqual(cards[0].storageSummary, {
    hasDryStorage: true,
    hasColdStorage: true,
    hasFreezerStorage: false,
    totalStorageUnits: 3,
  });
  assert.equal(cards[1].locationId, 20);
  assert.equal(cards[1].kitchenCount, 1);
  assert.deepEqual(cards[1].equipment, []);
  assert.equal(cards[1].storageSummary.totalStorageUnits, 0);
}

{
  const empty = groupKitchensByLocation([]);
  assert.deepEqual(empty, []);
}

{
  assert.equal(kitchenPreviewPath(94, "downtown"), "/kitchen-preview/downtown");
  assert.equal(kitchenPreviewPath(94), "/kitchen-preview/94");
  assert.equal(kitchenPreviewPath(94, null), "/kitchen-preview/94");
}

console.log("discover-location-groups.test.ts: ok");
