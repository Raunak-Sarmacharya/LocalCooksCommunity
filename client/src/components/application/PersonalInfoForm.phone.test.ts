import { expect, it, vi } from "vitest";
vi.mock("@/hooks/use-auth", () => ({ useFirebaseAuth: () => ({ user: null }) }));
import { asFieldPhone } from "./PersonalInfoForm";

it("shows the account's stored phone in the field's own format", () => {
  expect(asFieldPhone("+17095559938")).toBe("+1 (709) 555-9938");
  expect(asFieldPhone("7095559938")).toBe("+1 (709) 555-9938");
  expect(asFieldPhone("")).toBe("+1 ");
  expect(asFieldPhone("+1 (709")).toBe("+1 (709");
});
