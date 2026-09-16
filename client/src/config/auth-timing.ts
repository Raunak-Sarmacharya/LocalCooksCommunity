/**
 * One place for every auth loading timeout.
 *
 * These used to be scattered as literals, which is how they drifted apart
 * without anyone noticing. They are a deliberate ladder, outermost last:
 *
 *   AUTH_PHASE_TIMEOUT_MS  the SDK phase machine (`authenticating` / `syncing`)
 *                          is the outermost state. It can be entered by work
 *                          that never finishes — a dropped Google popup, a phone
 *                          registration abandoned for up to 24 h — so it needs
 *                          the longest leash.
 *   AUTH_GATE_TIMEOUT_MS   escape hatch for a page-level gate that is waiting on
 *                          a profile that may never arrive. Must be LONGER than
 *                          the handoff: if the gate gives up, the handoff is
 *                          what keeps the screen covered until the redirect
 *                          lands. Make it shorter and a slow-but-successful
 *                          /api/user/profile produces exactly the form flash we
 *                          are trying to remove.
 *   HANDOFF_MAX_HOLD_MS    the cross-route overlay. Shortest, because by then we
 *                          are only bridging a navigation that has already been
 *                          decided.
 *
 * A user is never held longer than AUTH_PHASE_TIMEOUT_MS by anything in this
 * ladder, and every layer releases on its own rather than waiting to be told.
 */

/** Safety valve for a stuck `authenticating` / `syncing` phase. */
export const AUTH_PHASE_TIMEOUT_MS = 15_000;

/** How long a page gate may wait for the profile before releasing anyway. */
export const AUTH_GATE_TIMEOUT_MS = 8_000;

/** Minimum time the cross-route overlay stays up. Below this it reads as a
 *  flicker rather than as a loading state. */
export const HANDOFF_MIN_HOLD_MS = 500;

/** How often the in-flight query count is sampled while handing off. */
export const HANDOFF_SAMPLE_MS = 150;

/** Consecutive quiet samples before the destination counts as ready. One is not
 *  enough: queries register over several ticks as the tree mounts. */
export const HANDOFF_QUIET_SAMPLES = 2;

/** Hard ceiling for the cross-route overlay. */
export const HANDOFF_MAX_HOLD_MS = 6_000;
