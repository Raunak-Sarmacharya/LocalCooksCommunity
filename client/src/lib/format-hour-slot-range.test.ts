import assert from "node:assert/strict";
import { formatHourSlotRange } from "./formatters";

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
describe("format-hour-slot-range", () => {
  it("holds", () => {

    {
      const label = formatHourSlotRange("10:00", "en-CA");
      assert.match(label, /10/);
      assert.match(label, /11/);
      assert.ok(label.includes("–"));
    }

    {
      const label = formatHourSlotRange("11:00", "en-CA");
      assert.match(label, /11/);
      assert.match(label, /12/);
    }

    console.log("formatHourSlotRange: ok");

  });
});