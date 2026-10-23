import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { deleteDraft, draftFieldsFromBody, readDraft, saveDraft } from "./kitchen-request-drafts";

describe("kitchen request drafts (migration 0108 executed in PGlite)", () => {
  it("keeps only the request's own fields, one draft per account and kitchen, keeps the certificate on resave, deletes", async () => {
    const client = new PGlite();
    try {
      await client.exec("CREATE TABLE users (id serial PRIMARY KEY); CREATE TABLE locations (id serial PRIMARY KEY); INSERT INTO users DEFAULT VALUES; INSERT INTO locations DEFAULT VALUES;");
      const sql = readFileSync("migrations/0108_kitchen_request_drafts.sql", "utf8");
      await client.exec(sql); await client.exec(sql);
      const query = (text: string, params: unknown[]) => client.query(text, params as any[]);
      const fields = draftFieldsFromBody({ fullName: "Sam Rivera", phone: "7095550142", locationId: "1", current_tier: "2", email: "x@y.z", businessDescription: '{"businessName":"Rivera Bakes"}', foodSafetyLicense: "yes", chefId: "99" })!;
      expect(fields).toEqual({ fullName: "Sam Rivera", phone: "7095550142", businessDescription: '{"businessName":"Rivera Bakes"}', foodSafetyLicense: "yes" });
      expect(draftFieldsFromBody({ fullName: "x".repeat(40_000) })).toBeNull();
      expect(draftFieldsFromBody({ locationId: "1" })).toBeNull();
      await saveDraft(query, 1, 1, fields, "https://files/cert.pdf");
      await saveDraft(query, 1, 1, { ...fields, fullName: "Sam R." }, null);
      const draft = await readDraft(query, 1, 1);
      expect(draft?.fields.fullName).toBe("Sam R.");
      expect(draft?.licenseUrl).toBe("https://files/cert.pdf");
      expect((await client.query("SELECT count(*)::int AS n FROM kitchen_request_drafts")).rows).toEqual([{ n: 1 }]);
      await deleteDraft(query, 1, 1);
      expect(await readDraft(query, 1, 1)).toBeNull();
    } finally { await client.close(); }
  }, 60_000);
});
