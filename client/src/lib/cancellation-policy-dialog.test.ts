import assert from "node:assert/strict";
import { cancellationPolicyFirstLine, buildCancellationPolicyText } from "../components/booking/CancellationPolicyDialog";

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
describe("cancellation-policy-dialog", () => {
  it("holds", () => {

    const t = (key: string, options?: Record<string, unknown>) => {
      if (key === "cancellationPolicyDefaultMessage") {
        return `Bookings cannot be cancelled within ${options?.hours} hours of the scheduled time.`;
      }
      return String(options?.defaultValue || key);
    };

    const first = cancellationPolicyFirstLine(48, null, t);
    assert.equal(first, "100% refund before confirmation");
    assert.equal(first.includes("full release"), false);

    const full = buildCancellationPolicyText(48, null, t);
    assert.equal(full.includes("48 hours"), true);
    assert.equal(full.includes("100% refund of any amount paid, including taxes and fees"), true);
    assert.equal(full.includes("hold will be released instead"), true);
    assert.equal(full.indexOf("After confirmation") > full.indexOf("hold will be released instead"), true);
    assert.equal(full.indexOf("48 hours") > full.indexOf("After confirmation"), true);
    const custom = buildCancellationPolicyText(48, "Cancel at least {hours} hours before arrival.", t);
    assert.equal(custom.includes("Cancel at least 48 hours before arrival."), true);

    console.log("cancellation-policy-dialog.test.ts: ok");

  });
});
