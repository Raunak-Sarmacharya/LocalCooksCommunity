import { supportActionInput, type SupportActionInput, type SupportActionType } from "@shared/booking-support";
import type { ActingFor, RequestSource, SupportCase } from "./types";

export const REQUEST_SOURCES: RequestSource[] = ["call", "message", "email", "in_person", "proactive"];

export type FieldId =
  | "items" | "quote" | "codeTarget" | "arrival" | "visit" | "actualAt" | "attendance"
  | "claim" | "amount" | "resend" | "flag" | "message" | "fundKitchenRefund" | "refundOperation";

type Spec = {
  acting: ActingFor[];
  reasons: string[];
  fields: FieldId[];
  /** Who is told: both sides (each in its own words), the chef only, the kitchen only, or nobody (internal). */
  notifies: false | "both" | "chef" | "kitchen";
};

const M: ActingFor[] = ["manager"];
const C: ActingFor[] = ["chef"];
const ANY: ActingFor[] = ["local_cooks", "manager", "chef"];

export const ACTION_SPECS: Record<SupportActionType, Spec> = {
  retry_refund: { acting: ["local_cooks"], reasons: ["payment_problem", "internal_review", "other"], fields: ["refundOperation"], notifies: "both" },
  mark_refunded: { acting: ["local_cooks"], reasons: ["internal_review", "other"], fields: ["refundOperation"], notifies: "both" },
  confirm_for_manager: { acting: M, reasons: ["manager_asked", "no_response_from_manager", "other"], fields: ["items"], notifies: "both" },
  decline_for_manager: { acting: M, reasons: ["manager_asked", "kitchen_could_not_serve", "other"], fields: [], notifies: "both" },
  release_hold_for_chef: { acting: C, reasons: ["customer_asked", "kitchen_could_not_serve", "other"], fields: [], notifies: "both" },
  accept_proposal_for_chef: { acting: C, reasons: ["customer_asked", "other"], fields: [], notifies: "both" },
  replay_payment_decision: { acting: ANY, reasons: ["payment_problem", "other"], fields: [], notifies: "both" },
  cancel_kitchen_caused: { acting: M, reasons: ["kitchen_could_not_serve", "safety_concern", "other"], fields: [], notifies: "both" },
  refund_captured_request: { acting: M, reasons: ["payment_problem", "customer_asked", "other"], fields: [], notifies: "both" },
  finish_kitchen_refund: { acting: M, reasons: ["payment_problem", "internal_review", "other"], fields: ["fundKitchenRefund"], notifies: "chef" },
  request_cancellation_for_chef: { acting: C, reasons: ["customer_asked", "other"], fields: ["message"], notifies: "both" },
  accept_cancellation_for_manager: { acting: M, reasons: ["manager_asked", "other"], fields: ["quote"], notifies: "both" },
  issue_visit_code: { acting: M, reasons: ["arrival_problem", "other"], fields: ["codeTarget"], notifies: "both" },
  set_arrival_mode: { acting: M, reasons: ["arrival_problem", "manager_asked", "other"], fields: ["arrival", "message"], notifies: "both" },
  record_assisted_arrival: { acting: M, reasons: ["arrival_problem", "manager_asked", "other"], fields: ["visit", "actualAt", "message"], notifies: "both" },
  correct_attendance: { acting: ANY, reasons: ["record_correction", "manager_asked", "customer_asked", "other"], fields: ["visit", "attendance", "message"], notifies: "both" },
  clear_checkout_for_manager: { acting: M, reasons: ["manager_asked", "other"], fields: ["visit", "message"], notifies: "both" },
  report_issue_for_manager: { acting: M, reasons: ["manager_asked", "safety_concern", "other"], fields: ["visit", "claim", "message"], notifies: "both" },
  goodwill_refund: { acting: ["local_cooks"], reasons: ["service_recovery", "payment_problem", "customer_asked", "other"], fields: ["amount"], notifies: "chef" },
  resend_notice: { acting: ANY, reasons: ["notice_not_received", "other"], fields: ["resend"], notifies: false },
  open_flag: { acting: ANY, reasons: ["internal_review", "payment_problem", "safety_concern", "other"], fields: [], notifies: false },
  resolve_flag: { acting: ANY, reasons: ["internal_review", "other"], fields: ["flag"], notifies: false },
  release_payout: { acting: ["local_cooks"], reasons: ["internal_review", "other"], fields: [], notifies: "kitchen" },
  resolve_money_attempt: { acting: ["local_cooks"], reasons: ["payment_problem", "internal_review", "other"], fields: [], notifies: false },
};

export type ActionForm = {
  actingFor: ActingFor; requestSource: RequestSource; sourceRef: string;
  reason: string; reasonOther: string; note: string;
  amount: string; message: string; refundOperation: string;
  itemDecisions: Record<string, "confirmed" | "cancelled">;
  visitId: string; targetKey: string; allTargets: boolean; mode: "staffed" | "self";
  actualAt: string; attendanceAction: "report_no_show" | "report_attended" | "withdraw_attendance"; confirmsChefAbsent: boolean;
  claimTitle: string; claimDescription: string; claimedAmount: string;
  eventId: string; recipientId: string; force: boolean; flagId: string; fundByLocalCooks: boolean;
};

export const pendingItems = (c: SupportCase) => [
  ...c.items.storage.filter((i) => i.status === "pending").map((i) => ({ ...i, key: `storage:${i.id}`, kind: "storage" as const })),
  ...c.items.equipment.filter((i) => i.status === "pending").map((i) => ({ ...i, key: `equipment:${i.id}`, kind: "equipment" as const })),
];
export const eligibleCodeTargets = (c: SupportCase) => c.visitCodes.filter((v) => !v.consumed && !v.revoked);
export const lifecycleEvents = (c: SupportCase) =>
  c.chronology.filter((e): e is Extract<SupportCase["chronology"][number], { source: "lifecycle" }> => e.source === "lifecycle");

export function initialForm(type: SupportActionType, c: SupportCase): ActionForm {
  const spec = ACTION_SPECS[type];
  const visit = type === "clear_checkout_for_manager" || type === "report_issue_for_manager"
    ? c.visits.find((v) => v.checkoutRequestedAt && !v.checkoutApprovedAt) ?? c.visits[0]
    : type === "record_assisted_arrival" ? c.visits.find((v) => !v.checkedInAt) ?? c.visits[0] : c.visits[0];
  const targets = eligibleCodeTargets(c);
  return {
    actingFor: spec.acting[0], requestSource: "call", sourceRef: "", reason: spec.reasons[0], reasonOther: "", note: "",
    amount: "", message: "", refundOperation: (c.refundOperations || []).find(row => type !== "mark_refunded" || row.hasReceipt)?.refundOperationId || "",
    itemDecisions: Object.fromEntries(pendingItems(c).map((i) => [i.key, "confirmed" as const])),
    visitId: visit ? String(visit.id) : "", targetKey: targets[0]?.targetKey ?? "", allTargets: false, mode: "staffed",
    actualAt: "", attendanceAction: "report_attended", confirmsChefAbsent: false,
    claimTitle: "", claimDescription: "", claimedAmount: "",
    eventId: "", recipientId: "", force: false, flagId: c.flags[0] ? String(c.flags[0].id) : "", fundByLocalCooks: false,
  };
}

/** Parses a dollar amount like "12.50" into cents. Returns null when it is not a plain positive amount. */
export function dollarsToCents(text: string): number | null {
  const t = text.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const cents = Math.round(parseFloat(t) * 100);
  return cents > 0 ? cents : null;
}

/** Converts a "YYYY-MM-DDTHH:mm" wall-clock time in the given IANA zone into a UTC ISO string. */
export function zonedLocalToIso(local: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const offsetAt = (ms: number) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms));
    const g = (k: string) => Number(parts.find((p) => p.type === k)!.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - ms;
  };
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let utc = guess - offsetAt(guess);
  utc = guess - offsetAt(utc);
  const date = new Date(utc);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export type BuildResult =
  | { ok: true; body: SupportActionInput; needsException: boolean }
  | { ok: false; errors: Record<string, string> };

const between = (s: string, min: number, max: number) => s.trim().length >= min && s.trim().length <= max;

export function buildActionRequest(
  type: SupportActionType, c: SupportCase, form: ActionForm, operationKey: string, confirmException: boolean,
): BuildResult {
  const spec = ACTION_SPECS[type];
  const errors: Record<string, string> = {};
  const details: NonNullable<SupportActionInput["details"]> = {};
  const preview = c.availableActions.find((a) => a.type === type)?.moneyPreview;
  let amountCents: number | undefined;
  let needsException = false;

  const reasonCode = form.reason === "other" ? `other: ${form.reasonOther.trim()}`.slice(0, 100) : form.reason;
  if (form.reason === "other" && form.reasonOther.trim().length < 3) errors.reason = "bsErrReasonOther";
  if (!between(form.note, 10, 2000)) errors.note = "bsErrNote";
  if (form.sourceRef.trim().length > 500) errors.sourceRef = "bsErrSourceRef";

  const message = form.message.trim();
  const selfArrival = type === "set_arrival_mode" && !form.allTargets && form.mode === "self";
  if (message && !between(message, 10, selfArrival ? 500 : 2000)) errors.message = selfArrival ? "bsErrMessageShort500" : "bsErrMessageShort";

  const visit = c.visits.find((v) => String(v.id) === form.visitId);
  if (spec.fields.includes("visit") && c.visits.length > 0 && !visit) errors.visitId = "bsErrChooseVisit";

  for (const field of spec.fields) {
    if (field === "refundOperation") {
      const target = c.refundOperations?.find(row => row.refundOperationId === form.refundOperation && (type !== "mark_refunded" || row.hasReceipt));
      if (!target) errors.form = "bsErrRefundOperation";
      else { details.transactionId = target.transactionId; details.refundOperationId = target.refundOperationId; }
    }
    if (field === "items") {
      const decide = (kind: "storage" | "equipment") => pendingItems(c).filter((i) => i.kind === kind)
        .map((i) => ({ id: i.id, action: form.itemDecisions[i.key] ?? ("confirmed" as const) }));
      const storageActions = decide("storage"), equipmentActions = decide("equipment");
      if (storageActions.length) details.storageActions = storageActions;
      if (equipmentActions.length) details.equipmentActions = equipmentActions;
    }
    if (field === "quote") {
      if (!c.cancellationQuote) errors.quote = "bsErrNoQuote"; else details.quoteHash = c.cancellationQuote.quoteHash;
    }
    if (field === "codeTarget") {
      if (c.visitCodes.length > 0) {
        if (!eligibleCodeTargets(c).some((t) => t.targetKey === form.targetKey)) errors.targetKey = "bsErrChooseTarget"; else details.targetKey = form.targetKey;
      } else if (c.visits.length > 0) {
        if (!visit) errors.visitId = "bsErrChooseVisit"; else details.visitId = visit.id;
      }
    }
    if (field === "arrival") {
      details.mode = form.mode;
      if (form.allTargets) details.all = true;
      else if (!eligibleCodeTargets(c).some((t) => t.targetKey === form.targetKey)) errors.targetKey = "bsErrChooseTarget";
      else details.targetKey = form.targetKey;
      if (selfArrival && !between(message, 10, 500)) errors.message = "bsErrSelfMessage";
    }
    if (field === "visit") {
      if (visit) {
        details.visitId = visit.id;
        if (type === "record_assisted_arrival" || type === "correct_attendance") {
          details.expectedUpdatedAt = visit.updatedAt;
          details.expectedBookingUpdatedAt = c.updatedAt;
        }
      } else if (type === "record_assisted_arrival" || type === "correct_attendance") {
        details.expectedBookingUpdatedAt = c.updatedAt;
      }
    }
    if (field === "actualAt") {
      const iso = form.actualAt ? zonedLocalToIso(form.actualAt, c.schedule.timezone) : null;
      if (!iso) errors.actualAt = "bsErrActualAt"; else details.actualAt = iso;
    }
    if (field === "attendance") {
      details.attendanceAction = form.attendanceAction;
      if (form.attendanceAction === "report_no_show") {
        if (!form.confirmsChefAbsent) errors.confirmsChefAbsent = "bsErrConfirmAbsent"; else details.confirmsChefAbsent = true;
      }
    }
    if (field === "claim") {
      if (!between(form.claimTitle, 5, 200)) errors.claimTitle = "bsErrClaimTitle"; else details.claimTitle = form.claimTitle.trim();
      if (!between(form.claimDescription, 50, 2000)) errors.claimDescription = "bsErrClaimDescription"; else details.claimDescription = form.claimDescription.trim();
      if (form.claimedAmount.trim()) {
        const cents = dollarsToCents(form.claimedAmount);
        if (cents === null) errors.claimedAmount = "bsErrAmount"; else details.claimedAmountCents = cents;
      }
    }
    if (field === "amount") {
      const cents = dollarsToCents(form.amount);
      if (cents === null) errors.amount = "bsErrAmount";
      else if (preview?.maximumCents != null && cents > preview.maximumCents) errors.amount = "bsErrAmountMax";
      else {
        amountCents = cents;
        needsException = preview?.requiresExceptionAboveCents != null && cents > preview.requiresExceptionAboveCents;
      }
    }
    if (field === "resend") {
      const eventId = parseInt(form.eventId, 10), recipientId = parseInt(form.recipientId, 10);
      if (!eventId) errors.eventId = "bsErrChooseEvent"; else details.eventId = eventId;
      if (!recipientId) errors.recipientId = "bsErrChooseRecipient"; else details.recipientId = recipientId;
      details.force = form.force;
    }
    if (field === "fundKitchenRefund" && form.fundByLocalCooks) details.fundedByLocalCooks = true;
    if (field === "flag") {
      const flagId = parseInt(form.flagId, 10);
      if (!flagId) errors.flagId = "bsErrChooseFlag"; else details.flagId = flagId;
    }
  }
  if (message && spec.fields.includes("message") && !errors.message) details.publicMessage = message;
  if (Object.keys(errors).length) return { ok: false, errors };

  const body: SupportActionInput = {
    type, actingFor: form.actingFor, requestSource: form.requestSource,
    ...(form.sourceRef.trim() ? { sourceRef: form.sourceRef.trim() } : {}),
    reasonCode, note: form.note.trim(), operationKey,
    ...(amountCents ? { amountCents } : {}),
    ...(needsException && confirmException ? { confirmException: true } : {}),
    ...(Object.keys(details).length ? { details } : {}),
  };
  const parsed = supportActionInput.safeParse(body);
  if (!parsed.success) return { ok: false, errors: { form: "bsErrInvalid" } };
  return { ok: true, body: parsed.data, needsException };
}

type Preview = SupportCase["availableActions"][number]["moneyPreview"];

/** Goodwill previews follow the amount typed into the dialog; manager cost stays zero. */
export function previewForDisplay(type: SupportActionType, preview: Preview, amountText: string): Preview {
  if (type !== "goodwill_refund") return preview;
  const cents = dollarsToCents(amountText);
  return { ...preview, chefReceivesCents: cents, localCooksPaysCents: cents, managerPaysCents: 0 };
}
