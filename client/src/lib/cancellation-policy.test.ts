import assert from "node:assert/strict";
import {
  EN_CANCELLATION_POLICY_DEFAULT,
  formatCancellationWindowText,
} from "./cancellation-policy";

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
