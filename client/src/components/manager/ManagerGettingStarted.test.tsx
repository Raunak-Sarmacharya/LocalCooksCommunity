import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ManagerGettingStarted } from "./ManagerGettingStarted";
import {
  buildGettingStartedItems,
  summarizeGettingStarted,
  visibleGettingStartedItems,
  GETTING_STARTED_PHASE_LABEL_KEYS,
  type GettingStartedInput,
} from "@/lib/manager-getting-started";

/**
 * The REAL catalog, not a hand-written stub.
 *
 * The widget no longer carries English fallbacks, so the mock has to resolve keys the way `mt` does —
 * and resolving them from `en-CA/manager.json` means these tests assert the copy that actually ships.
 * A stub would let the catalog drift out from under every assertion in this file.
 */
const EN_MANAGER = JSON.parse(
  readFileSync(join(process.cwd(), "shared/i18n/locales/en-CA/manager.json"), "utf8"),
) as Record<string, string>;

vi.mock("@/i18n/manager", () => ({
  mt: (key: string, options?: Record<string, unknown>) => {
    const template = EN_MANAGER[key] ?? key;
    if (key === "managerSetupProgress") {
      return template
        .replace("{completed}", String(options?.completed))
        .replace("{total}", String(options?.total));
    }
    return template;
  },
}));

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  // The completion state is remembered per session; without this the first test to finish would
  // suppress the celebration for every test after it.
  window.sessionStorage.clear();
});

afterEach(cleanup);

/** A host who just left the wizard on its first step: nothing set up, phone not proved. */
const NEW_HOST: GettingStartedInput = {
  isSetupComplete: false,
  phoneVerified: false,
  stripeConnected: false,
  hasPublishedKitchen: false,
  readiness: null,
  hasConfirmedBooking: false,
};

/** Setup behind them — a location and a kitchen exist. */
const SET_UP: GettingStartedInput = { ...NEW_HOST, isSetupComplete: true };

/** Live to customers, phone still unproved. */
const LIVE: GettingStartedInput = { ...SET_UP, hasPublishedKitchen: true };

/** Everything done, for the completion state. */
const ALL_DONE: GettingStartedInput = {
  ...LIVE,
  phoneVerified: true,
  stripeConnected: true,
  readiness: {
    requirements: [],
    recommendations: [
      { id: "gallery", met: true },
      { id: "equipment", met: true },
      { id: "storage", met: true },
      { id: "tours", met: true },
      { id: "terms", met: false },
    ],
    canPublish: true,
    missingRequirementIds: [],
    openRecommendationIds: ["terms"],
  },
  hasConfirmedBooking: true,
};

/**
 * Mirrors what the hook does — including the staged reveal — so these tests exercise the rows a host
 * actually sees rather than a shape the widget is never handed.
 */
function renderWidget(input: GettingStartedInput) {
  const onSelectItem = vi.fn();
  const isLive = input.hasPublishedKitchen;
  const items = visibleGettingStartedItems(buildGettingStartedItems(input), {
    isSetupComplete: input.isSetupComplete,
    phoneVerified: input.phoneVerified,
    isLive,
  });
  const summary = summarizeGettingStarted(items);

  render(
    <SidebarProvider>
      <ManagerGettingStarted
        items={summary.items}
        completed={summary.completed}
        total={summary.total}
        hiddenStage={input.isSetupComplete ? (isLive ? null : "live") : "setup"}
        onSelectItem={onSelectItem}
      />
    </SidebarProvider>,
  );

  return { onSelectItem, summary };
}

describe("ManagerGettingStarted", () => {
  it("names the NEXT ACTION on the launcher, not a permanent 'Getting started'", () => {
    // The label is the thing that must never go stale: by the time the host is live, "Getting
    // started" is simply wrong.
    renderWidget(SET_UP);

    const trigger = screen.getByRole("button", { name: /Verify Phone Number/ });
    expect(trigger).toHaveAccessibleName("Get set up. Verify Phone Number. 0 of 3 complete");
  });

  it("changes the launcher label as the host progresses", () => {
    renderWidget(NEW_HOST);
    // A host who has done nothing is being asked to finish setup, not to verify a phone.
    expect(screen.getByRole("button", { name: /Finish setting up/ })).toBeInTheDocument();
  });

  it("opens a flyout and deep-links the row that was clicked", () => {
    const { onSelectItem } = renderWidget(SET_UP);

    const trigger = screen.getByRole("button", { name: /0 of 3 complete/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list", { name: "Get live" })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    // Scoped to the row's own LIST: the launcher's label names the next action, so an unscoped query
    // matches two buttons — and the phone row lives in "Get set up", not "Get live".
    expect(screen.getByRole("list", { name: "Get live" })).toBeInTheDocument();
    const setUpList = screen.getByRole("list", { name: "Get set up" });

    // Rows carry no CTA — the row itself is the control, and it closes the flyout.
    fireEvent.click(within(setUpList).getByRole("button", { name: /Verify Phone Number/ }));
    expect(onSelectItem).toHaveBeenCalledWith("phone");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("shows ONLY the gateway rows to a host who is not set up, and names what unlocks the rest", () => {
    renderWidget(NEW_HOST);
    fireEvent.click(screen.getByRole("button", { name: /0 of 2 complete/ }));

    expect(screen.getByRole("list", { name: "Get set up" })).toBeInTheDocument();
    // The rows that named work they could not do yet are gone, not merely disabled.
    expect(screen.queryByText("Publish your kitchen")).not.toBeInTheDocument();
    expect(screen.queryByText("Connect Stripe")).not.toBeInTheDocument();
    // Withheld, not silently missing: the destination stays visible.
    expect(screen.getByText("More steps unlock after setup")).toBeInTheDocument();
  });

  it("groups the rows under their phases once the host is live", () => {
    renderWidget(LIVE);
    fireEvent.click(screen.getByRole("button", { name: /1 of 8 complete/ }));

    expect(screen.getByRole("list", { name: "Get set up" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Get live" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Get booked" })).toBeInTheDocument();
    // Nothing is withheld at this point, so the hint is gone.
    expect(screen.queryByText(/More steps unlock/)).not.toBeInTheDocument();
  });

  it("shows equipment and storage as two separate rows", () => {
    renderWidget(LIVE);
    fireEvent.click(screen.getByRole("button", { name: /complete/ }));

    expect(screen.getByText("Offer equipment")).toBeInTheDocument();
    expect(screen.getByText("Offer storage")).toBeInTheDocument();
  });

  it("keeps the phone row visible and ticked once the number is proved", () => {
    renderWidget({ ...SET_UP, phoneVerified: true });
    fireEvent.click(screen.getByRole("button", { name: /1 of 3 complete/ }));

    expect(screen.getByText("Verify Phone Number")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Verify Phone Number/ })).not.toBeInTheDocument();
  });

  it("never renders the milestone as a button", () => {
    renderWidget(LIVE);
    fireEvent.click(screen.getByRole("button", { name: /complete/ }));

    // Nothing the host can click makes a customer book, so offering a button would be a promise the
    // row cannot keep. It is listed, and it is inert.
    expect(screen.getByText("Take your first booking")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Take your first booking" }),
    ).not.toBeInTheDocument();
  });

  it("celebrates completion instead of vanishing, then retires", () => {
    renderWidget(ALL_DONE);

    // The launcher acknowledges it — a silent disappearance tells the host nothing.
    const trigger = screen.getByRole("button", { name: /You're all set/ });
    expect(trigger).toHaveAccessibleName(/8 of 8 complete/);
  });

  it("stays retired once the completion has been seen this session", () => {
    window.sessionStorage.setItem("localcooks.gettingStarted.celebrated", "1");
    renderWidget(ALL_DONE);

    expect(screen.queryByRole("button", { name: /You're all set/ })).not.toBeInTheDocument();
  });

  it("renders nothing at all until the answers are in", () => {
    // A wrong stage that corrects itself is worse than a beat of nothing.
    render(
      <SidebarProvider>
        <ManagerGettingStarted items={[]} completed={0} total={0} isLoading />
      </SidebarProvider>,
    );

    expect(screen.queryByRole("button", { name: /complete/ })).not.toBeInTheDocument();
  });

  it("opens OUTSIDE the sidebar, as a flyout", () => {
    // The panel is ~240px of content and the sidebar is 16rem, so it cannot open in place without
    // cutting the copy. Outside is the one placement that works at every sidebar width, including the
    // 3rem icon rail.
    renderWidget(SET_UP);
    fireEvent.click(screen.getByRole("button", { name: /0 of 3 complete/ }));

    expect(screen.getByRole("list", { name: "Get live" })).toBeInTheDocument();
    // Portalled: it left the sidebar rather than trying to fit inside it.
    expect(document.querySelector("[data-radix-popper-content-wrapper]")).not.toBeNull();
  });

  it("does not force the sidebar open to show the panel", () => {
    const onOpenChange = vi.fn();
    const summary = summarizeGettingStarted(
      visibleGettingStartedItems(buildGettingStartedItems(SET_UP), {
        isSetupComplete: true,
        phoneVerified: false,
        isLive: false,
      }),
    );

    render(
      <SidebarProvider open={false} onOpenChange={onOpenChange}>
        <ManagerGettingStarted
          items={summary.items}
          completed={summary.completed}
          total={summary.total}
          onSelectItem={() => undefined}
        />
      </SidebarProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /0 of 3 complete/ }));
    expect(screen.getByRole("list", { name: "Get live" })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

/**
 * The panel is an `18rem` flyout and each row spends ~68px of it on the marker, the glyph and the
 * gaps, leaving ~220px of text — about 37 characters at 11px and 32 at 12.5px.
 *
 * A wrap that leaves ONE word on the second line reads as a rendering bug rather than as emphasis —
 * reported from the running app: "…how cooks reach you about a **booking**". Every string is
 * `truncate`d as well, so a long one is CUT rather than wrapped, which is worse; the limits are pinned
 * here so that never happens silently.
 */
/**
 * The panel is sized by its COPY, and the copy exists in three languages.
 *
 * English is the SHORTEST — `fr-CA` runs roughly 30% longer ("Plus de photos, plus de réservations" is
 * 36 characters against English's 25) — so a budget derived from English alone would cut French
 * mid-sentence. Every string is `truncate`d, so an over-long one is not wrapped, it is CUT.
 *
 * These guards read the CATALOGS rather than the component, because the catalog is what a user reads.
 * The widget carries no English fallback table any more, so a key missing from a locale renders as a
 * raw id — hence the first test below.
 */
describe("the panel's copy fits the flyout, in every locale", () => {
  const source = readFileSync(
    join(process.cwd(), "client/src/components/manager/ManagerGettingStarted.tsx"),
    "utf8",
  );

  const LOCALES = ["en-CA", "fr-CA", "uk"] as const;
  type Locale = (typeof LOCALES)[number];
  const catalogs = Object.fromEntries(
    LOCALES.map((locale) => [
      locale,
      JSON.parse(
        readFileSync(join(process.cwd(), `shared/i18n/locales/${locale}/manager.json`), "utf8"),
      ) as Record<string, string>,
    ]),
  ) as Record<Locale, Record<string, string>>;

  /** Read the panel's real width rather than restating it — that is the whole point of the guard. */
  const panelRem = Number(source.match(/w-\[(\d+(?:\.\d+)?)rem\]/)?.[1]);
  /** panel p-1.5 + row px-1.5 + marker + gap + glyph + gap */
  const CHROME_PX = 68;
  const availablePx = panelRem * 16 - CHROME_PX;

  /** The two withheld-stage hints render full-width, outside the row indent. */
  const isHint = (key: string) => key.startsWith("gettingStartedMoreAfter");

  const rowsIn = (locale: Locale, kind: "Desc" | "label") =>
    Object.entries(catalogs[locale]).filter(([key]) => {
      if (!key.startsWith("gettingStarted") || isHint(key)) return false;
      return kind === "Desc" ? key.endsWith("Desc") : !key.endsWith("Desc");
    });

  it("sizes the budget from the panel's own width", () => {
    expect(panelRem, "the panel width is no longer declared in rem").toBeGreaterThan(0);
    expect(availablePx).toBeGreaterThan(200);
  });

  it("resolves every key the widget asks for, in all three locales", () => {
    const items = buildGettingStartedItems(ALL_DONE);
    const keys = new Set<string>([
      ...items.flatMap((item) =>
        [item.labelKey, item.descriptionKey].filter((key): key is string => Boolean(key)),
      ),
      ...Object.values(GETTING_STARTED_PHASE_LABEL_KEYS),
      // The hints are reached through a lookup table, so the source scan below cannot see them.
      "gettingStartedMoreAfterSetup",
      "gettingStartedMoreAfterLive",
      // Reached through `copy("…")` literals in the component.
      ...[...source.matchAll(/copy\(\s*"([^"]+)"\s*\)/g)].map((match) => match[1]),
      "managerSetupProgress",
    ]);

    // Guard the guard: a scan that stopped matching would make this pass vacuously.
    expect(keys.size).toBeGreaterThanOrEqual(20);
    for (const locale of LOCALES) {
      for (const key of keys) {
        expect(catalogs[locale][key], `${locale}/manager.json is missing "${key}"`).toBeTruthy();
      }
    }
  });

  it("keeps every description short enough to set the panel's width", () => {
    for (const locale of LOCALES) {
      const rows = rowsIn(locale, "Desc");
      expect(rows.length, `${locale} has no descriptions`).toBeGreaterThanOrEqual(9);
      for (const [key, text] of rows) {
        // ~6.2px per character at 11px type; Cyrillic runs a little wider than Latin.
        expect(
          text.length * 6.2,
          `${locale} ${key} will be cut: "${text}"`,
        ).toBeLessThanOrEqual(availablePx);
      }
    }
  });

  it("keeps every label short too", () => {
    for (const locale of LOCALES) {
      const rows = rowsIn(locale, "label");
      expect(rows.length, `${locale} has no labels`).toBeGreaterThanOrEqual(9);
      for (const [key, text] of rows) {
        // ~6.9px per character at 12.5px type.
        expect(
          text.length * 6.9,
          `${locale} ${key} will be cut: "${text}"`,
        ).toBeLessThanOrEqual(availablePx);
      }
    }
  });

  it("keeps the Stripe mark in its own colour", () => {
    /*
     * Stripe is a third-party brand, not a UI icon. Painted with the brand tint it read as a missing
     * asset rather than as Stripe — the exact report that prompted this.
     */
    expect(source).toMatch(/stripe:\s*\{[^}]*text-stripe/);
  });

  it("calls the people who book CUSTOMERS, never cooks", () => {
    /*
     * A product decision, not a style preference: the host's customers are the people booking their
     * kitchen, and "cooks" is our internal word for the other side of the marketplace. Every
     * user-facing string here addresses the HOST, so it has to use theirs. Checked across locales —
     * the rule is about who the host is talking about, not about English.
     */
    const userFacing = LOCALES.flatMap((locale) =>
      Object.entries(catalogs[locale])
        .filter(([key]) => key.startsWith("gettingStarted"))
        .map(([, text]) => text),
    );

    expect(userFacing.length).toBeGreaterThanOrEqual(25);
    for (const text of userFacing) {
      expect(text, `"${text}" calls the booking side "cooks"`).not.toMatch(/\bcooks?\b/i);
    }
  });
});

/**
 * The collapsed rail breaks the panel's layout in a way nothing else can, so it gets its own guard.
 *
 * Two separate defects live here, both invisible to jsdom (no layout engine):
 *
 * 1. **The ring was off-centre and clipped.** `SidebarMenuButton` forces
 *    `group-data-[collapsible=icon]:!size-8` with `!p-2`, so the content box is **16×16**. A ring
 *    wider than that, left-aligned by the flex default, overflowed to the right and was cut by the
 *    button's `overflow-hidden`.
 * 2. **The track was invisible.** It was `stroke-muted`, and `--muted` is `220 14.3% 95.9%` against a
 *    `0 0% 100%` sidebar — about 1.05:1. Only the brand arc showed, so a partly-complete ring read as
 *    a broken fragment of a circle. Reported from the running app.
 */
describe("the widget survives the collapsed rail", () => {
  const source = readFileSync(
    join(process.cwd(), "client/src/components/manager/ManagerGettingStarted.tsx"),
    "utf8",
  );

  it("does not double up the sidebar's own padding", () => {
    /*
     * THE ACTUAL CAUSE OF THE SKEWED RING. `SidebarGroup` ships `p-2` and `SidebarFooter` ships
     * `p-2`, so leaving both live put the button in a 16px box while `SidebarMenuButton` forces
     * `!size-8` (32px). A 32px button in a 16px box overflows to the RIGHT, so its centre landed 8px
     * right of the rail's centre. The avatar below is centred because it sits directly in the footer
     * and gets ONE padding — this widget needs the same.
     */
    expect(source).toMatch(/<SidebarGroup className="relative p-0">/);
  });

  it("centres the ring on the BUTTON, not on the rail's narrow content box", () => {
    /*
     * The button's content box in icon mode is 16x16 (`!size-8` minus `!p-2`), and the ring is 30px.
     * Laid out in flow it overflows that box, so its position came down to overflow maths and it sat
     * skewed to the right. `inset-0 m-auto` pins it to the button instead, whatever the padding is.
     */
    expect(source).toMatch(/group-data-\[collapsible=icon\]:absolute/);
    expect(source).toMatch(/group-data-\[collapsible=icon\]:inset-0/);
    expect(source).toMatch(/group-data-\[collapsible=icon\]:m-auto/);
    // ...which needs the launcher to be a containing block.
    expect(source).toMatch(/"relative h-auto items-center/);
  });

  it("never paints the ring's TRACK with `muted`", () => {
    // `--muted` is 95.9% lightness on a 100% sidebar. The track must be a colour that reads.
    expect(source).not.toMatch(/stroke-muted["\s]/);
    expect(source).toMatch(/stroke-muted-foreground\/\d+/);
  });

  it("prints the percentage in the rail, where the text beside the ring is hidden", () => {
    // Without it the collapsed rail shows a ring with no way to read the value.
    expect(source).toMatch(/group-data-\[collapsible=icon\]:flex/);
    expect(source).toMatch(/Math\.round\(clamped \* 100\)/);
  });

  it("hides the two-line text and the chevron when the rail is icons only", () => {
    // Both are wider than 32px; leaving them visible is what would push the ring off-centre.
    const hiddenCount = [...source.matchAll(/group-data-\[collapsible=icon\]:hidden/g)].length;
    expect(hiddenCount).toBeGreaterThanOrEqual(2);
  });
});
