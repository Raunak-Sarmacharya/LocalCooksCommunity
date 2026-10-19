import { describe, expect, it } from "vitest";
import { storageListingReadiness } from "./storage-listing-readiness";

const listing = { status: "active", name: "Shelf", storageType: "dry", basePrice: "500", unitCount: 2, maxTermDays: null, isActive: true };
const instructions = { storageCheckinInstructions: "Use shelf A", storageCheckoutInstructions: "Empty shelf A" };

describe("storage listing readiness", () => {
  it("lists only ready, active storage, without photos or optional checklist requirements", () => {
    expect(storageListingReadiness(listing, instructions)).toEqual({ ready: true, missing: [], visible: true, status: "listed" });
    expect(storageListingReadiness({ ...listing, isActive: false }, instructions).status).toBe("paused");
    expect(storageListingReadiness({ ...listing, status: "draft", isActive: false }, instructions).status).toBe("draft");
    expect(storageListingReadiness(listing).visible).toBe(false);
    expect(storageListingReadiness({ ...listing, status: "rejected" }, instructions).visible).toBe(false);
  });
  it("names every missing essential and rejects whitespace and invalid numbers", () => {
    expect(storageListingReadiness({ name: " ", storageType: "", basePrice: 0, unitCount: 0, maxTermDays: 0 }, {
      storageCheckinInstructions: " ", storageCheckoutInstructions: "",
    }).missing).toEqual(["name", "type", "price", "units", "maxDays", "moveIn", "moveOut"]);
    expect(storageListingReadiness({ ...listing, basePrice: "NaN", unitCount: 1.5, maxTermDays: 1.5 }, instructions).ready).toBe(false);
  });
});
