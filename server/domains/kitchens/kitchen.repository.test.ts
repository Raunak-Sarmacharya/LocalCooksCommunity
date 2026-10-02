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
  state: { rows: [] as Array<Record<string, unknown>>, orderArgs: [] as unknown[], updatePatch: {} as Record<string, unknown> },
}));

vi.mock("../../db", () => ({
  db: {
    update: () => ({ set: (patch: Record<string, unknown>) => {
      state.updatePatch = patch;
      return { where: () => ({ returning: async () => [{ ...kitchenRow("active"), ...patch }] }) };
    } }),
    select: () => ({
      from: () => {
        // `findAllActive` / `findByLocationId` await `orderBy(...)` directly — there is no
        // `.limit()` on either path. The args are captured so the ORDER can be asserted.
        const orderBy = (...args: unknown[]) => {
          state.orderArgs = args;
          return Promise.resolve(state.rows);
        };
        /*
         * TWO chains, because the two methods differ now. `findAllActive` LEFT JOINs the location —
         * the licence lives there, and it is a third visibility switch alongside the kitchen's own
         * two. `findByLocationId` reads kitchens alone and keeps the plain `where` chain.
         */
        return {
          leftJoin: () => ({ orderBy }),
          where: () => ({ orderBy }),
        };
      },
    }),
  },
}));

import { KitchenRepository } from "./kitchen.repository";

/** The columns `mapToDTO` reads, plus the ones `KitchenDTO` requires. */
const kitchenRow = (listingStatus: string) => ({
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

/**
 * The location side of the join, carrying a licence that is VALID today.
 *
 * It has to be valid or `kitchenIsVisibleToChefs` drops the row before `mapToDTO` is reached — which
 * is the new filter doing its job, and would make these cases fail for a reason they are not about.
 */
const locationWith = (kitchenLicenseExpiry: string | null) => ({
  id: 1,
  kitchenLicenseUrl: "https://cdn.example/license.pdf",
  kitchenLicenseStatus: "approved",
  kitchenLicenseExpiry,
});

/** What the joined query hands back, in the shape the repository now selects. */
const row = (listingStatus: string) => ({
  kitchen: kitchenRow(listingStatus),
  location: locationWith("2027-01-01"),
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
   *
   * `findByLocationId` is the vehicle, not `findAllActive`: the latter now applies the
   * chef-visibility filter, so a kitchen that is not published never reaches `mapToDTO` through it.
   * That filter is the next block's subject. This one is about the MAPPING — and the manager's own
   * list is exactly where a draft must still be readable.
   */
  it.each(["draft", "pending", "approved", "rejected", "inactive"])(
    "folds %s down to 'draft'",
    async (status) => {
      state.rows.push(kitchenRow(status));
      const [kitchen] = await new KitchenRepository().findByLocationId(1);
      expect(kitchen.listingStatus).toBe("draft");
    },
  );

  it("drops a published kitchen whose licence has LAPSED", async () => {
    /*
     * The whole point of joining the location. A published kitchen with a lapsed licence is not
     * something a chef may see — it used to keep serving its calendar and price while the booking
     * path refused it at the end.
     */
    state.rows.push({ kitchen: kitchenRow("active"), location: locationWith("2020-01-01") });

    expect(await new KitchenRepository().findAllActive()).toHaveLength(0);
  });

  it("keeps a published kitchen whose licence is merely about to lapse", async () => {
    // Still valid, so still visible: renewing early must not cost a manager their listing.
    const soon = new Date();
    soon.setDate(soon.getDate() + 10);
    state.rows.push({
      kitchen: kitchenRow("active"),
      location: locationWith(soon.toISOString().slice(0, 10)),
    });

    expect(await new KitchenRepository().findAllActive()).toHaveLength(1);
  });
});

describe("KitchenRepository required listing edits", () => {
  it("drafts the kitchen in the same update that clears its description", async () => {
    await new KitchenRepository().update(1, { id: 1, description: "" });
    expect(state.updatePatch).toMatchObject({ description: "", listingStatus: "draft" });
  });

  it("keeps the listing state when a required description remains", async () => {
    await new KitchenRepository().update(1, { id: 1, description: "Still bookable" });
    expect(state.updatePatch.listingStatus).toBeUndefined();
  });

  it("also drafts when a client sends a null description", async () => {
    await new KitchenRepository().update(1, { id: 1, description: null });
    expect(state.updatePatch.listingStatus).toBe("draft");
  });

  it("drafts the kitchen in the same update that removes its cover", async () => {
    await new KitchenRepository().updateImage(1, null);
    expect(state.updatePatch).toMatchObject({ imageUrl: null, listingStatus: "draft" });
  });
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
