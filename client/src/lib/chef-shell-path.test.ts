import assert from "node:assert/strict";
import { isChefShellPath } from "./chef-shell-path";

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
describe("chef-shell-path", () => {
  it("holds", () => {

    assert.equal(isChefShellPath("/dashboard"), true);
    assert.equal(isChefShellPath("/dashboard?view=bookings"), true);
    assert.equal(isChefShellPath("/book/12"), true);
    assert.equal(isChefShellPath("/kitchen-preview/foo"), true);
    assert.equal(isChefShellPath("/en-CA/kitchen-preview/foo"), true);
    assert.equal(isChefShellPath("/booking/99"), true);
    assert.equal(isChefShellPath("/apply-kitchen/3"), true);
    assert.equal(isChefShellPath("/request-tour/3"), true);
    assert.equal(isChefShellPath("/kitchen-requirements/3"), true);
    assert.equal(isChefShellPath("/manager/booking/99"), false);
    assert.equal(isChefShellPath("/manager/dashboard"), false);
    assert.equal(isChefShellPath("/auth"), false);
    assert.equal(isChefShellPath("/"), false);

    console.log("chef-shell-path.test.ts: ok");

  });
});