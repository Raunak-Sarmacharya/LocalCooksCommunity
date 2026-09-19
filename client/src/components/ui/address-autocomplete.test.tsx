import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AddressAutocomplete from "./address-autocomplete";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PREDICTIONS = {
  status: "OK",
  predictions: [
    {
      place_id: "p1",
      description: "123 Main St, St. John's, NL, Canada",
      structured_formatting: { main_text: "123 Main St" },
    },
  ],
};

function stubFetch() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => PREDICTIONS,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Past the 300ms debounce in `useDebounce`. */
const pastDebounce = () => new Promise((resolve) => setTimeout(resolve, 400));

describe("AddressAutocomplete", () => {
  // The reported bug. Returning to the Business step remounted this field with the
  // address already stored on the location, the debounce treated that as input, and
  // the suggestion list opened by itself with the manager's own address in it.
  it("does not look up a value that arrived from outside", async () => {
    const fetchMock = stubFetch();

    render(<AddressAutocomplete value="123 Main St" onChange={() => {}} />);
    await pastDebounce();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /123 Main St/ })).not.toBeInTheDocument();
  });

  // The other half of the rule: the lookup must still happen for real typing, or the
  // guard above would have replaced a popup bug with a dead field.
  it("looks up what the manager types", async () => {
    const fetchMock = stubFetch();

    render(<AddressAutocomplete value="" onChange={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "123 Main" } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0][0])).toContain("input=123+Main");
  });

  // A parent that echoes the typed value back (every caller here does) must not have
  // its echo mistaken for a prefill and disarm the next lookup.
  it("keeps looking up while the parent echoes the value back", async () => {
    const fetchMock = stubFetch();
    const { rerender } = render(<AddressAutocomplete value="" onChange={() => {}} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "123 Main" } });
    rerender(<AddressAutocomplete value="123 Main" onChange={() => {}} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });
});
