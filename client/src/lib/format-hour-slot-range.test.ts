import assert from "node:assert/strict";
import { formatHourSlotRange } from "./formatters";

{
  const label = formatHourSlotRange("10:00", "en-CA");
  assert.match(label, /10/);
  assert.match(label, /11/);
  assert.ok(label.includes("–"));
}

{
  const label = formatHourSlotRange("11:00", "en-CA");
  assert.match(label, /11/);
  assert.match(label, /12/);
}

console.log("formatHourSlotRange: ok");
