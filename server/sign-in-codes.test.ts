import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { checkSignInCode, issueSignInCode, MAX_SENDS_PER_HOUR } from "./sign-in-codes";

describe("sign-in codes (migration 0107 executed in PGlite)", () => {
  it("one use, 5 tries, 10 minutes, a new code replaces the old, 5 sends an hour", async () => {
    const client = new PGlite();
    try {
      const sql = readFileSync("migrations/0107_sign_in_codes.sql", "utf8");
      await client.exec(sql);
      await client.exec(sql);
      const query = (text: string, params: unknown[]) => client.query(text, params as any[]);
      const t0 = new Date("2026-10-23T20:00:00Z"), at = (min: number) => new Date(t0.getTime() + min * 60_000);
      const wrongOf = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

      const first = (await issueSignInCode(query, "a@x.ca", t0))!;
      expect(first).toMatch(/^\d{6}$/);
      expect((await client.query("SELECT code_hash FROM sign_in_codes")).rows[0]).not.toHaveProperty("code_hash", first);
      expect(await checkSignInCode(query, "a@x.ca", wrongOf(first), at(1))).toBe("wrong");
      expect(await checkSignInCode(query, "b@x.ca", first, at(1))).toBe("expired");
      expect(await checkSignInCode(query, "a@x.ca", first, at(1))).toBe("ok");
      expect(await checkSignInCode(query, "a@x.ca", first, at(1))).toBe("expired");

      const late = (await issueSignInCode(query, "a@x.ca", at(2)))!;
      expect(await checkSignInCode(query, "a@x.ca", late, at(13))).toBe("expired");

      const guessed = (await issueSignInCode(query, "a@x.ca", at(14)))!;
      for (let i = 0; i < 4; i++) expect(await checkSignInCode(query, "a@x.ca", wrongOf(guessed), at(15))).toBe("wrong");
      expect(await checkSignInCode(query, "a@x.ca", wrongOf(guessed), at(15))).toBe("expired");
      expect(await checkSignInCode(query, "a@x.ca", guessed, at(15))).toBe("expired");

      const replaced = (await issueSignInCode(query, "a@x.ca", at(16)))!; // 4th send this hour
      const fifth = (await issueSignInCode(query, "a@x.ca", at(16)))!;
      expect(await issueSignInCode(query, "a@x.ca", at(16))).toBeNull(); // 6th refused, the 5th still works
      if (replaced !== fifth) expect(await checkSignInCode(query, "a@x.ca", replaced, at(17))).toBe("wrong");
      expect(await checkSignInCode(query, "a@x.ca", fifth, at(17))).toBe("ok");
      expect(MAX_SENDS_PER_HOUR).toBe(5);
      expect(await issueSignInCode(query, "a@x.ca", at(61))).toMatch(/^\d{6}$/); // new hour
    } finally { await client.close(); }
  }, 60_000);
});
