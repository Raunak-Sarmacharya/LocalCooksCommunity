import { afterEach, describe, expect, it, vi } from "vitest";
import { leaveSellerApplication } from "./ApplicationFormContext";

afterEach(() => window.history.replaceState({}, "", "/"));

describe("seller application leave navigation", () => {
  it("clears the new-application deep link before opening My Applications", () => {
    window.history.replaceState({}, "", "/dashboard?view=applications&action=new");
    const proceed = vi.fn(() => expect(window.location.search).not.toContain("action="));
    leaveSellerApplication(proceed);
    expect(proceed).toHaveBeenCalledOnce();
    expect(window.location.search).toBe("?view=applications");
  });

  it("preserves other query parameters and executes a different requested destination", () => {
    window.history.replaceState({}, "", "/dashboard?view=applications&action=documents&source=test");
    leaveSellerApplication(() => window.history.pushState({}, "", "/dashboard?view=bookings"));
    expect(window.location.search).toBe("?view=bookings");
  });
});
