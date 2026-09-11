import assert from "node:assert/strict";
import { evaluateTypedKitchenDate, parseLocalDateInput } from "./kitchen-typed-date";

assert.equal(evaluateTypedKitchenDate("", {}, "2026-09-04"), "empty");
assert.equal(evaluateTypedKitchenDate("2026-09-03", { "2026-09-03": true }, "2026-09-04"), "past");
assert.equal(evaluateTypedKitchenDate("2026-09-10", {}, "2026-09-04"), "pending");
assert.equal(
  evaluateTypedKitchenDate("2026-09-10", { "2026-09-10": true }, "2026-09-04"),
  "available"
);
assert.equal(
  evaluateTypedKitchenDate("2026-09-10", { "2026-09-10": false }, "2026-09-04"),
  "unavailable"
);

const d = parseLocalDateInput("2026-09-15");
assert.ok(d);
assert.equal(d!.getFullYear(), 2026);
assert.equal(d!.getMonth(), 8);
assert.equal(d!.getDate(), 15);
assert.equal(parseLocalDateInput("2026-02-31"), undefined);

console.log("kitchen-typed-date: ok");
