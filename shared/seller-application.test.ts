import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { sellerDocuments, sellerProgress } from "./seller-application";

const app = (extra: Record<string, unknown> = {}) => ({ status: "inReview", kitchenPreference: "commercial", commercialKitchen: "other", documentsRequested: [], ...extra });
const kinds = (a: ReturnType<typeof app>) => sellerDocuments(a).map((doc) => `${doc.kind}${doc.recommended ? " (recommended)" : ""}`);
const at = (a: ReturnType<typeof app>, opts?: { stripeConnected?: boolean }) => {
  const progress = sellerProgress(a, opts);
  return [progress.current, progress.steps.map((step) => step.state[0]).join("")];
};

describe("documents per kitchen setting", () => {
  it("commercial: approved-course certificate + that kitchen's licence; a Local Cooks kitchen already has its licence", () => {
    expect(kinds(app())).toEqual(["foodSafetyTraining", "establishmentLicence"]);
    expect(kinds(app({ commercialKitchen: "localcooks" }))).toEqual(["foodSafetyTraining"]);
  });
  it("home: Service NL registration, food safety recommended; not sure: food safety only", () => {
    expect(kinds(app({ kitchenPreference: "home" }))).toEqual(["foodSafety (recommended)", "homeRegistration"]);
    expect(kinds(app({ kitchenPreference: "notSure" }))).toEqual(["foodSafety"]);
  });
  it("a file already on file, or a request, keeps the kitchen slot visible", () => {
    expect(kinds(app({ kitchenPreference: "notSure", foodEstablishmentCertUrl: "x" }))).toEqual(["foodSafety", "establishmentLicence"]);
    expect(sellerDocuments(app({ kitchenPreference: "notSure", documentsRequested: ["kitchen"] }))[1].state).toBe("requested");
  });
});

describe("where the chef is (current step, then a/c/d/s/p/o as done/current/upcoming)", () => {
  it("just applied: the call", () => expect(at(app())).toEqual(["call", "dcuuuu"]));
  it("documents asked for: owed until uploaded, then with Local Cooks to check", () => {
    const asked = { documentsRequested: ["foodSafety"], documentsRequestedAt: new Date() };
    expect(at(app(asked))).toEqual(["documents", "ddcuuu"]);
    expect(sellerProgress(app(asked)).owed.map((doc) => doc.key)).toEqual(["foodSafety"]);
    expect(at(app({ ...asked, foodSafetyLicenseUrl: "x", foodSafetyLicenseStatus: "pending" }))).toEqual(["documents", "ddcuuu"]);
    expect(sellerProgress(app({ ...asked, foodSafetyLicenseUrl: "x" })).owed).toEqual([]);
  });
  it("approved without documents: straight to the shop; a rejected file is owed again", () => {
    expect(at(app({ status: "approved" }))).toEqual(["shop", "dddcuu"]);
    expect(at(app({ status: "approved", foodSafetyLicenseUrl: "x", foodSafetyLicenseStatus: "rejected" }))).toEqual(["documents", "ddcuuu"]);
  });
  it("shop created: payouts; Stripe connected: open", () => {
    expect(at(app({ status: "approved", phpShopCreated: true }))).toEqual(["paid", "ddddcu"]);
    expect(at(app({ status: "approved", phpShopCreated: true }), { stripeConnected: true })).toEqual(["open", "dddddc"]);
  });
  it("rejected or cancelled: no current step", () => {
    expect(sellerProgress(app({ status: "rejected" }))).toMatchObject({ outcome: "rejected", current: null });
    expect(sellerProgress(app({ status: "cancelled" }))).toMatchObject({ outcome: "cancelled", current: null });
  });
});

describe("migration 0118 (executed in PGlite)", () => {
  it("adds the call and request columns idempotently, with empty-list defaults for existing rows", async () => {
    const client = new PGlite();
    try {
      await client.exec(`CREATE TABLE applications (id serial PRIMARY KEY, full_name text NOT NULL); INSERT INTO applications (full_name) VALUES ('Old row');`);
      const sql = readFileSync("migrations/0118_seller_application_call_and_requests.sql", "utf8");
      await client.exec(sql);
      await client.exec(sql);
      const { rows } = await client.query<Record<string, unknown>>(`SELECT * FROM applications`);
      expect(rows[0]).toMatchObject({ contact_method: null, contact_time: null, commercial_kitchen: null, food_types: [], documents_requested: [], documents_request_note: null, documents_requested_at: null });
    } finally { await client.close(); }
  }, 60_000);
});
