import assert from "node:assert/strict";
import { kitchensForTourAtLocation, resolveTourKitchenTarget, shouldPromptTourKitchenSelect } from "./tour-kitchen-select";

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
describe("tour-kitchen-select", () => {
  it("holds", () => {

    const kitchens = [
      { id: 1, name: "Kitchen A", locationId: 10 },
      { id: 2, name: "Kitchen B", locationId: 10 },
      { id: 4, name: "Solo", locationId: 20 },
    ];

    {
      const at10 = kitchensForTourAtLocation(kitchens, 10);
      assert.equal(at10.length, 2);
      assert.equal(shouldPromptTourKitchenSelect(at10, true), true);
      assert.equal(shouldPromptTourKitchenSelect(at10, false), false);
      assert.equal(resolveTourKitchenTarget(at10, true).mode, "select");
      assert.equal(resolveTourKitchenTarget(at10, false).mode, "auto");
    }

    {
      const solo = kitchensForTourAtLocation(kitchens, 20);
      assert.equal(solo.length, 1);
      assert.equal(shouldPromptTourKitchenSelect(solo, true), false);
      const resolved = resolveTourKitchenTarget(solo, true);
      assert.equal(resolved.mode, "auto");
      if (resolved.mode === "auto") assert.equal(resolved.kitchen?.id, 4);
    }

    {
      assert.equal(resolveTourKitchenTarget([], true).mode, "auto");
    }

    console.log("tour-kitchen-select: ok");

  });
});