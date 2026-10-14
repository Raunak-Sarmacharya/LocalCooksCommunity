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
        return `Cancel at least ${options?.hours} hours before for a full refund minus the actual card processing fee.`;
      }
      return String(options?.defaultValue || key);
    };

    const first = cancellationPolicyFirstLine(48, null, t);
    assert.equal(first, "Free to cancel until the kitchen confirms your request — your card is only on hold.");
    assert.equal(first.includes("full release"), false);

    const full = buildCancellationPolicyText(48, null, t);
    assert.equal(full.includes("48 hours"), true);
    assert.equal(full.includes("No payment is taken"), true);
    assert.equal(full.includes("actual card processing fee"), true);
    assert.equal(full.includes("reviewed separately"), false);
    const custom = buildCancellationPolicyText(48, "No refunds ever.", t);
    assert.equal(custom.includes("No refunds ever."), false);

    console.log("cancellation-policy-dialog.test.ts: ok");

  });
});
