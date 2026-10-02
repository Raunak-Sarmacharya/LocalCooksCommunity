import { expect, it } from "vitest";
import { resolveKitchenTracking } from "./kitchen-tracking";

it("requires kitchen opt-in and preserves checkout for visits already underway", () => {
  const shared = { checkinEnabled: true, checkoutEnabled: true };
  expect(resolveKitchenTracking(false, shared)).toEqual({ checkinEnabled: false, checkoutEnabled: false });
  expect(resolveKitchenTracking(true, shared)).toEqual(shared);
  expect(resolveKitchenTracking(true, null)).toEqual({ checkinEnabled: false, checkoutEnabled: false });
  expect(resolveKitchenTracking(false, shared, "checked_in")).toEqual({ checkinEnabled: false, checkoutEnabled: true });
});
