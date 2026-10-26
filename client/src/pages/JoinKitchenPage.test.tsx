import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

const h = vi.hoisted(() => ({ user: null as any }));
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));
vi.mock("firebase/auth", () => ({ onAuthStateChanged: (_: unknown, cb: (u: unknown) => void) => { cb(h.user); return () => {}; }, signOut: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useFirebaseAuth: () => ({ refreshUserData: vi.fn() }) }));
vi.mock("@/components/auth/KitchenJourneyAuth", () => ({ default: ({ title, initialEmail, lockEmail }: any) => <div data-testid="auth">{title} {initialEmail} {lockEmail ? "locked" : "open"}</div> }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, d?: any, o?: any) => {
  const text = typeof d === "string" ? d : d?.defaultValue ?? key; const vars = typeof d === "object" ? d : o;
  return text.replace(/\{(\w+)\}/g, (_: string, n: string) => String(vars?.[n] ?? "")); } }) }));
import JoinKitchenPage from "./JoinKitchenPage";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); h.user = null; });
const invite = (requirementsChoice: string, extra: Record<string, unknown> = {}) => {
  window.location.hash = "#tok";
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ status: "sent", email: "jo@example.com", fullName: "Jo", locationId: 1,
    locationName: "Harbour", address: "Water St", requirementsChoice, imageUrl: null, ...extra }) })));
  render(<JoinKitchenPage />);
};
const steps = async () => within(await screen.findByRole("list", { name: "What happens next" })).getAllByRole("listitem").map(item => item.textContent);

it("they send them: Join, Booking requirements, Book; the email is locked to the invitation", async () => {
  invite("customer");
  expect(await steps()).toEqual(["JoinNow, about 2 minutes", "Booking requirementsSend what the kitchen asks for", "BookOnce the kitchen checks them"]);
  expect(screen.getByTestId("auth")).toHaveTextContent("Join with your email jo@example.com locked");
  expect(screen.queryByRole("img", { name: "Harbour" })).not.toBeInTheDocument();
});

it("documents on file: requirements already with the kitchen", async () => {
  invite("uploaded");
  expect(await steps()).toEqual(["JoinNow, about 2 minutes", "Booking requirementsThe kitchen has your documents; send anything still missing", "BookOnce nothing is missing"]);
});

it("approved without requirements: Join, then Book", async () => {
  invite("waived", { imageUrl: "/k.jpg" });
  expect(await steps()).toEqual(["JoinNow, about 2 minutes", "BookRight after you join"]);
  expect(screen.getByRole("img", { name: "Harbour" })).toHaveAttribute("src", "/k.jpg");
});

it("signed in with another account: asks to switch, never offers Join", async () => {
  h.user = { email: "other@example.com" };
  invite("customer");
  expect(await screen.findByText("This invitation was sent to jo@example.com. You’re signed in as other@example.com.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Join/ })).not.toBeInTheDocument();
});
