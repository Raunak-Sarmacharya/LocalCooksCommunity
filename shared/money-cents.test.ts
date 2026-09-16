import assert from "node:assert/strict";
import { parseCentsField, parseCentsFieldOrZero } from "./money-cents";

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
