import { describe, expect, it } from "vitest";
import { updateKitchenViewingStatusSchema } from "@shared/schema";

describe("tour review state boundary", () => {
  it("keeps the Local Cooks state out of the generic status endpoint", () => {
    expect(updateKitchenViewingStatusSchema.safeParse({
      id: 1,
      status: "pending_local_cooks",
    }).success).toBe(false);
    expect(updateKitchenViewingStatusSchema.safeParse({ id: 1, status: "confirmed" }).success).toBe(true);
    expect(updateKitchenViewingStatusSchema.safeParse({ id: 1, status: "cancelled" }).success).toBe(true);
  });
});
