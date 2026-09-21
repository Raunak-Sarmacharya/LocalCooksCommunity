import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `mapToDTO` is the boundary where the SHARED `listing_status` enum becomes the kitchen domain's
 * two-value publish state.
 *
 * It had no coverage at all: `kitchen.service.test.ts` injects a hand-written mock repository, so it
 * never reaches this function, and the type alone cannot catch a mapping that lets `pending` through
 * as published. The column is shared with storage and equipment listings, which really do use
 * `pending` / `approved` / `rejected` — so "some other status is present" is a live possibility, not
 * a hypothetical.
 *
 * `vi.hoisted` because the mock factory runs before the module body, so it cannot close over a plain
 * `const` declared below it.
 */
const { state } = vi.hoisted(() => ({
  state: { rows: [] as Array<Record<string, unknown>>, orderArgs: [] as unknown[] },
}));

vi.mock("../../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          // `findAllActive` / `findByLocationId` await `orderBy(...)` directly — there is no
          // `.limit()` on either path. The args are captured so the ORDER can be asserted.
          orderBy: (...args: unknown[]) => {
            state.orderArgs = args;
            return Promise.resolve(state.rows);
          },
        }),
      }),
    }),
  },
}));

import { KitchenRepository } from "./kitchen.repository";

/** The columns `mapToDTO` reads, plus the ones `KitchenDTO` requires. */
const row = (listingStatus: string) => ({
  id: 1,
  locationId: 1,
  name: "Prep kitchen",
  description: null,
  imageUrl: null,
  galleryImages: [],
  amenities: [],
  isActive: true,
  listingStatus,
  hourlyRate: null,
  dailyRate: null,
  currency: "CAD",
  minimumBookingHours: 1,
  pricingModel: "hourly",
  taxRatePercent: null,
  smartLockAvailable: false,
  smartLockEnabled: false,
  smartLockConfig: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});

describe("KitchenRepository.mapToDTO — listingStatus", () => {
  beforeEach(() => {
    state.rows.length = 0;
  });

  it("reports 'active' for a published kitchen", async () => {
    state.rows.push(row("active"));
    const [kitchen] = await new KitchenRepository().findAllActive();
    expect(kitchen.listingStatus).toBe("active");
  });

  /*
   * The load-bearing case. Every other member of the shared enum means "not published", so folding
   * them all to `draft` is what makes the DTO's narrow type TRUE rather than merely asserted.
   */
  it.each(["draft", "pending", "approved", "rejected", "inactive"])(
    "folds %s down to 'draft'",
    async (status) => {
      state.rows.push(row(status));
      const [kitchen] = await new KitchenRepository().findAllActive();
      expect(kitchen.listingStatus).toBe("draft");
    },
  );
});

/**
 * The manager's kitchen list must be in CREATION order.
 *
 * It used to be `desc(createdAt)`, so a newly added kitchen jumped to the top — and because the
 * onboarding wizard auto-selects `kitchens[0]`, the new (empty) kitchen silently became the subject
 * of the Availability step and flipped it from done to not-done. Ascending also stops the switcher
 * reordering itself under the manager.
 *
 * Asserted on the rendered SQL rather than on the column, because the bug was the DIRECTION.
 */
describe("KitchenRepository.findByLocationId — order", () => {
  beforeEach(() => {
    state.rows.length = 0;
    state.orderArgs = [];
  });

  it("asks the database for oldest-first, with a deterministic tiebreaker", async () => {
    await new KitchenRepository().findByLocationId(1);

    /*
     * Read the DIRECTION out of drizzle's SQL chunks. `JSON.stringify` cannot be used on the
     * argument — it holds a `PgTable`, which is circular — so only the string chunks are collected,
     * which is exactly where " asc" lives.
     */
    const directions = state.orderArgs.map((arg) =>
      ((arg as { queryChunks?: unknown[] })?.queryChunks ?? [])
        .flatMap((chunk) => {
          const value = (chunk as { value?: unknown })?.value;
          return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
        })
        .join(""),
    );

    expect(state.orderArgs.length, `directions: ${JSON.stringify(directions)}`).toBe(2);
    for (const direction of directions) {
      expect(direction, `directions: ${JSON.stringify(directions)}`).toContain("asc");
      expect(direction, `directions: ${JSON.stringify(directions)}`).not.toContain("desc");
    }
  });
});
