import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiGet: get }));

import { useListingImpactConfirm } from "./ListingImpactConfirm";

function Harness({ save }: { save: () => void }) {
  const { confirm, dialog } = useListingImpactConfirm();
  return <><button onClick={() => { void confirm(4, true).then((approved) => { if (approved) save(); }); }}>Remove cover</button>{dialog}</>;
}

describe("listing impact confirmation", () => {
  it("keeps a live kitchen listed when the manager cancels and saves after confirmation", async () => {
    get.mockResolvedValue({ listingStatus: "active", details: { kitchenName: "Harbour Kitchen" } });
    const save = vi.fn();
    render(<Harness save={save} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove cover" }));
    expect(await screen.findByText(/will take Harbour Kitchen off the listing/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove cover" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save and take off listing" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
  });
});
