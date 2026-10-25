import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { deleteTourDraft, readTourDraft, saveTourDraft, tourDraftFromBody } from "./kitchen-tour-drafts";

const intakeData = { intendedUse: "catering", estimatedWeeklyHours: "6-10", hasLicense: true, targetStartDate: "not_decided" };
const future = new Date(Date.now() + 3 * 86400000).toISOString();

describe("kitchen tour drafts (migration 0115 executed in PGlite)", () => {
  it("validates like the booking route, keeps one draft per account and kitchen, deletes", async () => {
    const client = new PGlite();
    try {
      await client.exec(`CREATE TABLE users (id serial PRIMARY KEY); CREATE TABLE locations (id serial PRIMARY KEY); CREATE TABLE kitchens (id serial PRIMARY KEY);
        INSERT INTO users DEFAULT VALUES; INSERT INTO locations DEFAULT VALUES; INSERT INTO kitchens DEFAULT VALUES;`);
      const sql = readFileSync("migrations/0115_kitchen_tour_drafts.sql", "utf8");
      await client.exec(sql); await client.exec(sql);
      const query = (text: string, params: unknown[]) => client.query(text, params as any[]);

      const draft = tourDraftFromBody({ locationId: 1, targetedKitchenId: 1, scheduledAt: future, chefNotes: "Parking?", intakeData: { ...intakeData, extra: "x" }, chefId: 99 })!;
      expect(draft).toEqual({ locationId: 1, targetedKitchenId: 1, scheduledAt: future, chefNotes: "Parking?", intakeData });
      expect(tourDraftFromBody({ locationId: 1, targetedKitchenId: 1, scheduledAt: new Date(Date.now() - 60_000).toISOString(), intakeData })).toBeNull();
      expect(tourDraftFromBody({ locationId: 1, targetedKitchenId: 1, scheduledAt: future, intakeData: { ...intakeData, hasLicense: undefined } })).toBeNull();
      expect(tourDraftFromBody({ locationId: 1, targetedKitchenId: 1, scheduledAt: future, chefNotes: "x".repeat(501), intakeData })).toBeNull();
      expect(tourDraftFromBody({ locationId: 1, targetedKitchenId: 1, scheduledAt: future, intakeData: { ...intakeData, intendedUse: "x".repeat(9000) } })).toBeNull();

      await saveTourDraft(query, 1, draft);
      await saveTourDraft(query, 1, { ...draft, chefNotes: undefined });
      const saved = await readTourDraft(query, 1, 1);
      expect(saved).toMatchObject({ locationId: 1, targetedKitchenId: 1, scheduledAt: future, intakeData, chefNotes: undefined });
      expect((await client.query("SELECT count(*)::int AS n FROM kitchen_tour_drafts")).rows).toEqual([{ n: 1 }]);
      await deleteTourDraft(query, 1, 1);
      expect(await readTourDraft(query, 1, 1)).toBeNull();
      await saveTourDraft(query, 1, draft);
      await client.query("DELETE FROM users WHERE id = 1");
      expect((await client.query("SELECT count(*)::int AS n FROM kitchen_tour_drafts")).rows).toEqual([{ n: 0 }]);
    } finally { await client.close(); }
  }, 60_000);
});
