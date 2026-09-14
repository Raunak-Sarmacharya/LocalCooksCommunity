import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import IdentifierGate from "./IdentifierGate";

afterEach(cleanup);

describe("IdentifierGate", () => {
  it("continues email through authentication without an existence lookup", async () => {
    const onEmailKnown = vi.fn();
    render(
      <IdentifierGate
        onEmailKnown={onEmailKnown}
        onPhoneKnown={vi.fn()}
        onGoogleSignIn={vi.fn()}
      />,
    );

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Existing@Example.com" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(onEmailKnown).toHaveBeenCalledWith("existing@example.com"));
  });

  it("normalizes a North American phone before opening the OTP challenge", async () => {
    const onPhoneKnown = vi.fn();
    render(
      <IdentifierGate
        onEmailKnown={vi.fn()}
        onPhoneKnown={onPhoneKnown}
        onGoogleSignIn={vi.fn()}
      />,
    );

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "(416) 555-0123" } });
    expect(input).toHaveAttribute("type", "tel");
    expect(input).toHaveAttribute("inputmode", "tel");
    expect(screen.getByText("US & Canada (+1)")).toBeInTheDocument();
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(onPhoneKnown).toHaveBeenCalledWith("+14165550123"));
  });
});
