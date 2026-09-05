import assert from "node:assert/strict";
import { isChefShellPath } from "./chef-shell-path";

assert.equal(isChefShellPath("/dashboard"), true);
assert.equal(isChefShellPath("/dashboard?view=bookings"), true);
assert.equal(isChefShellPath("/book/12"), true);
assert.equal(isChefShellPath("/kitchen-preview/foo"), true);
assert.equal(isChefShellPath("/en-CA/kitchen-preview/foo"), true);
assert.equal(isChefShellPath("/booking/99"), true);
assert.equal(isChefShellPath("/apply-kitchen/3"), true);
assert.equal(isChefShellPath("/kitchen-requirements/3"), true);
assert.equal(isChefShellPath("/manager/booking/99"), false);
assert.equal(isChefShellPath("/manager/dashboard"), false);
assert.equal(isChefShellPath("/auth"), false);
assert.equal(isChefShellPath("/"), false);

console.log("chef-shell-path.test.ts: ok");
