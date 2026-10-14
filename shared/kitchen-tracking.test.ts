import { expect, it } from "vitest";
import { resolveKitchenTracking } from "./kitchen-tracking";

it("always exposes both kitchen workflow steps without reading legacy flags", () => {
  expect(resolveKitchenTracking()).toEqual({ checkinEnabled: true, checkoutEnabled: true });
});
