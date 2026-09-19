import { describe, expect, it } from "vitest";
import { validateKitchenInput } from "./input-validator";

/**
 * A kitchen can be priced hourly, daily, or both — `insertKitchenSchema` in
 * `shared/schema.ts`, `CreateKitchenDTO`, the repository and the pricing endpoint all say
 * so. Two links in the create path did not: the route never forwarded `dailyRate`, and
 * this schema does not name it, so `.parse()` stripped it anyway.
 *
 * Two silent losses in one path, which is why a daily rate typed during onboarding reached
 * the database as NULL and the form appeared to "clear" it. Either one alone would have
 * been enough to lose the value, so both are pinned here.
 */
describe("validateKitchenInput", () => {
  const base = { locationId: 1, name: "Harbour Kitchen" };

  it("keeps a daily rate", async () => {
    const parsed = await validateKitchenInput({ ...base, hourlyRate: 4500, dailyRate: 24000 });
    expect(parsed.dailyRate).toBe(24000);
  });

  it("keeps an hourly rate", async () => {
    const parsed = await validateKitchenInput({ ...base, hourlyRate: 4500 });
    expect(parsed.hourlyRate).toBe(4500);
  });

  it("treats the daily rate as optional", async () => {
    const parsed = await validateKitchenInput({ ...base, hourlyRate: 4500 });
    expect(parsed.dailyRate).toBeUndefined();
  });

  it("refuses a daily rate that is not positive", async () => {
    await expect(validateKitchenInput({ ...base, dailyRate: 0 })).rejects.toThrow();
  });
});
