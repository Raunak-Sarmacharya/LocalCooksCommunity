import assert from "node:assert/strict";
import { landingBrowseKitchensPath, landingDashboardPath, landingListKitchenPath } from "./landing-cta";

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
describe("landing-cta", () => {
  it("holds", () => {

    assert.equal(landingDashboardPath(null), "/auth");
    assert.equal(landingDashboardPath({ role: "admin" }), "/admin");
    assert.equal(landingDashboardPath({ role: "manager" }), "/manager/dashboard");
    assert.equal(landingDashboardPath({ isManager: true }), "/manager/dashboard");
    assert.equal(landingDashboardPath({ role: "chef" }), "/dashboard");
    assert.equal(landingDashboardPath({ role: "applicant" }), "/dashboard");

    assert.equal(landingBrowseKitchensPath(null), "/compare-kitchens");
    assert.equal(
      landingBrowseKitchensPath({ role: "chef" }),
      "/dashboard?view=discover-kitchens"
    );

    assert.equal(landingListKitchenPath(null), "/manager/login");
    assert.equal(landingListKitchenPath({ role: "manager" }), "/manager/dashboard");
    assert.equal(landingListKitchenPath({ role: "chef" }), "/dashboard");

    console.log("landing-cta.test.ts: ok");

  });
});