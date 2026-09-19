import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import EmailVerificationScreen from "./EmailVerificationScreen";

describe("EmailVerificationScreen", () => {
  it("keeps the user on an actionable screen when verification is not visible yet", async () => {
    const onCheckVerified = vi.fn().mockResolvedValue(false);

    render(
      <EmailVerificationScreen
        email="person@example.com"
        onResend={vi.fn()}
        onGoBack={vi.fn()}
        onCheckVerified={onCheckVerified}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "I have verified my email" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("haven't detected verification yet");
    expect(onCheckVerified).toHaveBeenCalledTimes(1);
  });

  it("offers no phone shortcut — email must be proven before the account is usable", () => {
    // Email is the primary identifier, so registration must not be completable by
    // proving a phone instead: that would hand out a working session for an
    // account whose email is still unproven. Phone verification returns later, as
    // an additional method offered during onboarding.
    render(
      <EmailVerificationScreen
        email="person@example.com"
        onResend={vi.fn()}
        onGoBack={vi.fn()}
        onCheckVerified={vi.fn().mockResolvedValue(false)}
      />,
    );

    expect(screen.queryByRole("button", { name: /verify phone/i })).not.toBeInTheDocument();
  });

  it("returns to the identifier step from a plain text link, not a back arrow", () => {
    // A "← Change email or login" control at the top read as a wizard step and
    // competed with the primary action. The escape is now a sentence below the
    // actions, worded around the problem.
    const onGoBack = vi.fn();
    render(
      <EmailVerificationScreen
        email="person@example.com"
        onResend={vi.fn()}
        onGoBack={onGoBack}
        onCheckVerified={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /change email or login/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /use a different email/i }));
    expect(onGoBack).toHaveBeenCalledTimes(1);
  });

  it("makes the help text more prominent once an email has been resent", async () => {
    // If the visitor missed the inbox/spam line the first time, the second send
    // is exactly when it needs to catch their eye.
    render(
      <EmailVerificationScreen
        email="person@example.com"
        onResend={vi.fn().mockResolvedValue(undefined)}
        onGoBack={vi.fn()}
        onCheckVerified={vi.fn()}
      />,
    );

    expect(screen.queryByText(/sent again/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /resend verification email/i }));

    expect(await screen.findByText(/sent again/i)).toBeInTheDocument();
    // The balanced help lines stay present, now alongside the confirmation.
    expect(screen.getByText(/nothing yet\? check your spam/i)).toBeInTheDocument();
  });
});
