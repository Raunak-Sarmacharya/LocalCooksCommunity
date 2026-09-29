import { describe, expect, it } from "vitest";
import { resolveStripeState } from "./step-completion";

/**
 * The contract this file exists to hold:
 *
 *   `initiated` (what the ONBOARDING wizard gates on) becomes true the moment the manager
 *   has submitted Stripe's form — so setup is not held open for Stripe's review queue.
 *
 *   `connected` (what the DASHBOARD gates on) stays false until Stripe has actually enabled
 *   charges and payouts — so no money-facing surface claims a manager can be paid early.
 *
 * Collapsing these into one flag is the bug this guards, in both directions: too strict and
 * a manager cannot finish setup for a week; too loose and the dashboard claims they are
 * ready to be paid when they are not.
 */
describe("resolveStripeState", () => {
  it("is neither connected nor initiated when there is no account at all", () => {
    const state = resolveStripeState({
      status: "not_started",
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    });
    expect(state).toEqual({ connected: false, initiated: false });
  });

  it("treats a missing payload as not started — an absent answer is not a yes", () => {
    expect(resolveStripeState(null)).toEqual({ connected: false, initiated: false });
    expect(resolveStripeState(undefined)).toEqual({ connected: false, initiated: false });
    expect(resolveStripeState({})).toEqual({ connected: false, initiated: false });
  });

  it("does NOT count an account whose Stripe form was never submitted", () => {
    // The account exists (they pressed "Connect with Stripe") but they abandoned the form.
    // Nothing is with Stripe, so there is nothing to wait for and setup is genuinely not done.
    const state = resolveStripeState({
      status: "incomplete",
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    });
    expect(state).toEqual({ connected: false, initiated: false });
  });

  it("counts a submitted account as initiated but NOT connected — the core case", () => {
    // This is the whole point of the change: Stripe has their form and is verifying.
    // Onboarding may proceed; the dashboard must still say payments are not ready.
    const state = resolveStripeState({
      status: "pending",
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: true,
    });
    expect(state.initiated).toBe(true);
    expect(state.connected).toBe(false);
  });

  it("keeps a submitted account initiated through every post-submission review stage", () => {
    // past_due / requires_additional_info are Stripe asking for MORE after submission. The
    // manager still did their part, so setup stays complete; the dashboard asks them to fix
    // it. If this regressed, a manager who completed onboarding would see the step un-tick
    // and could not get back out of the wizard.
    for (const status of ["pending", "incomplete"]) {
      const state = resolveStripeState({
        status,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: true,
      });
      expect(state.initiated, `submitted with status=${status}`).toBe(true);
    }
  });

  it("counts a fully enabled account as BOTH", () => {
    const state = resolveStripeState({
      status: "complete",
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    expect(state).toEqual({ connected: true, initiated: true });
  });

  it("requires BOTH charges and payouts for connected — one alone is not payable", () => {
    // Stripe can enable charges without payouts (no bank account yet). That manager cannot
    // be paid, so the dashboard row must stay incomplete.
    const chargesOnly = resolveStripeState({
      status: "complete",
      chargesEnabled: true,
      payoutsEnabled: false,
      detailsSubmitted: true,
    });
    expect(chargesOnly.connected).toBe(false);
    expect(chargesOnly.initiated).toBe(true);

    const payoutsOnly = resolveStripeState({
      status: "complete",
      chargesEnabled: false,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    expect(payoutsOnly.connected).toBe(false);
    expect(payoutsOnly.initiated).toBe(true);
  });

  it("does not treat a 'complete' status alone as connected without the flags", () => {
    // Guards against reintroducing trust in the coarse `status` field on its own — the
    // component's own comment warns that it "can be misleading".
    const state = resolveStripeState({
      status: "complete",
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    });
    expect(state.connected).toBe(false);
    expect(state.initiated).toBe(false);
  });

  it("treats a submitted account as initiated even if the payload omits `status`", () => {
    // The server omits `status` on its DB-fallback path; `detailsSubmitted` is what we key on.
    const state = resolveStripeState({ detailsSubmitted: true });
    expect(state).toEqual({ connected: false, initiated: true });
  });
});
