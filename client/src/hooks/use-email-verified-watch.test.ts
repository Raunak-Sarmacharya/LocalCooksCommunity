import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const user = vi.hoisted(() => ({ emailVerified: false, reload: vi.fn(async () => {}) }));
vi.mock("@/lib/firebase", () => ({ auth: { get currentUser() { return user; } } }));
import { useEmailVerifiedWatch } from "./use-email-verified-watch";

afterEach(() => { vi.useRealTimers(); user.emailVerified = false; user.reload.mockClear(); });

describe("useEmailVerifiedWatch", () => {
  it("re-reads the signed-in user every few seconds and continues once, when the link was tapped elsewhere", async () => {
    vi.useFakeTimers();
    const onVerified = vi.fn();
    renderHook(() => useEmailVerifiedWatch(true, onVerified, 1000));
    await vi.advanceTimersByTimeAsync(2100);
    expect(user.reload).toHaveBeenCalledTimes(2);
    expect(onVerified).not.toHaveBeenCalled();
    user.emailVerified = true;
    await vi.advanceTimersByTimeAsync(3000);
    expect(onVerified).toHaveBeenCalledTimes(1);
  });
  it("checks at once when the tab regains focus, and does nothing when off", async () => {
    vi.useFakeTimers();
    const onVerified = vi.fn();
    const { unmount } = renderHook(() => useEmailVerifiedWatch(false, onVerified, 1000));
    await vi.advanceTimersByTimeAsync(3000);
    expect(user.reload).not.toHaveBeenCalled();
    unmount();
    user.emailVerified = true;
    renderHook(() => useEmailVerifiedWatch(true, onVerified, 60_000));
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(10);
    expect(onVerified).toHaveBeenCalledTimes(1);
  });
});
