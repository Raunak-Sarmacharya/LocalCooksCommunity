import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMissingProfileError } from "@/lib/login-challenge";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("./IdentifierGate", () => ({
  default: ({
    onEmailKnown,
    onPhoneKnown,
    onGoogleSignIn,
    initialIdentifier,
  }: {
    onEmailKnown: (email: string) => void;
    onPhoneKnown: (phone: string) => void;
    onGoogleSignIn: () => void;
    initialIdentifier?: string;
  }) => (
    <div>
      <span>Identifier seed {JSON.stringify(initialIdentifier ?? "")}</span>
      <button onClick={() => onEmailKnown("linked@example.com")}>Start email</button>
      <button onClick={() => onPhoneKnown("+17096555123")}>Start phone</button>
      <button onClick={() => onGoogleSignIn()}>Start google</button>
    </div>
  ),
}));

vi.mock("./PhoneOtpChallenge", () => ({
  default: ({ initialPhone, autoSend, onTryAnotherWay }: { initialPhone: string; autoSend: boolean; onTryAnotherWay?: () => void }) => (
    <div>
      <span>OTP target {initialPhone}</span>
      {autoSend ? <span>OTP auto send</span> : null}
      {onTryAnotherWay ? <button onClick={onTryAnotherWay}>Try another way</button> : null}
    </div>
  ),
}));

vi.mock("./AuthMethodChooser", () => ({
  default: (props: Record<string, unknown>) => (
    <div>
      {props.onEmailLink ? <button onClick={props.onEmailLink as () => void}>Email link</button> : null}
      {props.onPassword ? <button onClick={props.onPassword as () => void}>Email password</button> : null}
      {props.onTextCode ? <button onClick={props.onTextCode as () => void}>Phone code</button> : null}
      {props.phoneHint ? <span>{String(props.phoneHint)}</span> : null}
      {props.onGoogle ? <span>Google</span> : null}
      {props.onDifferentIdentifier ? <button onClick={props.onDifferentIdentifier as () => void}>Different identifier</button> : null}
    </div>
  ),
}));

vi.mock("./EnhancedLoginForm", () => ({
  // Both escapes are surfaced, because the invariant under test is WHICH ONE AuthFlow passes —
  // the real component renders whichever it is given. See `onUseDifferentEmail` in AuthFlow.
  default: ({ initialEmail, autoSendEmailLink, onTryAnotherWay, onUseDifferentEmail }: { initialEmail: string; autoSendEmailLink?: boolean; onTryAnotherWay?: () => void; onUseDifferentEmail?: () => void }) => (
    <div>
      <span>Login target {initialEmail}</span>
      {autoSendEmailLink ? <span>Email link auto send</span> : null}
      {onTryAnotherWay ? <button onClick={onTryAnotherWay}>Login alternatives</button> : null}
      {onUseDifferentEmail ? <button onClick={onUseDifferentEmail}>Use a different email</button> : null}
    </div>
  ),
}));
vi.mock("./EnhancedRegisterForm", () => ({ default: ({ initialEmail }: { initialEmail: string }) => <div>Create profile {initialEmail}</div> }));
vi.mock("./GoogleAuthHint", () => ({ default: ({ onTryAnotherWay }: { onTryAnotherWay: () => void }) => <button onClick={onTryAnotherWay}>Google alternatives</button> }));

import AuthFlow from "./AuthFlow";

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("AuthFlow recovery methods", () => {
  it("offers every linked alternative after phone while excluding the active phone method", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        state: "existing",
        methods: ["email-link", "password", "phone", "google"],
        // The phone is a sign-in method only because it has been PROVED. Without
        // this the gate refuses it, which is the whole point of the change.
        phoneVerified: true,
        maskedEmail: "sa***@gmail.com",
        maskedPhone: "••• ••• 5123",
        linkedEmail: "satyajitdebnath.debnath@gmail.com",
        linkedPhone: "+17096555123",
      }),
    }));
    render(<AuthFlow onGoogleSignIn={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Start phone" }));
    fireEvent.click(await screen.findByRole("button", { name: /Try another way/ }));

    expect(screen.getByText("Email link")).toBeInTheDocument();
    expect(screen.getByText("Email password")).toBeInTheDocument();
    expect(screen.getByText("Google")).toBeInTheDocument();
    expect(screen.queryByText("Phone code")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Email link" }));
    expect(screen.getByText("Login target satyajitdebnath.debnath@gmail.com")).toBeInTheDocument();
    expect(screen.getByText("Email link auto send")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Login alternatives" }));
    expect(screen.getByRole("button", { name: "Email password" })).toBeInTheDocument();
  });

  it("shows a linked masked phone as an alternative after starting with email", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        state: "existing",
        methods: ["email-link", "password", "phone", "google"],
        phoneVerified: true,
        maskedEmail: "li***@example.com",
        maskedPhone: "••• ••• 5123",
        linkedEmail: "linked@example.com",
        linkedPhone: "+17096555123",
      }),
    }));
    render(<AuthFlow onGoogleSignIn={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Start email" }));
    expect(await screen.findByText("Email link auto send")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Login alternatives" }));

    expect(screen.getByText("Phone code")).toBeInTheDocument();
    expect(screen.getByText("••• ••• 5123")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Phone code" }));
    // Async now: choosing a phone re-resolves the account so the gate can refuse
    // it before any code is sent.
    expect(await screen.findByText("OTP target +17096555123")).toBeInTheDocument();
    expect(screen.getByText("OTP auto send")).toBeInTheDocument();
  });

  it("routes an unknown email directly to registration", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ state: "new", methods: [], maskedEmail: null, maskedPhone: null }),
    }));
    render(<AuthFlow onGoogleSignIn={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Start email" }));

    expect(await screen.findByText("Create profile linked@example.com")).toBeInTheDocument();
    expect(screen.queryByText("Login form")).not.toBeInTheDocument();
  });

  it("routes a Google-only returning user to the provider hint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ state: "existing", methods: ["email-link", "google"], maskedEmail: "li***@example.com", maskedPhone: null }),
    }));
    render(<AuthFlow onGoogleSignIn={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Start email" }));

    expect(await screen.findByRole("button", { name: "Google alternatives" })).toBeInTheDocument();
  });

  it("gives a single-method account a way back from the login step", async () => {
    // One method means no onTryAnotherWay, which used to leave `login` with no
    // exit at all — reloading the page was the only way back to the identifier.
    //
    // The exit is now a NAMED link rather than a "← Back" arrow: an arrow above a form reads as
    // a wizard step, says nothing about where it goes, and sat above a washed-out button in the
    // moment the sign-in link was being sent.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ state: "existing", methods: ["email-link"], maskedEmail: "li***@example.com", maskedPhone: null }),
    }));
    render(<AuthFlow onGoogleSignIn={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Start email" }));
    expect(await screen.findByText("Email link auto send")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Login alternatives" })).not.toBeInTheDocument();

    // No arrow anywhere in the flow any more.
    expect(screen.queryByRole("button", { name: /Back/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));
    expect(screen.getByRole("button", { name: "Start email" })).toBeInTheDocument();
  });

  it("never shows both escapes at once on the login step", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ state: "existing", methods: ["email-link", "password"], maskedEmail: "li***@example.com", maskedPhone: null }),
    }));
    render(<AuthFlow onGoogleSignIn={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Start email" }));
    expect(await screen.findByRole("button", { name: "Login alternatives" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Back/ })).not.toBeInTheDocument();
    // With an alternative method to try, the address escape must NOT also be offered.
    expect(screen.queryByRole("button", { name: "Use a different email" })).not.toBeInTheDocument();
  });

  it("sends a Google sign-in with no profile to the explicit register step, never provisioning", async () => {
    // The manager login page must not create an account from a sign-in
    // affordance. `signInWithGoogle(..., isRegistration=false)` throws this
    // coded error for an unknown account, and the flow has to turn it into the
    // visible "Create your account" step so registration is a deliberate act.
    const onGoogleSignIn = vi
      .fn()
      .mockRejectedValue(createMissingProfileError("New.Google@Example.com"));
    render(<AuthFlow onGoogleSignIn={onGoogleSignIn} />);

    fireEvent.click(screen.getByRole("button", { name: "Start google" }));

    expect(await screen.findByText("Create profile new.google@example.com")).toBeInTheDocument();
    // It must not have been swallowed into a dead end, and no error may surface.
    expect(screen.queryByText("Login form")).not.toBeInTheDocument();
  });

  it("resumes verification for an account whose email is unconfirmed", async () => {
    // An unverified account is mid-onboarding, not a returning user. Choosing a
    // method for it sent a passwordless SIGN-IN link — a different email with
    // different copy, and none of the resend / "check again" affordances the
    // verification screen offers.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        state: "existing",
        methods: ["email-link", "password"],
        emailVerified: false,
        maskedEmail: "li***@example.com",
        maskedPhone: "••• ••• 5123",
        linkedPhone: "+17096555123",
      }),
    }));
    const onUnverifiedAccount = vi.fn();
    render(<AuthFlow onGoogleSignIn={vi.fn()} onUnverifiedAccount={onUnverifiedAccount} />);

    fireEvent.click(screen.getByRole("button", { name: "Start email" }));

    await waitFor(() => expect(onUnverifiedAccount).toHaveBeenCalledWith("linked@example.com"));
    // It must NOT have fallen through to the email-link step.
    expect(screen.queryByText("Email link auto send")).not.toBeInTheDocument();
  });

  it("seeds the identifier field from initialIdentifier", () => {
    // The host re-seeds this after a failed attempt or when the visitor returns
    // to correct an address, so coming back is an EDIT rather than a retype.
    render(<AuthFlow initialIdentifier="linked@example.com" onGoogleSignIn={vi.fn()} />);
    expect(screen.getByText('Identifier seed "linked@example.com"')).toBeInTheDocument();
  });

  it("seeds the identifier from an address the flow already knows", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ state: "new", methods: [], emailVerified: null, maskedEmail: null }),
    }));
    render(<AuthFlow onGoogleSignIn={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Start email" }));
    await screen.findByText(/Create profile/);

    // Back to the gate via the register step's own escape: the address just typed
    // must still be there, so correcting it is an edit rather than a retype.
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(screen.getByText('Identifier seed "linked@example.com"')).toBeInTheDocument();
  });

  it("does not divert a verified account, nor one whose state could not be read", async () => {
    // `emailVerified: null` means the lookup could not answer. Reading that as
    // "unverified" would push every returning user into the verification flow
    // whenever the endpoint hiccups — the reason the field is tri-state.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        state: "existing",
        methods: ["email-link"],
        emailVerified: null,
        maskedEmail: "li***@example.com",
        maskedPhone: null,
      }),
    }));
    const onUnverifiedAccount = vi.fn();
    render(<AuthFlow onGoogleSignIn={vi.fn()} onUnverifiedAccount={onUnverifiedAccount} />);

    fireEvent.click(screen.getByRole("button", { name: "Start email" }));

    expect(await screen.findByText("Email link auto send")).toBeInTheDocument();
    expect(onUnverifiedAccount).not.toHaveBeenCalled();
  });

  it("refuses a phone number no account holds, and offers registration instead", async () => {
    // The reported bug: this used to reach the signup form silently, so the
    // visitor was never told the number was unknown. Now the reason is stated and
    // the next step is the one they actually need.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ state: "new", methods: [], phoneVerified: null, portalAllowed: null, maskedEmail: null, maskedPhone: null }),
    }));
    render(<AuthFlow onGoogleSignIn={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Start phone" }));

    expect(await screen.findByText("No account uses this number")).toBeInTheDocument();
    expect(screen.getByText("+17096555123")).toBeInTheDocument();
    // The important half: no code was requested, so the challenge never mounted.
    expect(screen.queryByText(/OTP/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
    expect(screen.getByText(/Create profile/)).toBeInTheDocument();
  });

  it("refuses an unproved number and points at the account's email", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        state: "existing",
        methods: [],
        phoneVerified: false,
        maskedEmail: "sa***@gmail.com",
        linkedEmail: "satyajitdebnath.debnath@gmail.com",
        maskedPhone: null,
      }),
    }));
    render(<AuthFlow onGoogleSignIn={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Start phone" }));

    expect(await screen.findByText("This number can't sign you in yet")).toBeInTheDocument();
    expect(screen.getByText("sa***@gmail.com")).toBeInTheDocument();
    expect(screen.queryByText(/OTP/)).not.toBeInTheDocument();

    // The escape signs in with the address the account already has, and reuses the
    // email routing rather than inventing a second code path.
    fireEvent.click(screen.getByRole("button", { name: "Continue with email" }));
    expect(await screen.findByText("Login target satyajitdebnath.debnath@gmail.com")).toBeInTheDocument();
  });

  it("refuses a chef's number on the manager portal without sending anything", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        state: "existing",
        methods: [],
        phoneVerified: true,
        portalAllowed: false,
        maskedEmail: "sa***@gmail.com",
        maskedPhone: null,
      }),
    }));
    const onPortalRejected = vi.fn();
    render(<AuthFlow onGoogleSignIn={vi.fn()} portal="manager" onPortalRejected={onPortalRejected} />);

    fireEvent.click(screen.getByRole("button", { name: "Start phone" }));

    await waitFor(() => expect(onPortalRejected).toHaveBeenCalledTimes(1));
    // The refusal costs nothing: no challenge mounted, and the card is back on the
    // gate so the host's alert sits over a usable form.
    expect(screen.queryByText(/OTP/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start phone" })).toBeInTheDocument();
  });

  it("names the portal so authority is settled before any code is sent", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ state: "existing", methods: [], phoneVerified: true, portalAllowed: true, maskedEmail: null, maskedPhone: null }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthFlow onGoogleSignIn={vi.fn()} portal="manager" />);

    fireEvent.click(screen.getByRole("button", { name: "Start phone" }));
    await screen.findByText(/OTP target/);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ identifier: "+17096555123", portal: "manager" });
  });
});
