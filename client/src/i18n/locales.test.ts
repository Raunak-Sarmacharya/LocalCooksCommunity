import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@formatjs/icu-messageformat-parser";

// The app runs i18next-icu, which renders the raw pattern when a message fails
// to parse (e.g. a plural block missing its closing brace, or a `{{mustache}}`
// placeholder). Catch those here instead of in the UI.
const root = join(__dirname, "../../../shared/i18n/locales");

const entries = readdirSync(root).flatMap((locale) =>
  readdirSync(join(root, locale)).flatMap((file) => {
    const json = JSON.parse(readFileSync(join(root, locale, file), "utf8"));
    return Object.entries(json)
      .filter(([, value]) => typeof value === "string" && value.includes("{"))
      .map(([key, value]) => [`${locale}/${file}#${key}`, value as string] as const);
  })
);

describe("locale bundles", () => {
  it("has messages to check", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)("%s is a valid ICU message", (_id, message) => {
    expect(() => parse(message)).not.toThrow();
    expect(message).not.toMatch(/\{\{/);
  });
});
