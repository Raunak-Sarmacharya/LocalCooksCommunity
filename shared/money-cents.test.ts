import assert from "node:assert/strict";
import { parseCentsField, parseCentsFieldOrZero } from "./money-cents";

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
describe("money-cents", () => {
  it("holds", () => {

    assert.equal(parseCentsField(null), null);
    assert.equal(parseCentsField(undefined), null);
    assert.equal(parseCentsField(""), null);
    assert.equal(parseCentsField(0), 0);
    assert.equal(parseCentsField("0"), 0);
    assert.equal(parseCentsField("1021"), 1021);
    assert.equal(parseCentsField(1021), 1021);
    assert.equal(parseCentsField("not-a-number"), null);
    assert.equal(parseCentsFieldOrZero(null), 0);
    assert.equal(parseCentsFieldOrZero("63"), 63);

    console.log("money-cents: ok");

  });
});