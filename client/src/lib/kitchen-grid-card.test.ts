import assert from "node:assert/strict";
import {
  formatEquipmentLine,
  formatStorageLine,
  mergeEquipmentLists,
  mergeStorageSummaries,
  resolveEquipmentLabel,
} from "./kitchen-grid-card";

{
  assert.equal(
    formatStorageLine(
      {
        hasDryStorage: true,
        hasColdStorage: true,
        hasFreezerStorage: false,
        totalStorageUnits: 2,
      },
      { dry: "Dry", cold: "Cold", freezer: "Freezer", none: "—" }
    ),
    "Dry +1"
  );
  assert.equal(
    formatStorageLine(
      {
        hasDryStorage: true,
        hasColdStorage: false,
        hasFreezerStorage: false,
        totalStorageUnits: 3,
      },
      { dry: "Dry", cold: "Cold", freezer: "Freezer", none: "—" }
    ),
    "Dry +2"
  );
  assert.equal(
    formatStorageLine(
      {
        hasDryStorage: false,
        hasColdStorage: false,
        hasFreezerStorage: false,
        totalStorageUnits: 4,
      },
      { dry: "Dry", cold: "Cold", freezer: "Freezer", none: "—" }
    ),
    "4"
  );
  assert.equal(
    formatStorageLine(null, {
      dry: "Dry",
      cold: "Cold",
      freezer: "Freezer",
      none: "—",
    }),
    "—"
  );
}

{
  assert.equal(resolveEquipmentLabel("commercial-oven"), "Commercial Oven");
  assert.equal(resolveEquipmentLabel("range-stove"), "Range/Stove");
  assert.equal(formatEquipmentLine(["commercial-oven"], "—"), "Commercial Oven");
  assert.equal(
    formatEquipmentLine(["commercial-oven", "range-stove", "fryer", "grill"], "—"),
    "Commercial Oven, Range/Stove +2"
  );
  assert.equal(formatEquipmentLine([], "—"), "—");
}

{
  assert.deepEqual(
    mergeEquipmentLists([["commercial-oven"], ["range-stove", "commercial-oven"]]),
    ["Commercial Oven", "Range/Stove"]
  );
  assert.deepEqual(
    mergeStorageSummaries([
      { hasDryStorage: true, hasColdStorage: false, hasFreezerStorage: false, totalStorageUnits: 1 },
      { hasDryStorage: false, hasColdStorage: true, hasFreezerStorage: true, totalStorageUnits: 2 },
    ]),
    {
      hasDryStorage: true,
      hasColdStorage: true,
      hasFreezerStorage: true,
      totalStorageUnits: 3,
    }
  );
}

console.log("kitchen-grid-card.test.ts: ok");
