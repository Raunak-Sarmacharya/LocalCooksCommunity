import { describe, expect, it } from "vitest";
import en from "@shared/i18n/locales/en-CA/storage.json";
import fr from "@shared/i18n/locales/fr-CA/storage.json";
import uk from "@shared/i18n/locales/uk/storage.json";

// Kitchen side: the customer's name, else "customer", never "chef".
const KITCHEN_KEYS = ["stTheChef", "stReasonPlaceholder", "stTermOnHold", "stRequestPayout", "stNextStep_reserved", "stNextStep_active",
  "stNextStep_grace", "stNextStep_holdover", "stNextStep_removal_review", "stSituation_withdrawn", "stChefMoveInNotes", "stChefMoveOutNotes"];

describe("kitchen storage copy", () => {
  it.each([["en-CA", en], ["fr-CA", fr], ["uk", uk]] as const)("%s never calls the customer a chef", (_locale, strings) => {
    for (const key of KITCHEN_KEYS) {
      const text = String((strings as Record<string, string>)[key]).replace(/\{chef\}/g, "");
      expect(text, key).not.toMatch(/\bchef|cuisini|кухар|шеф/i);
    }
  });

  it("names the customer in the payout line and the next step", () => {
    expect(en.stRequestPayout).toContain("{chef} pays");
    expect(en.stNextStep_reserved).toBe("Message {chef} to coordinate their arrival.");
  });
});
