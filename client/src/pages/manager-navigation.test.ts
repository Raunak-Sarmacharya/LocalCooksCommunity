import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `history.pushState` does NOT fire `popstate` — that is the spec, not a quirk — so a component that
 * reads its state from the query string ONCE at mount never hears about a navigation made while it
 * stays mounted.
 *
 * That was the reported bug (2026-09-28): from My Kitchens, "Offer equipment" / "Offer storage" /
 * "Add more photos" opened the wrong tab, while the SAME rows worked from Revenue. From Revenue the
 * Kitchens page MOUNTS and reads `?section=`; already on it, the page kept whatever section it was
 * showing because nothing re-read the URL.
 *
 * `handleViewChange` is the single navigation entry point, so the dispatch belongs there and every
 * URL-backed child receives it — rather than each caller remembering to notify the page it happens
 * to be standing on. `KitchensManagement` already subscribes to `popstate` for exactly this reason.
 *
 * This is a source guard because the failure is INVISIBLE in the component's own tests: the
 * listener is correct either way, and only the SENDER was missing. There is no cheap way to mount
 * this 2,000-line dashboard in a test, and a guard that fails when the line is deleted is worth more
 * than a heavy harness that would not.
 */
describe("handleViewChange notifies URL-backed children", () => {
  const source = readFileSync(
    join(process.cwd(), "client/src/pages/ManagerBookingDashboard.tsx"),
    "utf8",
  );

  it("dispatches popstate, and does it AFTER writing the URL", () => {
    /*
     * Scoped to `handleViewChange`'s own body on purpose. A bare `indexOf` over the whole file would
     * find `handleImprovementTask`'s dispatch — which is LATER in the file — and pass even with this
     * function's dispatch deleted. A guard that cannot fail is worse than none.
     *
     * `\n  };` is the function's own closing brace: everything nested inside it is indented deeper.
     */
    const start = source.indexOf("const handleViewChange = (");
    const end = source.indexOf("\n  };", start);
    expect(start, "handleViewChange is gone or renamed").toBeGreaterThan(-1);
    expect(end, "could not find the end of handleViewChange").toBeGreaterThan(start);
    const body = source.slice(start, end);

    const pushStateAt = body.indexOf("window.history.pushState({}, '', nextUrl)");
    const dispatchAt = body.indexOf('window.dispatchEvent(new PopStateEvent("popstate"))');

    expect(pushStateAt, "handleViewChange no longer writes the URL with pushState").toBeGreaterThan(-1);
    expect(
      dispatchAt,
      "handleViewChange no longer notifies URL-backed children — a tab destination will silently do nothing when the page is already open",
    ).toBeGreaterThan(-1);
    // Order matters: notifying first would have every listener read the OLD url.
    expect(dispatchAt).toBeGreaterThan(pushStateAt);
  });
});
