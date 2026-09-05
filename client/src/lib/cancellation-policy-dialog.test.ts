import assert from "node:assert/strict";
import { cancellationPolicyFirstLine, buildCancellationPolicyText } from "../components/booking/CancellationPolicyDialog";

const t = (key: string, options?: Record<string, unknown>) => {
  if (key === "cancellationPolicyDefaultMessage") {
    return `Bookings cannot be cancelled within ${options?.hours} hours of the scheduled time.`;
  }
  if (key === "cancellationPolicyRefundRules") {
    return "Cancel before approval for a full release.";
  }
  return key;
};

const first = cancellationPolicyFirstLine(48, null, t);
assert.equal(first.includes("48 hours"), true);
assert.equal(first.includes("full release"), false);

const full = buildCancellationPolicyText(48, null, t);
assert.equal(full.includes("48 hours"), true);
assert.equal(full.includes("full release"), true);

console.log("cancellation-policy-dialog.test.ts: ok");
