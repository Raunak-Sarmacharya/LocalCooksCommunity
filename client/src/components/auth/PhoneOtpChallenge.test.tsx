import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signInWithPhoneNumber: vi.fn(() => new Promise(() => undefined)),
  confirm: vi.fn(),
  deleteUser: vi.fn(),
  getAdditionalUserInfo: vi.fn(),
}));

vi.mock("firebase/auth", () => ({
  RecaptchaVerifier: class {
    clear() {}
  },
  deleteUser: mocks.deleteUser,
  getAdditionalUserInfo: mocks.getAdditionalUserInfo,
  signInWithPhoneNumber: mocks.signInWithPhoneNumber,
  signOut: vi.fn(),
}));

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));
vi.mock("@/lib/phone-registration", () => ({
  didPhoneAuthCreateNewIdentity: vi.fn(() => false),
  markPhoneAuthInProgress: vi.fn(),
}));

import PhoneOtpChallenge from "./PhoneOtpChallenge";

afterEach(() => {
  cleanup();
  mocks.signInWithPhoneNumber.mockClear();
  mocks.confirm.mockReset();
  mocks.deleteUser.mockReset();
  mocks.getAdditionalUserInfo.mockReset();
  vi.unstubAllGlobals();
});

describe("PhoneOtpChallenge", () => {
  it("sends immediately without a redundant consent step", async () => {
    render(
      <PhoneOtpChallenge
        autoSend
        initialPhone="+14165550123"
        onCancel={vi.fn()}
        onExistingUser={vi.fn()}
        onNewUser={vi.fn()}
      />,
    );

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Sending verification code");
    await waitFor(() => expect(mocks.signInWithPhoneNumber).toHaveBeenCalledTimes(1));
  });

  it("does not turn an email-to-phone recovery typo into a new registration", async () => {
    const firebaseUser = { getIdToken: vi.fn().mockResolvedValue("token") };
    mocks.signInWithPhoneNumber.mockResolvedValueOnce({ confirm: mocks.confirm } as never);
    mocks.confirm.mockResolvedValueOnce({ user: firebaseUser });
    mocks.deleteUser.mockResolvedValueOnce(undefined);
    mocks.getAdditionalUserInfo.mockReturnValueOnce({ isNewUser: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    render(
      <PhoneOtpChallenge
        autoSend
        existingAccountOnly
        initialPhone="+14165550123"
        onCancel={vi.fn()}
        onExistingUser={vi.fn()}
        onNewUser={vi.fn()}
      />,
    );

    const code = await screen.findByLabelText("Verification code");
    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify phone" }));

    await waitFor(() => expect(mocks.deleteUser).toHaveBeenCalledWith(firebaseUser));
    expect(screen.getByRole("alert")).toHaveTextContent("not linked to this Local Cooks account");
  });
});
