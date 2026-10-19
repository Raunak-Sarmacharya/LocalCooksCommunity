/**
 * Storage board model (WP-ST11). No I/O or React; the clock only labels overdue move-ins.
 *
 * The kitchen's board answers "which unit is in use, and what needs me now" from two read models:
 *  - `GET /api/manager/storage-rentals` → `StorageRental[]` (the readRental DTO, one per rental);
 *  - `GET /api/manager/kitchens/:id/storage-listings` → `StorageListing[]` (unitCount per listing).
 *
 * `unitRows` joins them into one row per physical unit, including the FREE units a rental can never
 * describe on its own. A unit holds at most one rental at a time (the exclusion constraint), so the
 * row is the unit, not the rental; a free unit is a row with `rental: null`.
 */
import type { RentalPhase, RentalState } from "@shared/storage-rental";
import { localToday } from "@shared/storage-rental";

export interface StorageRentalTerm {
  id: number;
  seq: number;
  kind: string;
  startsOn: string;
  endsOn: string;
  days: number;
  dailyPriceCents: number;
  subtotalCents: number;
  taxCents: number;
  serviceFeeCents: number;
  totalCents: number;
  status: string;
  paidAt: string | null;
  payoutEligibleAt: string | null;
  payoutReleasedAt: string | null;
  payoutHoldReason: string | null;
  /** Kitchen net for this term (after the Local Cooks fee); null before payment. */
  payoutCents?: number | null;
}

export interface StorageRental {
  id: number;
  ref: string | null;
  kitchen: { id: number; name: string };
  listing: { id: number; name: string };
  chef: { id: number | null; name: string } | null;
  unitLabel: string;
  state: RentalState;
  /** Kitchen-local IANA zone, for turning deadline/payout instants into kitchen time. */
  timezone: string | null;
  phase: RentalPhase | null;
  startOn: string;
  paidThrough: string;
  graceEndsOn: string;
  holdoverDays: number;
  accruedCents: number;
  holdoverChargeCents?: number;
  removalItemIndexes?: number[];
  responseDeadline: string | null;
  declineReason: string | null;
  needsCleaning: boolean;
  releasedOn: string | null;
  actions: string[];
  rentalTerms: { dailyPriceCents: number; taxRatePercent: number } | null;
  terms: StorageRentalTerm[];
  evidence: {
    checkinPhotoUrls: string[] | null;
    handoverPhotoUrls: string[] | null;
    checkoutPhotoUrls: string[] | null;
  };
}

export interface StorageListing {
  id: number;
  name: string;
  kitchenId: number;
  kitchenName?: string;
  unitCount: number;
  outOfServiceUnits?: Record<string, { reason: string; at: string }>;
  /** False for a draft/inactive listing the board hides unless a rental still occupies a unit. */
  visible?: boolean;
}

/** Every chip a unit row can carry. `free` is the only one with no rental behind it. */
export type UnitChip =
  | "outOfService"
  | "free"
  | "reserved"
  | "moveInOverdue"
  | "occupied"
  | "endingSoon"
  | "grace"
  | "holdover"
  | "moveOutDue"
  | "needsCleaning"
  | "removalReview";

/** The single date a unit row shows, with the sentence that frames it. */
export type UnitDateKey = "startsOn" | "startedOn" | "paidThrough" | "extendBy" | "graceEnded" | "releasedOn";

export interface UnitRow {
  /** Stable across re-renders: listing + unit. */
  key: string;
  listingId: number;
  listingName: string;
  kitchenId: number;
  kitchenName: string;
  unitIndex: number;
  outOfService?: { reason: string; at: string };
  chip: UnitChip;
  rental: StorageRental | null;
  occupantName: string | null;
  date: { key: UnitDateKey; value: string } | null;
  /** Grace, holdover, move-out due, removal review and units waiting to be cleaned. */
  needsAction: boolean;
}

const OCCUPYING_STATES: RentalState[] = ["reserved", "active", "move_out_requested", "removal_review"];
const STATE_PRIORITY: Partial<Record<RentalState, number>> = {
  removal_review: 5,
  move_out_requested: 4,
  active: 3,
  reserved: 2,
  ended: 1,
};

/** A rental claims a unit row while it is reserved/active/ending or until the unit is cleaned. */
export function occupiesUnit(rental: StorageRental): boolean {
  if (OCCUPYING_STATES.includes(rental.state)) return true;
  return rental.state === "ended" && rental.needsCleaning;
}

/** The chip shown for a rental that owns a unit. `ended` here always means "waiting to be cleaned". */
export function chipForRental(rental: StorageRental, now = new Date()): UnitChip {
  switch (rental.state) {
    case "reserved":
      return rental.startOn < localToday(now, rental.timezone || 'America/St_Johns') ? "moveInOverdue" : "reserved";
    case "move_out_requested":
      return "moveOutDue";
    case "removal_review":
      return "removalReview";
    case "ended":
      return "needsCleaning";
    default:
      break;
  }
  if (rental.phase === "grace") return "grace";
  if (rental.phase === "holdover") return "holdover";
  if (rental.phase === "ending_soon") return "endingSoon";
  return "occupied";
}

/** The one date that matters for a chip: what the kitchen acts on next. */
export function unitDateFor(rental: StorageRental, now = new Date()): UnitRow["date"] {
  const chip = chipForRental(rental, now);
  switch (chip) {
    case "reserved":
      return { key: "startsOn", value: rental.startOn };
    case "moveInOverdue":
      return { key: "startedOn", value: rental.startOn };
    case "grace":
      return { key: "extendBy", value: rental.graceEndsOn };
    case "holdover":
      return { key: "graceEnded", value: rental.graceEndsOn };
    case "needsCleaning":
      return { key: "releasedOn", value: rental.releasedOn ?? rental.paidThrough };
    default:
      return { key: "paidThrough", value: rental.paidThrough };
  }
}

const NEEDS_ACTION_CHIPS: UnitChip[] = ["moveInOverdue", "grace", "holdover", "moveOutDue", "needsCleaning", "removalReview"];

export function chipNeedsAction(chip: UnitChip): boolean {
  return NEEDS_ACTION_CHIPS.includes(chip);
}

function unitIndex(rental: StorageRental): number {
  const parsed = Number(rental.unitLabel);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * One row per unit for every listing, in listing order, unit 1..unitCount. A unit with no occupying
 * rental is a FREE row. When (defensively) two rentals claim one unit, the most actionable wins.
 */
export function unitRows(rentals: StorageRental[], listings: StorageListing[], now = new Date()): UnitRow[] {
  const claims = new Map<string, StorageRental>();
  for (const rental of rentals) {
    if (!occupiesUnit(rental)) continue;
    const key = `${rental.listing.id}:${unitIndex(rental)}`;
    const current = claims.get(key);
    const priority = STATE_PRIORITY[rental.state] ?? 0, held = current ? STATE_PRIORITY[current.state] ?? 0 : -1;
    // Same state (a unit reserved back to back): the rental that starts first is the one in the unit now.
    if (!current || priority > held || priority === held && rental.startOn < current.startOn) claims.set(key, rental);
  }
  const rows: UnitRow[] = [];
  for (const listing of listings) {
    const unitCount = Math.max(0, Math.floor(listing.unitCount || 0));
    for (let unit = 1; unit <= unitCount; unit += 1) {
      const rental = claims.get(`${listing.id}:${unit}`) ?? null;
      const outOfService = listing.outOfServiceUnits?.[String(unit)];
      const chip = rental ? chipForRental(rental, now) : outOfService ? "outOfService" : "free";
      rows.push({
        key: `${listing.id}:${unit}`,
        listingId: listing.id,
        listingName: listing.name,
        kitchenId: listing.kitchenId,
        kitchenName: listing.kitchenName ?? "",
        unitIndex: unit,
        chip,
        outOfService,
        rental,
        occupantName: rental?.chef?.name?.trim() || null,
        date: rental ? unitDateFor(rental, now) : null,
        needsAction: chipNeedsAction(chip),
      });
    }
  }
  return rows;
}

export interface BoardSummary {
  units: number;
  occupied: number;
  outOfService: number;
  requests: number;
  grace: number;
  holdover: number;
}

/** The glance line: "Occupied 6 / 8 · 2 requests · 1 in grace · 1 holdover". */
export function boardSummary(rentals: StorageRental[], listings: StorageListing[]): BoardSummary {
  const rows = unitRows(rentals, listings);
  return {
    // A free unit taken out of service can't be rented, so it doesn't count toward capacity.
    units: rows.filter((row) => row.chip !== "outOfService").length,
    occupied: rows.filter((row) => row.rental !== null).length,
    outOfService: rows.filter((row) => row.chip === "outOfService").length,
    requests: rentals.filter((rental) => rental.state === "requested").length,
    grace: rows.filter((row) => row.chip === "grace").length,
    holdover: rows.filter((row) => row.chip === "holdover").length,
  };
}

/** Open requests, soonest answer deadline first — the board answers these before anything else. */
export function pendingRequests(rentals: StorageRental[]): StorageRental[] {
  return rentals
    .filter((rental) => rental.state === "requested")
    .sort((a, b) => (a.responseDeadline ?? "").localeCompare(b.responseDeadline ?? ""));
}

/** What the chef's card is charged (or held) for a request: the sum of its terms. */
export function rentalTotalCents(rental: StorageRental): number {
  return rental.terms.reduce((sum, term) => sum + term.totalCents, 0);
}

/** Which filter tab a unit row belongs to. */
export type BoardFilter = "all" | "needsAction" | "free" | "past";

export function filterUnitRows(rows: UnitRow[], filter: BoardFilter): UnitRow[] {
  if (filter === "past") return [];
  if (filter === "needsAction") return rows.filter((row) => row.needsAction);
  if (filter === "free") return rows.filter((row) => row.chip === "free");
  return rows;
}

export function groupRowsByListing(rows: UnitRow[]): Array<{ listingId: number; listingName: string; kitchenName: string; rows: UnitRow[] }> {
  const groups: Array<{ listingId: number; listingName: string; kitchenName: string; rows: UnitRow[] }> = [];
  for (const row of rows) {
    const group = groups.find((item) => item.listingId === row.listingId);
    if (group) group.rows.push(row);
    else groups.push({ listingId: row.listingId, listingName: row.listingName, kitchenName: row.kitchenName, rows: [row] });
  }
  return groups;
}

/** Payout status the kitchen sees for one paid term. */
export type PayoutStatus = "none" | "scheduled" | "paid" | "hold";

export interface TermPayout {
  status: PayoutStatus;
  amountCents: number;
  /** ISO instant for scheduled/paid; null otherwise. */
  at: string | null;
}

export function termPayout(term: StorageRentalTerm): TermPayout {
  // The kitchen is paid its net (after the Local Cooks fee), never the chef's total.
  const amountCents = term.payoutCents ?? term.totalCents;
  if (term.status !== "paid") return { status: "none", amountCents, at: null };
  if (term.payoutReleasedAt) return { status: "paid", amountCents, at: term.payoutReleasedAt };
  if (term.payoutHoldReason) return { status: "hold", amountCents, at: null };
  if (term.payoutEligibleAt) return { status: "scheduled", amountCents, at: term.payoutEligibleAt };
  return { status: "none", amountCents, at: null };
}

/** Which input fields a More-menu action asks for, before its confirm sheet. */
export type StorageActionField = "unitIndex" | "byDate" | "days" | "amountCents" | "note" | "photoUrls";

export interface StorageActionDef {
  action: string;
  labelKey: string;
  consequenceKey: string;
  requiresReason: boolean;
  fields: StorageActionField[];
  /** Defaults the confirm sheet prefills (e.g. accrued holdover, full term charge). */
  defaults: Partial<Record<StorageActionField, number>>;
}

/**
 * The kitchen tools the DTO advertises in `actions[]`. The More menu renders only the actions the
 * server sends, so a tool appears exactly when its endpoint exists.
 */
const ACTION_DEFS: Record<string, StorageActionDef> = {
  approve: { action: "approve", labelKey: "stActionApprove", consequenceKey: "stConsequenceApprove", requiresReason: false, fields: [], defaults: {} },
  decline: { action: "decline", labelKey: "stActionDecline", consequenceKey: "stConsequenceDecline", requiresReason: true, fields: [], defaults: {} },
  "change-unit": { action: "change-unit", labelKey: "stActionChangeUnit", consequenceKey: "stConsequenceChangeUnit", requiresReason: true, fields: ["unitIndex"], defaults: {} },
  "move-out-by": { action: "move-out-by", labelKey: "stActionMoveOutBy", consequenceKey: "stConsequenceMoveOutBy", requiresReason: true, fields: ["byDate"], defaults: {} },
  "offer-extension": { action: "offer-extension", labelKey: "stActionOfferExtension", consequenceKey: "stConsequenceOfferExtension", requiresReason: false, fields: ["days"], defaults: { days: 7 } },
  "release": { action: "release", labelKey: "stActionReleaseUnit", consequenceKey: "stConsequenceReleaseUnit", requiresReason: true, fields: [], defaults: {} },
  refund: { action: "refund", labelKey: "stActionRefund", consequenceKey: "stConsequenceRefund", requiresReason: true, fields: ["amountCents"], defaults: {} },
  "holdover-charge": { action: "holdover-charge", labelKey: "stActionHoldoverCharge", consequenceKey: "stConsequenceHoldoverCharge", requiresReason: false, fields: ["amountCents", "note"], defaults: {} },
  "holdover-waive": { action: "holdover-waive", labelKey: "stActionWaiveHoldover", consequenceKey: "stConsequenceWaiveHoldover", requiresReason: true, fields: [], defaults: {} },
  "removal/record": { action: "removal/record", labelKey: "stActionRecordRemoval", consequenceKey: "stConsequenceRecordRemoval", requiresReason: true, fields: [], defaults: {} },
  "mark-ready": { action: "mark-ready", labelKey: "stActionMarkReady", consequenceKey: "stConsequenceMarkReady", requiresReason: false, fields: [], defaults: {} },
  handover: { action: "handover", labelKey: "stActionHandover", consequenceKey: "stConsequenceHandover", requiresReason: false, fields: ["note", "photoUrls"], defaults: {} },
  "clear-move-out": { action: "clear-move-out", labelKey: "stActionClearMoveOut", consequenceKey: "stConsequenceClearMoveOut", requiresReason: false, fields: [], defaults: {} },
  "items-still-here": { action: "items-still-here", labelKey: "stActionItemsStillHere", consequenceKey: "stConsequenceItemsStillHere", requiresReason: false, fields: ["note", "photoUrls"], defaults: {} },
};

/** Every action the board can describe, newest-first order irrelevant. Used by tests and the menu. */
export function actionDef(action: string): StorageActionDef {
  return ACTION_DEFS[action] ?? {
    action,
    labelKey: "stActionGeneric",
    consequenceKey: "stConsequenceGeneric",
    requiresReason: true,
    fields: ["note"],
    defaults: {},
  };
}

/** The actions the server allows, in the order the DTO sent them, each with its descriptor. */
export function allowedActions(rental: StorageRental): StorageActionDef[] {
  return rental.actions.map(actionDef);
}

/** An instant (deadline, payout) in the kitchen's zone — "Oct 17, 2026, 9:30 a.m." */
export function formatKitchenDateTime(iso: string, timezone?: string | null, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: timezone || undefined }).format(new Date(iso));
}

/**
 * The amount shown on a confirm sheet, in cents, given the action and the values the kitchen typed.
 * Approve/decline use the whole request; holdover defaults to what has accrued; an extension is
 * priced from the frozen daily rate.
 */
export function actionAmountCents(rental: StorageRental, def: StorageActionDef, values: Partial<Record<StorageActionField, number>>): number | null {
  if (def.action === "approve" || def.action === "decline") return rentalTotalCents(rental);
  if (def.action === "holdover-charge") return values.amountCents ?? (rental.holdoverChargeCents ?? rental.accruedCents);
  if (def.action === "holdover-waive") return (rental.holdoverChargeCents ?? rental.accruedCents);
  if (def.action === "offer-extension") {
    const days = values.days ?? def.defaults.days ?? 0;
    const daily = rental.rentalTerms?.dailyPriceCents ?? 0;
    const taxRate = rental.rentalTerms?.taxRatePercent ?? 0;
    const subtotal = days * daily;
    return subtotal + Math.round((subtotal * taxRate) / 100);
  }
  if (def.fields.includes("amountCents")) return values.amountCents ?? def.defaults.amountCents ?? null;
  return null;
}

/** The body the confirm sheet POSTs to `/api/manager/storage-rentals/:id/:action` (WP-ST9 shapes). */
export function actionBody(def: StorageActionDef, values: Partial<Record<StorageActionField, number | string>>, reason: string): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (def.fields.includes("unitIndex") && values.unitIndex != null) body.unitIndex = Number(values.unitIndex);
  if (def.fields.includes("byDate") && values.byDate) body.byDate = String(values.byDate);
  if (def.fields.includes("days") && values.days != null) body.days = Number(values.days);
  if (def.fields.includes("amountCents") && values.amountCents != null) body.amountCents = Number(values.amountCents);
  if (def.fields.includes("note") && reason.trim()) body.note = reason.trim();
  if (def.requiresReason) body.reason = reason.trim();
  if (def.fields.includes("photoUrls")) body.photoUrls = String(values.photoUrls ?? "").split(/\s+/).filter(Boolean);
  if (def.action === "clear-move-out") body.needsCleaning = false;
  return body;
}
