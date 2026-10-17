import { describe, expect, it } from "vitest";
import {
  actionAmountCents, actionBody, actionDef, allowedActions, boardSummary, chipForRental, filterUnitRows,
  groupRowsByListing, occupiesUnit, pendingRequests, rentalTotalCents, termPayout, unitRows,
  type StorageListing, type StorageRental, type StorageRentalTerm,
} from "./storage-board";

const term = (over: Partial<StorageRentalTerm> = {}): StorageRentalTerm => ({
  id: 1, seq: 1, kind: "first", startsOn: "2026-10-01", endsOn: "2026-10-03", days: 3,
  dailyPriceCents: 1000, subtotalCents: 3000, taxCents: 450, serviceFeeCents: 100, totalCents: 3550,
  status: "paid", paidAt: "2026-10-01T00:00:00Z", payoutEligibleAt: null, payoutReleasedAt: null, payoutHoldReason: null,
  ...over,
});

const rental = (over: Partial<StorageRental> = {}): StorageRental => ({
  id: 1, ref: "SB-1", kitchen: { id: 1, name: "Harbour" }, listing: { id: 1, name: "Shelf" },
  chef: { id: 3, name: "Morgan Lee" }, unitLabel: "1", state: "active", phase: "current",
  timezone: "America/St_Johns",
  startOn: "2026-10-01", paidThrough: "2026-10-10", graceEndsOn: "2026-10-15", holdoverDays: 0, accruedCents: 0,
  responseDeadline: null, declineReason: null, needsCleaning: false, releasedOn: null, actions: [],
  rentalTerms: { dailyPriceCents: 1000, taxRatePercent: 15 }, terms: [term()],
  evidence: { checkinPhotoUrls: null, handoverPhotoUrls: null, checkoutPhotoUrls: null },
  ...over,
});

const listing = (over: Partial<StorageListing> = {}): StorageListing => ({ id: 1, name: "Shelf", kitchenId: 1, unitCount: 1, ...over });

describe("unitRows", () => {
  it("lists every unit including the free ones, and pairs an occupant with their unit", () => {
    const rows = unitRows([rental({ unitLabel: "2", state: "reserved", phase: null })], [listing({ unitCount: 3 })]);
    expect(rows.map((row) => [row.unitIndex, row.chip])).toEqual([[1, "free"], [2, "reserved"], [3, "free"]]);
    expect(rows[0].rental).toBeNull();
    expect(rows[0].occupantName).toBeNull();
    expect(rows[1].occupantName).toBe("Morgan Lee");
    expect(rows[1].date).toEqual({ key: "startsOn", value: "2026-10-01" });
    expect(rows[1].needsAction).toBe(false);
  });

  it("keeps a pending request off the unit grid — it is answered in the Requests section", () => {
    expect(occupiesUnit(rental({ state: "requested" }))).toBe(false);
    const rows = unitRows([rental({ state: "requested", unitLabel: "1" })], [listing({ unitCount: 1 })]);
    expect(rows.map((row) => row.chip)).toEqual(["free"]);
  });

  it("holds a unit until it is cleaned, and frees it once cleaning is done", () => {
    expect(occupiesUnit(rental({ state: "ended", needsCleaning: true }))).toBe(true);
    expect(occupiesUnit(rental({ state: "ended", needsCleaning: false }))).toBe(false);
    const rows = unitRows([rental({ state: "ended", needsCleaning: true, releasedOn: "2026-10-09" })], [listing()]);
    expect(rows[0].chip).toBe("needsCleaning");
    expect(rows[0].date).toEqual({ key: "releasedOn", value: "2026-10-09" });
    expect(rows[0].needsAction).toBe(true);
  });

  it("groups by listing, in listing order, and picks the most actionable claim when two overlap", () => {
    const rows = unitRows(
      [
        rental({ id: 1, listing: { id: 2, name: "Cold room" }, unitLabel: "1", state: "reserved", phase: null }),
        rental({ id: 2, listing: { id: 1, name: "Shelf" }, unitLabel: "1", state: "active", phase: "grace" }),
      ],
      [listing({ id: 1, name: "Shelf", unitCount: 1 }), listing({ id: 2, name: "Cold room", unitCount: 1 })],
    );
    expect(rows.map((row) => row.listingId)).toEqual([1, 2]);
    expect(rows[0].chip).toBe("grace");
    expect(groupRowsByListing(rows).map((group) => group.listingName)).toEqual(["Shelf", "Cold room"]);
  });
});

describe("chips, dates and filters", () => {
  it("maps state and phase to the chip the kitchen acts on", () => {
    expect(chipForRental(rental({ state: "reserved", phase: null }))).toBe("reserved");
    expect(chipForRental(rental({ state: "move_out_requested" }))).toBe("moveOutDue");
    expect(chipForRental(rental({ state: "removal_review" }))).toBe("removalReview");
    expect(chipForRental(rental({ state: "active", phase: "ending_soon" }))).toBe("endingSoon");
    expect(chipForRental(rental({ state: "active", phase: "grace" }))).toBe("grace");
    expect(chipForRental(rental({ state: "active", phase: "holdover" }))).toBe("holdover");
    expect(chipForRental(rental({ state: "active", phase: "current" }))).toBe("occupied");
  });

  it("shows the extend-by date in grace and the grace end once in holdover", () => {
    const rows = unitRows([rental({ phase: "grace", graceEndsOn: "2026-10-15" })], [listing()]);
    expect(rows[0].date).toEqual({ key: "extendBy", value: "2026-10-15" });
    const holdover = unitRows([rental({ phase: "holdover", graceEndsOn: "2026-10-15" })], [listing()]);
    expect(holdover[0].date).toEqual({ key: "graceEnded", value: "2026-10-15" });
    expect(holdover[0].needsAction).toBe(true);
  });

  it("filters to needs-action and free rows", () => {
    const rows = unitRows(
      [
        rental({ id: 1, unitLabel: "1", phase: "holdover" }),
        rental({ id: 2, unitLabel: "2", state: "reserved", phase: null }),
      ],
      [listing({ unitCount: 4 })],
    );
    expect(filterUnitRows(rows, "needsAction").map((row) => row.unitIndex)).toEqual([1]);
    expect(filterUnitRows(rows, "free").map((row) => row.unitIndex)).toEqual([3, 4]);
    expect(filterUnitRows(rows, "all")).toHaveLength(4);
  });
});

describe("board summary and requests", () => {
  it("counts occupied units, requests, grace and holdover for the glance strip", () => {
    const summary = boardSummary(
      [
        rental({ id: 1, unitLabel: "1", state: "reserved", phase: null }),
        rental({ id: 2, unitLabel: "2", phase: "grace" }),
        rental({ id: 3, unitLabel: "3", phase: "holdover" }),
        rental({ id: 4, state: "requested", phase: null }),
      ],
      [listing({ unitCount: 8 })],
    );
    expect(summary).toEqual({ units: 8, occupied: 3, requests: 1, grace: 1, holdover: 1 });
  });

  it("orders requests by their answer deadline and sums the charge", () => {
    const late = rental({ id: 2, state: "requested", responseDeadline: "2026-10-18T12:00:00Z", terms: [term({ totalCents: 2000 })] });
    const soon = rental({ id: 1, state: "requested", responseDeadline: "2026-10-17T12:00:00Z", terms: [term({ totalCents: 3550 })] });
    expect(pendingRequests([late, soon]).map((row) => row.id)).toEqual([1, 2]);
    expect(rentalTotalCents(soon)).toBe(3550);
  });
});

describe("More-menu actions", () => {
  it("renders only the actions the server allowed, in order", () => {
    const defs = allowedActions(rental({ actions: ["refund", "holdover-waive"] }));
    expect(defs.map((def) => def.action)).toEqual(["refund", "holdover-waive"]);
    expect(defs.map((def) => def.labelKey)).toEqual(["stActionRefund", "stActionWaiveHoldover"]);
    expect(allowedActions(rental({ actions: [] }))).toEqual([]);
  });

  it("prices the consequence: full charge to approve, accrued to charge holdover, days to extend", () => {
    expect(actionAmountCents(rental(), actionDef("approve"), {})).toBe(3550);
    expect(actionAmountCents(rental({ accruedCents: 1150 }), actionDef("holdover-charge"), {})).toBe(1150);
    expect(actionAmountCents(rental({ rentalTerms: { dailyPriceCents: 1000, taxRatePercent: 15 } }), actionDef("offer-extension"), { days: 7 })).toBe(8050);
  });

  it("builds the WP-ST9 body from the fields the sheet collected", () => {
    expect(actionBody(actionDef("change-unit"), { unitIndex: 4 }, "damaged shelf")).toEqual({ unitIndex: 4, reason: "damaged shelf" });
    expect(actionBody(actionDef("move-out-by"), { byDate: "2026-10-20" }, "need the space")).toEqual({ byDate: "2026-10-20", reason: "need the space" });
    expect(actionBody(actionDef("offer-extension"), { days: 14 }, "")).toEqual({ days: 14 });
    expect(actionBody(actionDef("refund"), { amountCents: 500 }, "goodwill")).toEqual({ amountCents: 500, reason: "goodwill" });
  });

  it("falls back to a reason-only sheet for an action it does not know", () => {
    const def = actionDef("future-tool");
    expect(def.requiresReason).toBe(true);
    expect(def.labelKey).toBe("stActionGeneric");
  });
});

describe("term payout status", () => {
  it("reports scheduled, paid and on-hold terms", () => {
    expect(termPayout(term({ payoutEligibleAt: "2026-10-11T02:30:00Z" }))).toMatchObject({ status: "scheduled", amountCents: 3550 });
    expect(termPayout(term({ payoutReleasedAt: "2026-10-12T02:30:00Z" }))).toMatchObject({ status: "paid" });
    expect(termPayout(term({ payoutEligibleAt: "2026-10-11T02:30:00Z", payoutCents: 3340 }))).toMatchObject({ status: "scheduled", amountCents: 3340 });
    expect(termPayout(term({ payoutEligibleAt: "2026-10-11T02:30:00Z", payoutHoldReason: "problem_open" }))).toMatchObject({ status: "hold" });
    expect(termPayout(term({ status: "authorized" }))).toMatchObject({ status: "none" });
  });
});


it("shows out-of-service units without evicting renters or counting empty broken units as occupied", () => {
  const units = { "1": { reason: "Repair", at: "2026-10-16" }, "2": { reason: "Repair", at: "2026-10-16" } };
  const rows = unitRows([rental()], [listing({ unitCount: 3, outOfServiceUnits: units })]);
  expect(rows.map(row => row.chip)).toEqual(["occupied", "outOfService", "free"]);
  expect(rows[0].outOfService?.reason).toBe("Repair");
  expect(rows[0].rental?.id).toBe(1);
  expect(filterUnitRows(rows, "free")).toHaveLength(1);
  expect(boardSummary([rental()], [listing({ unitCount: 3, outOfServiceUnits: units })]).occupied).toBe(1);
});
