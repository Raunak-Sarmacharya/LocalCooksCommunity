import assert from "node:assert/strict";
import { postTermsRedirect } from "./post-terms-redirect";

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
