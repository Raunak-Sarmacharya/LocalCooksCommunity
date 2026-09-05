import assert from "node:assert/strict";
import {
  landingBrowseKitchensPath,
  landingDashboardPath,
  landingListKitchenPath,
} from "./landing-cta";

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
