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

  it("offers phone OTP as an email-delivery fallback", () => {
    const onVerifyPhone = vi.fn();
    render(
      <EmailVerificationScreen
        email="person@example.com"
        onResend={vi.fn()}
        onGoBack={vi.fn()}
        onVerifyPhone={onVerifyPhone}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Verify phone instead" }));
    expect(onVerifyPhone).toHaveBeenCalledTimes(1);
  });
});
