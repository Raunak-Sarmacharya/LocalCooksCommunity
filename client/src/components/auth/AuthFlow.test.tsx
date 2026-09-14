import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("./IdentifierGate", () => ({
  default: ({
    onEmailKnown,
    onPhoneKnown,
  }: {
    onEmailKnown: (email: string) => void;
    onPhoneKnown: (phone: string) => void;
  }) => (
    <div>
      <button onClick={() => onEmailKnown("linked@example.com")}>Start email</button>
      <button onClick={() => onPhoneKnown("+17096555123")}>Start phone</button>
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
  default: ({ initialEmail, autoSendEmailLink, onTryAnotherWay }: { initialEmail: string; autoSendEmailLink?: boolean; onTryAnotherWay?: () => void }) => (
    <div>
      <span>Login target {initialEmail}</span>
      {autoSendEmailLink ? <span>Email link auto send</span> : null}
      {onTryAnotherWay ? <button onClick={onTryAnotherWay}>Login alternatives</button> : null}
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
    expect(screen.getByText("OTP target +17096555123")).toBeInTheDocument();
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
});
