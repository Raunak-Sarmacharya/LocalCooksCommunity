import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  sendSignInCode: vi.fn(),
  signInWithEmailCode: vi.fn(),
  login: vi.fn(),
  resendEmailVerification: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string | { defaultValue?: string; email?: string; seconds?: number }) => {
      if (typeof fallback === "string") return fallback;
      return (fallback.defaultValue || "")
        .replace("{email}", fallback.email || "")
        .replace("{seconds}", String(fallback.seconds ?? ""));
    },
  }),
}));

vi.mock("@/hooks/use-auth", () => ({ useFirebaseAuth: () => authMocks }));
vi.mock("@/components/ui/custom-alerts", () => ({ useCustomAlerts: () => ({ showAlert: vi.fn() }) }));
vi.mock("@/lib/seller-journey", () => ({ getSellerJourneyDraft: () => null }));
vi.mock("./LoadingOverlay", () => ({ default: () => null }));

import EnhancedLoginForm from "./EnhancedLoginForm";

// input-otp measures the page for password-manager badges; jsdom has no layout.
document.elementFromPoint = () => null;

describe("EnhancedLoginForm email sign-in code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.sendSignInCode.mockResolvedValue(undefined);
  });

  it("automatically sends a selected linked email method and keeps recovery controls visible", async () => {
    const onTryAnotherWay = vi.fn();
    render(
      <EnhancedLoginForm
        initialEmail="linked@example.com"
        initialChallenge="email-link"
        accountConfirmed
        autoSendEmailLink
        showChallengeSwitcher={false}
        onTryAnotherWay={onTryAnotherWay}
      />,
    );

    await waitFor(() => expect(authMocks.sendSignInCode).toHaveBeenCalledTimes(1));
    expect(authMocks.sendSignInCode).toHaveBeenCalledWith("linked@example.com");
    expect(await screen.findByLabelText("Sign-in code")).toBeInTheDocument();
    expect(screen.getByText(/li\*\*\*@example\.com/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send a new code in/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Try another way" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Email Address/)).not.toBeInTheDocument();
  });

  it("matches the verification screen's shape: address on its own line, spam hint, named escape", async () => {
    render(
      <EnhancedLoginForm
        initialEmail="linked@example.com"
        initialChallenge="email-link"
        accountConfirmed
        autoSendEmailLink
        showChallengeSwitcher={false}
        onUseDifferentEmail={vi.fn()}
      />,
    );

    await waitFor(() => expect(authMocks.sendSignInCode).toHaveBeenCalledTimes(1));

    // The address gets its OWN line. Inlined into the sentence it broke around the email, so
    // the sentence read as two ragged fragments.
    const address = await screen.findByText("li***@example.com");
    expect(address.tagName).toBe("P");
    expect(screen.getByText("Enter the 6-digit code we emailed you")).toBeInTheDocument();

    // The spam hint is the point of this screen, and it was missing entirely once the account
    // was confirmed — the one case where the visitor knows the address is right.
    expect(screen.getByText(/Didn't get it\? Check spam/)).toBeInTheDocument();
    expect(screen.getByText("The code works once and expires in 10 minutes.")).toBeInTheDocument();

    // A NAMED way out, not an arrow. `AuthFlow` renders "← Back" above the card for
    // single-method accounts, and this state is precisely that account.
    expect(screen.getByRole("button", { name: "Use a different email" })).toBeInTheDocument();
    expect(screen.getByText("Wrong email?")).toBeInTheDocument();
  });

  it("still offers the named escape when there is no other method to try", async () => {
    // An account registered by email that never chose a password resolves to `["email-link"]`
    // alone (`resolveAuthMethods` requires `passwordSetByUser`), so `AuthFlow` passes no
    // `onTryAnotherWay`. Before this, the "← Back" arrow was its ONLY way out of this screen.
    render(
      <EnhancedLoginForm
        initialEmail="onlylink@example.com"
        initialChallenge="email-link"
        accountConfirmed
        autoSendEmailLink
        showChallengeSwitcher={false}
        onUseDifferentEmail={vi.fn()}
      />,
    );

    await waitFor(() => expect(authMocks.sendSignInCode).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "Try another way" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use a different email" })).toBeInTheDocument();
  });

  it("signs in on this device once all 6 digits are in, and says when a code is wrong", async () => {
    const onSuccess = vi.fn();
    authMocks.signInWithEmailCode.mockRejectedValueOnce(new Error("code-wrong")).mockResolvedValueOnce(undefined);
    render(<EnhancedLoginForm initialEmail="linked@example.com" initialChallenge="email-link" accountConfirmed autoSendEmailLink showChallengeSwitcher={false} onSuccess={onSuccess} />);
    const input = await screen.findByLabelText("Sign-in code");
    fireEvent.change(input, { target: { value: "12345" } });
    expect(authMocks.signInWithEmailCode).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "123456" } });
    await waitFor(() => expect(authMocks.signInWithEmailCode).toHaveBeenCalledWith("linked@example.com", "123456"));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code isn't right");
    fireEvent.change(input, { target: { value: "654321" } });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });
});
