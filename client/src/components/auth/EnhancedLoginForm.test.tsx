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
});
