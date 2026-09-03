import assert from "node:assert/strict";
import { mapPasswordSignInError } from "./login-challenge";

assert.equal(
  mapPasswordSignInError("Firebase: Error (auth/invalid-credential).").descKey,
  "errInvalidCredential"
);
assert.equal(
  mapPasswordSignInError("auth/user-not-found").descKey,
  "errInvalidCredential",
  "must not distinguish missing accounts (enumeration)"
);
assert.equal(mapPasswordSignInError("too-many-requests").descKey, "errTooManyAttempts");
assert.equal(
  mapPasswordSignInError("Please verify your email before logging in").descKey,
  "errEmailNotVerified"
);
assert.equal(mapPasswordSignInError("something weird").descKey, "errSignInGeneric");

console.log("login-challenge.test.ts: ok");
