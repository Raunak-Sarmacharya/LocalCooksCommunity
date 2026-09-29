import assert from "node:assert/strict";
import { formatEquipmentBreakdown, formatEquipmentLine, formatStorageLine, mergeEquipmentLists, mergeEquipmentSummaries, mergeStorageSummaries, resolveEquipmentLabel } from "./kitchen-grid-card";

import { describe, it } from "vitest";

/*
 * A `node:assert` script, wrapped so vitest can REPORT it.
 *
 * It was named `*.test.ts`, which made vitest collect it — and a file with no `describe`/`it`
 * is reported as "No test suite found", i.e. a FAILED FILE. So a script whose every assertion
 * PASSED showed up as a failure, and a genuine regression showed up as exactly the same
 * failure. The signal was useless in both directions, and twenty of these had buried the two
 * real failures in this repo's baseline.
 */
describe("kitchen-grid-card", () => {
  it("holds", () => {

    {
      assert.equal(
        formatStorageLine(
          {
            hasDryStorage: true,
            hasColdStorage: true,
            hasFreezerStorage: false,
            totalStorageUnits: 2,
          },
          "—"
        ),
        "2"
      );
      assert.equal(
        formatStorageLine(
          {
            hasDryStorage: true,
            hasColdStorage: false,
            hasFreezerStorage: false,
            totalStorageUnits: 3,
          },
          "—"
        ),
        "3"
      );
      assert.equal(
        formatStorageLine(
          {
            hasDryStorage: false,
            hasColdStorage: false,
            hasFreezerStorage: false,
            totalStorageUnits: 4,
          },
          "—"
        ),
        "4"
      );
      assert.equal(formatStorageLine(null, "—"), "—");
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
      const labels = { included: "included", rental: "rental", none: "—" };
      assert.equal(
        formatEquipmentBreakdown({ included: 3, rental: 2 }, labels),
        "3 included + 2 rental"
      );
      assert.equal(formatEquipmentBreakdown({ included: 4, rental: 0 }, labels), "4 included");
      assert.equal(formatEquipmentBreakdown({ included: 0, rental: 2 }, labels), "2 rental");
      assert.equal(formatEquipmentBreakdown({ included: 0, rental: 0 }, labels), "—");
      assert.equal(formatEquipmentBreakdown(null, labels), "—");
    }

    {
      assert.deepEqual(
        mergeEquipmentLists([["commercial-oven"], ["range-stove", "commercial-oven"]]),
        ["Commercial Oven", "Range/Stove"]
      );
      assert.deepEqual(
        mergeEquipmentSummaries([
          { included: 2, rental: 1 },
          { included: 1, rental: 3 },
          null,
        ]),
        { included: 3, rental: 4 }
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

  });
});