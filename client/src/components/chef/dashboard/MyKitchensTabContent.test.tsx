import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, options?: any) => typeof options === "string" ? options : options?.defaultValue ?? key }) }));
const hold: { data?: { held: boolean; claims: Array<{ id: number; bookingId: number; kitchenName: string; amountCents?: number }> } } = {};
vi.mock("@/components/booking/DamageClaimCards", () => ({ useClaimBookingHold: () => hold }));
vi.mock("@/components/kitchen/KitchenGridCard", () => ({ KitchenGridCard: ({ title, actions }: any) => <article aria-label={title}>{actions}</article> }));
import MyKitchensTabContent from "./MyKitchensTabContent";

const approved = (extra = {}) => ({ id: 5, status: "approved", current_tier: 3, locationId: 47, tier2_completed_at: "2026-10-01", location: { id: 47, name: "Kitchen 47", address: "1 Main St" }, ...extra }) as any;
const show = (app: any, openBooking = vi.fn()) => { render(<MyKitchensTabContent kitchenApplications={[app]} publicKitchens={[]} chefId={9} onSetActiveTab={vi.fn()} onOpenBookingSheet={openBooking} onOpenChat={vi.fn()} />); return openBooking; };
afterEach(() => { cleanup(); hold.data = undefined; });

it("offers Book only when the chef may book", () => {
  const openBooking = show(approved({ bookingEligibility: { canBook: true, status: "approved", message: "" } }));
  fireEvent.click(screen.getByRole("button", { name: "Book" }));
  expect(openBooking).toHaveBeenCalledWith(expect.objectContaining({ id: 47 }));
});

it.each(["document_expired", "document_review_required"])("replaces Book with Renew documents when booking is blocked (%s)", status => {
  const original = window.location;
  Object.defineProperty(window, "location", { configurable: true, value: { href: "" } });
  try {
    const openBooking = show(approved({ bookingEligibility: { canBook: false, status, message: "", actionUrl: "/dashboard?view=kitchen-requests&renewLocation=47" } }));
    expect(screen.queryByRole("button", { name: "Book" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Renew documents" }));
    expect(window.location.href).toBe("/dashboard?view=kitchen-requests&renewLocation=47");
    expect(openBooking).not.toHaveBeenCalled();
  } finally { Object.defineProperty(window, "location", { configurable: true, value: original }); }
});

it("shows a state, not a Book button, while a renewal is under review", () => {
  show(approved({ bookingEligibility: { canBook: false, status: "renewal_under_review", message: "" } }));
  expect(screen.queryByRole("button", { name: "Book" })).not.toBeInTheDocument();
  expect(screen.getAllByText("renewalUnderReview").length).toBeGreaterThan(0);
});

it("shows only a message when access has ended", () => {
  show(approved({ bookingEligibility: { canBook: false, status: "access_ended", message: "" } }));
  expect(screen.queryByRole("button", { name: "Book" })).not.toBeInTheDocument();
  expect(screen.getAllByText("locationAccessEnded").length).toBeGreaterThan(0);
});

it("an unpaid claim swaps Book for paying it (new bookings are paused)", () => {
  const original = window.location;
  Object.defineProperty(window, "location", { configurable: true, value: { href: "" } });
  try {
    hold.data = { held: true, claims: [{ id: 11, bookingId: 178, kitchenName: "Kitchen 47", amountCents: 4000 }] };
    const openBooking = show(approved({ bookingEligibility: { canBook: true, status: "approved", message: "" } }));
    expect(screen.queryByRole("button", { name: "Book" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("pay-to-book"));
    expect(window.location.href).toBe("/booking/178");
    expect(openBooking).not.toHaveBeenCalled();
  } finally { Object.defineProperty(window, "location", { configurable: true, value: original }); }
});
