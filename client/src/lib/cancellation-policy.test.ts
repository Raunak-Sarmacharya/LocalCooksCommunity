import assert from "node:assert/strict";
import { EN_CANCELLATION_POLICY_DEFAULT, formatCancellationWindowText } from "./cancellation-policy";

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
describe("cancellation-policy", () => {
  it("holds", () => {

    {
      const out = formatCancellationWindowText(
        48,
        null,
        "Bookings cannot be cancelled within 48 hours of the scheduled time."
      );
      assert.equal(out, "Bookings cannot be cancelled within 48 hours of the scheduled time.");
    }

    {
      const out = formatCancellationWindowText(
        24,
        EN_CANCELLATION_POLICY_DEFAULT,
        "translated default 24"
      );
      assert.equal(out, "translated default 24");
    }

    {
      const out = formatCancellationWindowText(
        12,
        "Custom: cancel by {hours}h before start.",
        "ignored"
      );
      assert.equal(out, "Custom: cancel by 12h before start.");
    }

    console.log("cancellation-policy.test.ts: ok");

  });
});