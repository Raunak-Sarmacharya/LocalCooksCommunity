import assert from "node:assert/strict";
import {
  getRoleLoginOrigin,
  getSubdomainOriginForEnvironment,
  isPreviewDeployment,
} from "./subdomain-utils";

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
