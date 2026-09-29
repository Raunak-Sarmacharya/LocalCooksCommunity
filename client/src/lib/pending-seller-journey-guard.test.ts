import assert from "node:assert/strict";
import { shouldAutoSubmitSellerJourney } from "./pending-seller-journey-guard";

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
describe("pending-seller-journey-guard", () => {
  it("holds", () => {

    assert.equal(
      shouldAutoSubmitSellerJourney({ subdomain: "chef", role: "chef", journeyActive: true }),
      true,
      "chef on chef subdomain may submit",
    );

    assert.equal(
      shouldAutoSubmitSellerJourney({ subdomain: "kitchen", role: "manager", isManager: true, journeyActive: true }),
      false,
      "kitchen managers must not be yanked to chef",
    );

    assert.equal(
      shouldAutoSubmitSellerJourney({ subdomain: "chef", role: "manager", isManager: true, journeyActive: true }),
      false,
      "manager role blocks even on chef host",
    );

    assert.equal(
      shouldAutoSubmitSellerJourney({ subdomain: "admin", role: "chef", journeyActive: true }),
      false,
      "admin host never auto-submits seller journey",
    );

    assert.equal(
      shouldAutoSubmitSellerJourney({ subdomain: "chef", role: "chef", journeyActive: false }),
      false,
      "an unrelated later sign-in must not submit an abandoned seller draft",
    );

    console.log("pending-seller-journey-guard: ok");

  });
});