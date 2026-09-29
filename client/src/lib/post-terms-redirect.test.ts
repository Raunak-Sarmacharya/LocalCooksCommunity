import assert from "node:assert/strict";
import { postTermsRedirect } from "./post-terms-redirect";

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
describe("post-terms-redirect", () => {
  it("holds", () => {

    // The bug: a kitchen-origin manager must never resolve to a chef /dashboard,
    // because that hard-redirects across origins and lands on chef /auth.
    assert.equal(
      postTermsRedirect({ hostname: "kitchen.localhost", role: "manager", isManager: true }),
      "/manager/dashboard",
      "kitchen manager stays on manager dashboard",
    );

    // Even if the auth context user is momentarily null, the kitchen origin alone
    // must keep the redirect on the manager side.
    assert.equal(
      postTermsRedirect({ hostname: "kitchen.localhost", role: null, isManager: null }),
      "/manager/dashboard",
      "kitchen origin never falls back to chef",
    );

    // Explicit manager target passes through untouched.
    assert.equal(
      postTermsRedirect({ hostname: "kitchen.localhost", redirectParam: "/manager/setup", role: "manager" }),
      "/manager/setup",
      "explicit target wins",
    );

    // A real chef on the chef origin still goes to the chef dashboard.
    assert.equal(
      postTermsRedirect({ hostname: "chef.localhost", role: "chef", chefFallback: "/dashboard" }),
      "/dashboard",
      "chef on chef origin lands on chef dashboard",
    );

    // Generic "/dashboard" param is treated as "unset" so subdomain wins.
    assert.equal(
      postTermsRedirect({ hostname: "kitchen.localhost", redirectParam: "/dashboard", role: "manager" }),
      "/manager/dashboard",
      "generic /dashboard param does not force chef",
    );

    console.log("post-terms-redirect: ok");

  });
});