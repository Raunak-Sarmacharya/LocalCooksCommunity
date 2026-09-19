import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  sendEmailLink: vi.fn(),
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

describe("EnhancedLoginForm email-link waiting state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.sendEmailLink.mockResolvedValue(undefined);
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

    await waitFor(() => expect(authMocks.sendEmailLink).toHaveBeenCalledTimes(1));
    expect(authMocks.sendEmailLink).toHaveBeenCalledWith("linked@example.com");
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
    expect(screen.getByText(/li\*\*\*@example\.com/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Email sent" })).toBeDisabled();
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

    await waitFor(() => expect(authMocks.sendEmailLink).toHaveBeenCalledTimes(1));

    // The address gets its OWN line. Inlined into the sentence it broke around the email, so
    // the sentence read as two ragged fragments.
    const address = await screen.findByText("li***@example.com");
    expect(address.tagName).toBe("P");
    expect(screen.getByText("We sent a secure sign-in link to")).toBeInTheDocument();

    // The spam hint is the point of this screen, and it was missing entirely once the account
    // was confirmed — the one case where the visitor knows the address is right.
    expect(screen.getByText("Nothing yet? Check your spam or promotions folder.")).toBeInTheDocument();
    expect(screen.getByText("Open the link on this device to sign in.")).toBeInTheDocument();

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

    await waitFor(() => expect(authMocks.sendEmailLink).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "Try another way" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use a different email" })).toBeInTheDocument();
  });
});
