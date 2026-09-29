import assert from "node:assert/strict";
import {
  getRoleLoginOrigin,
  getSubdomainOriginForEnvironment,
  isPreviewDeployment,
} from "./subdomain-utils";

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
describe("subdomain-utils.preview", () => {
  it("holds", () => {

    assert.equal(isPreviewDeployment("chef.localcooks.ca", "production"), false);
    assert.equal(isPreviewDeployment("chef.localcooks.ca", "preview"), true);
    assert.equal(isPreviewDeployment("dev-chef.localcooks.ca", "production"), true);
    assert.equal(isPreviewDeployment("foo.vercel.app", "preview"), true);
    assert.equal(isPreviewDeployment("foo.vercel.app", "production"), false);

    assert.equal(
      getSubdomainOriginForEnvironment("chef", "chef.localcooks.ca", {
        vercelEnv: "production",
      }),
      "https://chef.localcooks.ca"
    );
    assert.equal(
      getSubdomainOriginForEnvironment("chef", "chef.localcooks.ca", {
        vercelEnv: "preview",
      }),
      "https://dev-chef.localcooks.ca"
    );
    assert.equal(
      getSubdomainOriginForEnvironment("chef", "something.vercel.app", {
        vercelEnv: "preview",
      }),
      "https://dev-chef.localcooks.ca"
    );
    assert.equal(
      getRoleLoginOrigin("chef", "admin.localcooks.ca", { vercelEnv: "preview" }),
      "https://dev-chef.localcooks.ca"
    );
    assert.equal(
      getRoleLoginOrigin("manager", "kitchen.localcooks.ca", {
        vercelEnv: "production",
      }),
      "https://kitchen.localcooks.ca"
    );
    assert.equal(
      getRoleLoginOrigin("chef", "chef.localhost", { port: "5001", protocol: "http:" }),
      "http://chef.localhost:5001"
    );

    console.log("subdomain-utils.preview.test.ts: ok");

  });
});