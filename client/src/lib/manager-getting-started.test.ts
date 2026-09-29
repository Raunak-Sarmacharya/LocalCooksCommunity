import { describe, expect, it } from "vitest";

import {
  buildGettingStartedItems,
  isItemVisible,
  summarizeGettingStarted,
  visibleGettingStartedItems,
  GETTING_STARTED_PHASES,
  type GettingStartedInput,
  type GettingStartedStage,
} from "./manager-getting-started";
import type { ListingChecklist, ListingRecommendationId } from "@shared/kitchen-listing-readiness";

const ALL_RECOMMENDATIONS: ListingRecommendationId[] = [
  "gallery",
  "equipment",
  "storage",
  "tours",
  "terms",
];

/** A readiness payload with exactly the named recommendations satisfied. */
function readiness(...met: ListingRecommendationId[]): ListingChecklist {
  const recommendations = ALL_RECOMMENDATIONS.map((id) => ({ id, met: met.includes(id) }));
  return {
    requirements: [],
    recommendations,
    canPublish: true,
    missingRequirementIds: [],
    openRecommendationIds: recommendations.filter((entry) => !entry.met).map((entry) => entry.id),
  };
}

/** A host who has just left the wizard on its first step: nothing set up, phone not proved. */
const NEW_HOST: GettingStartedInput = {
  isSetupComplete: false,
  phoneVerified: false,
  stripeConnected: false,
  hasPublishedKitchen: false,
  readiness: null,
  hasConfirmedBooking: false,
};

/** Setup behind them — a location and a kitchen exist. The phone is still unproved. */
const SET_UP: GettingStartedInput = { ...NEW_HOST, isSetupComplete: true };

/** Live to cooks, phone still unproved — the case the reveal must not strand. */
const LIVE: GettingStartedInput = { ...SET_UP, hasPublishedKitchen: true };

/** Everything done, for the retirement case. */
const ALL_DONE: GettingStartedInput = {
  ...LIVE,
  phoneVerified: true,
  stripeConnected: true,
  readiness: readiness("gallery", "tours", "equipment", "storage"),
  hasConfirmedBooking: true,
};

const stageOf = (input: GettingStartedInput): GettingStartedStage => ({
  isSetupComplete: input.isSetupComplete,
  phoneVerified: input.phoneVerified,
  isLive: input.hasPublishedKitchen,
});

function item(input: GettingStartedInput, id: string) {
  const found = buildGettingStartedItems(input).find((entry) => entry.id === id);
  if (!found) throw new Error(`Expected a Getting Started item with id "${id}"`);
  return found;
}

describe("buildGettingStartedItems", () => {
  it("lists nine rows across three stages", () => {
    const items = buildGettingStartedItems(NEW_HOST);

    expect(items).toHaveLength(9);
    expect(items.filter((entry) => entry.phase === "get-set-up")).toHaveLength(2);
    expect(items.filter((entry) => entry.phase === "get-live")).toHaveLength(2);
    expect(items.filter((entry) => entry.phase === "get-booked")).toHaveLength(5);
    expect(GETTING_STARTED_PHASES).toEqual(["get-set-up", "get-live", "get-booked"]);
    // A phase no item belongs to would render as an empty group.
    expect(new Set(items.map((entry) => entry.phase))).toEqual(new Set(GETTING_STARTED_PHASES));
  });

  it("starts every row open for a host who has done nothing", () => {
    expect(buildGettingStartedItems(NEW_HOST).every((entry) => !entry.complete)).toBe(true);
  });

  it("marks only the first-booking row as a milestone", () => {
    const milestones = buildGettingStartedItems(NEW_HOST)
      .filter((entry) => entry.kind === "milestone")
      .map((entry) => entry.id);
    // Nothing a host can click makes a cook book, so this row must not render as a button.
    expect(milestones).toEqual(["first-booking"]);
  });

  it("keeps 'what makes you live' and 'good to have' in separate stages", () => {
    // The distinction the user asked for: Stripe and publish are the two that actually go live, so
    // they are alone in `get-live`. Everything optional lives in `get-booked`.
    const live = buildGettingStartedItems(NEW_HOST)
      .filter((entry) => entry.phase === "get-live")
      .map((entry) => entry.id);
    expect(live).toEqual(["stripe", "publish-kitchen"]);
  });

  describe("every completion rule can fail, and can pass", () => {
    it("finish-setup reads the wizard's verdict", () => {
      expect(item(NEW_HOST, "finish-setup").complete).toBe(false);
      expect(item(SET_UP, "finish-setup").complete).toBe(true);
    });

    it("phone needs a PROVED number", () => {
      // The number itself is guaranteed — registration requires it — so "not verified" is the only
      // open state, and the row can never arrive already ticked.
      expect(item(NEW_HOST, "phone").complete).toBe(false);
      expect(item({ ...NEW_HOST, phoneVerified: true }, "phone").complete).toBe(true);
    });

    it("stripe needs the account to be genuinely connected", () => {
      expect(item({ ...NEW_HOST, stripeConnected: false }, "stripe").complete).toBe(false);
      expect(item({ ...NEW_HOST, stripeConnected: true }, "stripe").complete).toBe(true);
    });

    it("publish needs a LIVE kitchen, not merely an existing one", () => {
      // A draft kitchen is invisible to cooks, so ticking this on row-create would be dishonest.
      expect(item({ ...NEW_HOST, hasPublishedKitchen: false }, "publish-kitchen").complete).toBe(false);
      expect(item({ ...NEW_HOST, hasPublishedKitchen: true }, "publish-kitchen").complete).toBe(true);
    });

    it("the listing rows read the readiness payload, and an ABSENT payload is not satisfied", () => {
      expect(item({ ...NEW_HOST, readiness: null }, "photos").complete).toBe(false);
      expect(item({ ...NEW_HOST, readiness: readiness("gallery") }, "photos").complete).toBe(true);
      expect(item({ ...NEW_HOST, readiness: readiness("tours") }, "tours").complete).toBe(true);
      // An unloaded readiness payload must never read as "done".
      expect(item({ ...NEW_HOST, readiness: readiness() }, "photos").complete).toBe(false);
    });

    it("equipment and storage are INDEPENDENT rows", () => {
      // They were one combined row, which named a feature a host might not offer. Each now answers
      // only for itself.
      expect(item({ ...NEW_HOST, readiness: readiness("equipment") }, "equipment").complete).toBe(true);
      expect(item({ ...NEW_HOST, readiness: readiness("equipment") }, "storage").complete).toBe(false);
      expect(item({ ...NEW_HOST, readiness: readiness("storage") }, "equipment").complete).toBe(false);
      expect(item({ ...NEW_HOST, readiness: readiness("storage") }, "storage").complete).toBe(true);
      // And an unrelated recommendation satisfies neither.
      expect(item({ ...NEW_HOST, readiness: readiness("gallery") }, "equipment").complete).toBe(false);
    });

    it("first booking needs a confirmed booking", () => {
      expect(item({ ...NEW_HOST, hasConfirmedBooking: false }, "first-booking").complete).toBe(false);
      expect(item({ ...NEW_HOST, hasConfirmedBooking: true }, "first-booking").complete).toBe(true);
    });
  });

  it("never resurrects the rows that can never be open, or the one that ticked itself", () => {
    const ids = buildGettingStartedItems(NEW_HOST).map((entry) => entry.id);
    // Email verification and the profile photo have no reachable open state.
    expect(ids).not.toContain("verify-email");
    expect(ids).not.toContain("profile");
    // The old backup-sign-in row counted the implicit email link, so it arrived TICKED for a Google
    // registration. The phone replaced it because nothing is proved at registration.
    expect(ids).not.toContain("backup-sign-in");
    // And the combined row is gone.
    expect(ids).not.toContain("add-ons");
  });
});

describe("isItemVisible", () => {
  const fresh: GettingStartedStage = { isSetupComplete: false, phoneVerified: false, isLive: false };
  const setUp: GettingStartedStage = { isSetupComplete: true, phoneVerified: false, isLive: false };
  const live: GettingStartedStage = { isSetupComplete: true, phoneVerified: false, isLive: true };

  it("retires the gateway the moment setup is behind them", () => {
    expect(isItemVisible("finish-setup", fresh)).toBe(true);
    // A gateway, not a task — it goes rather than lingering as a tick nobody can act on.
    expect(isItemVisible("finish-setup", setUp)).toBe(false);
  });

  it("keeps the phone row visible from the first screen onwards", () => {
    // Available while setup is unfinished, and it does NOT vanish with the gateway row beside it.
    expect(isItemVisible("phone", fresh)).toBe(true);
    expect(isItemVisible("phone", setUp)).toBe(true);
    expect(isItemVisible("phone", live)).toBe(true);
  });

  it("holds the two 'what makes you live' rows until setup is done", () => {
    expect(isItemVisible("stripe", fresh)).toBe(false);
    expect(isItemVisible("publish-kitchen", fresh)).toBe(false);
    expect(isItemVisible("stripe", setUp)).toBe(true);
    expect(isItemVisible("publish-kitchen", setUp)).toBe(true);
  });

  it("holds the booked rows until a kitchen is LIVE, and never on the phone", () => {
    // THE TRAP THIS SHAPE AVOIDS: gating the reveal on "has verified their phone" would strand a host
    // whose kitchen is published but whose phone is unproved. Being live is the milestone.
    expect(isItemVisible("photos", setUp)).toBe(false);
    expect(isItemVisible("photos", live)).toBe(true);
    // Being live is enough, even with the phone still unproved.
    expect(live.phoneVerified).toBe(false);
  });
});

describe("visibleGettingStartedItems", () => {
  it("shows the gateway rows only, to a host who is not set up", () => {
    const items = visibleGettingStartedItems(buildGettingStartedItems(NEW_HOST), stageOf(NEW_HOST));

    expect(items.map((entry) => entry.id)).toEqual(["finish-setup", "phone"]);
    // The rows that named work they could not do yet are gone, not merely disabled.
    expect(items.some((entry) => entry.id === "publish-kitchen")).toBe(false);
    expect(items.some((entry) => entry.id === "stripe")).toBe(false);
  });

  it("retires the gateway and keeps the phone row once setup is done", () => {
    const items = visibleGettingStartedItems(buildGettingStartedItems(SET_UP), stageOf(SET_UP));

    expect(items.map((entry) => entry.id)).toEqual(["phone", "stripe", "publish-kitchen"]);
  });

  it("TICKS the phone row rather than removing it, once the number is proved", () => {
    // The row the user asked about: it stays and reads as done — it does not disappear.
    const verified = { ...SET_UP, phoneVerified: true };
    const items = visibleGettingStartedItems(buildGettingStartedItems(verified), stageOf(verified));

    expect(items.map((entry) => entry.id)).toEqual(["phone", "stripe", "publish-kitchen"]);
    expect(items.find((entry) => entry.id === "phone")?.complete).toBe(true);
  });

  it("reveals the booked rows for a LIVE host whose phone is still unproved", () => {
    // The stranding case, asserted: published kitchen + unproved phone still gets the next stage.
    const items = visibleGettingStartedItems(buildGettingStartedItems(LIVE), stageOf(LIVE));

    expect(items.some((entry) => entry.id === "photos")).toBe(true);
    expect(items).toHaveLength(8); // phone + stripe + publish + 5 booked rows
  });

  it("withholds rather than deletes — nothing is lost", () => {
    const all = buildGettingStartedItems(ALL_DONE);
    const live = visibleGettingStartedItems(all, stageOf(ALL_DONE));

    // Every real task survives; only the GATEWAY row is gone, and it is gone by design once passed.
    expect(live).toEqual(all.filter((entry) => entry.id !== "finish-setup"));
    expect(live).toHaveLength(8);
  });

  it("counts progress over the VISIBLE rows only", () => {
    const totalFor = (input: GettingStartedInput) =>
      summarizeGettingStarted(visibleGettingStartedItems(buildGettingStartedItems(input), stageOf(input)))
        .total;

    expect(totalFor(NEW_HOST)).toBe(2);
    expect(totalFor(SET_UP)).toBe(3);
    // Proving the phone TICKS a row; it does not shrink the list.
    expect(totalFor({ ...SET_UP, phoneVerified: true })).toBe(3);
    expect(totalFor(LIVE)).toBe(8);
  });
});

describe("summarizeGettingStarted", () => {
  it("counts honestly and names the first open row", () => {
    const summary = summarizeGettingStarted(buildGettingStartedItems(NEW_HOST));
    expect(summary.total).toBe(9);
    expect(summary.completed).toBe(0);
    expect(summary.nextItem?.id).toBe("finish-setup");
    expect(summary.isComplete).toBe(false);
  });

  it("points at the next OPEN row, not the next row", () => {
    const summary = summarizeGettingStarted(
      buildGettingStartedItems({ ...SET_UP, phoneVerified: true, stripeConnected: true }),
    );
    expect(summary.completed).toBe(3); // finish-setup + phone + stripe
    expect(summary.nextItem?.id).toBe("publish-kitchen");
  });

  it("is complete only when every row is done", () => {
    const summary = summarizeGettingStarted(buildGettingStartedItems(ALL_DONE));
    expect(summary.completed).toBe(9);
    expect(summary.isComplete).toBe(true);
    expect(summary.nextItem).toBeNull();
  });

  it("treats an EMPTY list as broken, not as finished", () => {
    // A failure to load must not hide the checklist by pretending it was completed.
    const summary = summarizeGettingStarted([]);
    expect(summary.isComplete).toBe(false);
    expect(summary.nextItem).toBeNull();
  });
});
