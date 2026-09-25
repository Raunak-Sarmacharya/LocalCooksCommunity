/**
 * RENDER HARNESS — KitchenApplicationForm
 *
 * Why this file exists.
 *
 * A `useMemo` FACTORY RUNS DURING THE RENDER BODY. It is not deferred. So if a component-scope
 * binding is declared BELOW the memo and the factory reads it, the read happens while that binding
 * is still in its temporal dead zone and React throws
 * "Cannot access 'X' before initialization", which the error boundary turns into a blank
 * "Something went wrong" page.
 *
 * That class of bug is invisible to every check this repo normally runs:
 *   - esbuild only proves syntax; it bundled the crashing file clean at EXIT=0;
 *   - `tsc` does NOT flag use-before-declaration when the read sits inside a function body,
 *     because it assumes the function may be called later (verified: the scoped typecheck passed
 *     while the page was crashing).
 *
 * And the real page sits behind email verification, so it cannot be opened locally to catch it.
 *
 * This harness closes that gap: it renders the ACTUAL component with its data hooks mocked, which
 * executes the whole component body plus every memo factory. A TDZ crash therefore fails a test
 * instead of shipping.
 */
import { beforeEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

/*
 * jsdom ships none of these, and the Radix/calendar primitives the form renders reach for them on
 * mount. Without the stubs the harness fails on an unrelated ReferenceError and stops being a
 * signal about the component itself.
 */
beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!("IntersectionObserver" in globalThis)) {
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    };
  }
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

/* Shared mutable fixtures, hoisted so the module mocks below can read them. */
const state = vi.hoisted(() => ({
  requirements: null as Record<string, unknown> | null,
  application: null as Record<string, unknown> | null,
  hasApplication: false,
  chefPhone: null as string | null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    /*
     * Returns the fallback copy, with simple `{token}` interpolation so assertions can read the real
     * rendered sentence ("Still needed: About You, …") rather than a literal "{items}".
     * ICU plural forms ("{count, plural, …}") are left untouched on purpose — the comma means this
     * regex does not match them, and they are not on the paths under test here.
     */
    t: (key: string, opts?: Record<string, unknown> | string) => {
      const base = typeof opts === "string" ? opts : (opts?.defaultValue as string) ?? key;
      if (!opts || typeof opts !== "object") return base;
      return base.replace(/\{(\w+)\}/g, (match, token: string) =>
        token in opts ? String(opts[token]) : match,
      );
    },
  }),
}));

vi.mock("@/i18n/common-ns", () => ({
  tt: (key: string, fallback?: string) => fallback ?? key,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/hooks/use-auth", () => ({
  useFirebaseAuth: () => ({
    user: { displayName: "Test Chef", email: "chef@example.com" },
  }),
}));

vi.mock("@/hooks/use-email-verification-guard", () => ({
  useEmailVerificationGuard: () => ({
    blocked: false,
    guard: (fn: () => unknown) => fn(),
    gate: null,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("wouter", () => ({
  useLocation: () => [null, vi.fn()],
}));

vi.mock("@/hooks/use-chef-kitchen-applications", () => ({
  useChefKitchenApplications: () => ({
    createApplication: { mutateAsync: vi.fn() },
    refetch: vi.fn(),
  }),
  useChefKitchenApplicationForLocation: () => ({
    application: state.application,
    hasApplication: state.hasApplication,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-presigned-document-url", () => ({
  usePresignedDocumentUrl: () => ({ url: null }),
}));

/*
 * `useQuery` is called for the chef profile and for the location requirements. Branch on the query
 * key so the schema memo actually receives a requirements payload — that is the path that crashed.
 */
vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey?: unknown[] }) => {
    const key = JSON.stringify(opts?.queryKey ?? []);
    if (key.includes("my-profile")) {
      return { data: { phone: state.chefPhone }, isLoading: false };
    }
    if (key.includes("requirements")) {
      return { data: state.requirements, isLoading: false };
    }
    return { data: undefined, isLoading: false };
  },
}));

import KitchenApplicationForm from "./KitchenApplicationForm";

const location = {
  id: 42,
  name: "Test Kitchen",
  address: "1 Test Street",
  city: "Toronto",
};

/** Every flag the checklist reads, so both the schema memo and the progress builder run fully. */
const FULL_REQUIREMENTS = {
  requireFirstName: true,
  requireLastName: true,
  requireEmail: true,
  requirePhone: true,
  requireBusinessName: true,
  requireBusinessType: true,
  requireBusinessDescription: false,
  requireFoodHandlerCert: true,
  requireFoodHandlerExpiry: true,
  requireUsageFrequency: true,
  requireSessionDuration: false,
  requireTermsAgree: true,
  requireAccuracyAgree: true,
  tier1_years_experience_required: true,
  tier1_custom_fields: [
    { id: "cf-1", label: "Portfolio link", type: "text", required: true },
    { id: "cf-2", label: "Extra note", type: "textarea", required: false },
  ],
  tier2_food_establishment_cert_required: true,
  tier2_food_establishment_expiry_required: true,
  tier2_insurance_document_required: true,
  tier2_kitchen_experience_required: true,
  tier2_custom_fields: [],
};

beforeEach(() => {
  state.requirements = FULL_REQUIREMENTS;
  state.application = null;
  state.hasApplication = false;
  state.chefPhone = null;
});

describe("KitchenApplicationForm render harness", () => {
  it("renders tier 1 without throwing", () => {
    expect(() =>
      render(<KitchenApplicationForm location={location} />),
    ).not.toThrow();
    // Two instances on purpose: the wide block below `lg` and the sticky rail at `lg`+. Only one is
    // visible at a time, and both drive the same <form> through `form={FORM_ID}`.
    expect(screen.getAllByTestId("kitchen-application-submit").length).toBeGreaterThan(0);
  });

  it("renders tier 1 when a phone number is already on file", () => {
    // Exercises the other side of the `hasPhoneOnFile` branch inside the schema memo.
    state.chefPhone = "4165550123";
    expect(() =>
      render(<KitchenApplicationForm location={location} />),
    ).not.toThrow();
  });

  it("renders tier 1 when the requirements payload has not loaded yet", () => {
    state.requirements = null;
    expect(() =>
      render(<KitchenApplicationForm location={location} />),
    ).not.toThrow();
  });

  it("renders tier 2 for an approved application", () => {
    state.application = {
      current_tier: 2,
      status: "approved",
      fullName: "Test Chef",
      email: "chef@example.com",
    };
    state.hasApplication = true;
    expect(() =>
      render(<KitchenApplicationForm location={location} />),
    ).not.toThrow();
    // Two instances on purpose: the wide block below `lg` and the sticky rail at `lg`+. Only one is
    // visible at a time, and both drive the same <form> through `form={FORM_ID}`.
    expect(screen.getAllByTestId("kitchen-application-submit").length).toBeGreaterThan(0);
  });

  it("renders with a global app present (registration hand-off)", () => {
    // `globalApp` flips `isTier2OrHigher` in the schema memo, a different branch again.
    expect(() =>
      render(
        <KitchenApplicationForm
          location={location}
          globalApp={{ phone: "4165550123", businessName: "Test Co" }}
        />,
      ),
    ).not.toThrow();
  });
});

/**
 * The date control must read as a form input, not as a call-to-action: shadcn's `Button` applies the
 * chef CTA treatment (pill + shadow + red glow) to `default`/`outline`, and the shared `DateField`
 * used to lean on it. It is now a plain `<button>` shaped like every other input here.
 */
describe("date fields read as inputs", () => {
  it("renders a date custom field with an input-shaped trigger", () => {
    state.requirements = {
      ...FULL_REQUIREMENTS,
      tier1_custom_fields: [
        { id: "d1", label: "Preferred start date", type: "date", required: false },
      ],
    };
    render(<KitchenApplicationForm location={location} />);

    // Queried by text rather than `getByRole(..., { name })`: the trigger's accessible name does
    // not resolve through the aria-hidden calendar icon, so the role query finds nothing.
    const trigger = screen.getAllByText("selectDate")[0].closest("button");
    expect(trigger).not.toBeNull();
    expect(trigger).toHaveClass("h-10");
    // A `w-full` sibling Input stretches; the trigger must not sit at auto width.
    expect(trigger!.className).not.toMatch(/sm:w-auto/);
    // Content is left-aligned like the text in every other input, not centred.
    expect(trigger!.className).not.toMatch(/justify-center/);
  });

  it("renders the certificate expiry picker at the same height as the inputs", () => {
    state.requirements = { ...FULL_REQUIREMENTS, requireFoodHandlerCert: true };
    render(<KitchenApplicationForm location={location} />);
    // No control in this form may be `h-11` while the inputs are `h-10` — that is what made the
    // date row sit 4px taller than its neighbours.
    expect(document.querySelectorAll(".h-11").length).toBe(0);
  });
});

/**
 * A `/* *\/` block written directly in JSX children position is NOT a comment — JSX renders it as
 * literal text. It has to be `{/* *\/}`. esbuild and `tsc` both pass happily because it is valid
 * JS syntax there, so only rendering catches it.
 */
describe("no source comment leaks into the rendered page", () => {
  it.each([
    ["tier 1", null as Record<string, unknown> | null],
    ["tier 2", { current_tier: 2, status: "approved", fullName: "Test Chef" }],
  ])("renders %s with no comment markers", (_name, application) => {
    state.application = application;
    state.hasApplication = application !== null;
    render(<KitchenApplicationForm location={location} />);
    expect(document.body.textContent ?? "").not.toMatch(/\*\//);
    expect(document.body.textContent ?? "").not.toMatch(/\/\*/);
  });
});

/**
 * Every item the progress rail can list must have a control on the page that can satisfy it.
 * Otherwise the rail names something the chef cannot act on and the form becomes unsubmittable.
 */
describe("rail items are reachable from the form", () => {
  it("renders a phone input in tier 1 when no number is on file", () => {
    // The Tier-1 schema requires phone whenever none is on file, and the rail counts "About You" as
    // incomplete until it is filled — so without this input the chef was hard-blocked.
    state.chefPhone = null;
    const { container } = render(<KitchenApplicationForm location={location} />);
    expect(container.querySelector('input[type="tel"]')).not.toBeNull();
  });

  it("does not ask for a phone when one is already on file", () => {
    state.chefPhone = "4165550123";
    const { container } = render(<KitchenApplicationForm location={location} />);
    expect(container.querySelector('input[type="tel"]')).toBeNull();
  });

  it("names optional business fields exactly as the form labels them", () => {
    // A rail row must be findable on the page. These two used to be rail-only keys reading
    // "Business Description" / "Business Type" while the form said "Tell Us About Your Business" /
    // "Type of Food Business" - so the chef looked for a field that appeared not to exist.
    state.requirements = {
      ...FULL_REQUIREMENTS,
      requireBusinessName: false,
      requireBusinessType: false,
      requireBusinessDescription: false,
    };
    render(<KitchenApplicationForm location={location} />);

    const labels = Array.from(document.querySelectorAll("label")).map((l) =>
      (l.textContent ?? "").trim(),
    );
    // Both names come from the same i18n keys the form labels use, so they must be present.
    expect(labels.some((l) => /^Business Type/.test(l))).toBe(true);
    expect(labels.some((l) => /^Business Description/.test(l))).toBe(true);
  });

  it("tracks the tier 2 food safety certificate that submit blocks on", () => {
    // Rendered in tier 2 AND enforced by `requireFoodHandlerCert`, yet the rail had no row for it,
    // which let the bar read "ready" on a form the submit handler would reject.
    //
    // Asserted as a DIFFERENCE, because the form always renders the label once: the extra matches
    // when the flag is on are the two tracker instances adding the row.
    state.application = { current_tier: 2, status: "approved", fullName: "Test Chef" };
    state.hasApplication = true;

    state.requirements = { ...FULL_REQUIREMENTS, requireFoodHandlerCert: false };
    const { unmount } = render(<KitchenApplicationForm location={location} />);
    const without = screen.getAllByText(/Food safety certificate/).length;
    unmount();

    state.requirements = { ...FULL_REQUIREMENTS, requireFoodHandlerCert: true };
    render(<KitchenApplicationForm location={location} />);
    const withFlag = screen.getAllByText(/Food safety certificate/).length;

    expect(withFlag).toBeGreaterThan(without);
  });

  it("shows the business fields when a global application has not supplied them", () => {
    // The registration hand-off carries name/email/phone ONLY. Hiding the section on the mere
    // existence of a global application left "Your Food Business" permanently unfillable.
    render(
      <KitchenApplicationForm
        location={location}
        globalApp={{ fullName: "Test Chef", email: "chef@example.com", phone: "4165550123" }}
      />,
    );
    expect(screen.getByText(/^Business Name/)).toBeInTheDocument();
  });
});
describe("requirement-driven labelling", () => {
  it("names the outstanding items instead of telling the chef to look above", () => {
    render(<KitchenApplicationForm location={location} />);

    // The generic instruction is gone...
    expect(screen.queryByText(/Fill in the required items above/i)).toBeNull();
    // ...replaced by the actual outstanding items, exactly ONCE per tracker instance (the wide block
    // and the rail). A count of 4 would mean the old footer copy is still being rendered too.
    const stillNeeded = screen.getAllByText(/^Still needed:/);
    expect(stillNeeded).toHaveLength(2);
    expect(stillNeeded[0].textContent).toMatch(/Still needed: .+/);
  });

  it("marks Business Name with a required asterisk when the kitchen requires it", () => {
    // `requireBusinessName` defaults to TRUE server-side, so the old hardcoded "(Optional)" here
    // invited the chef to skip a field the validator then rejected.
    state.requirements = { ...FULL_REQUIREMENTS, requireBusinessName: true };
    render(<KitchenApplicationForm location={location} />);

    const labels = screen
      .getAllByText(/^Business Name/)
      .map((node) => node.closest("label"))
      .filter(Boolean);
    expect(labels).toHaveLength(1);
    expect(labels[0]!.textContent).toContain("*");
    expect(labels[0]!.textContent).not.toContain("(Optional)");
  });

  it("marks Business Name optional — with no asterisk — when the kitchen does not require it", () => {
    state.requirements = { ...FULL_REQUIREMENTS, requireBusinessName: false };
    render(<KitchenApplicationForm location={location} />);

    const labels = screen
      .getAllByText(/^Business Name/)
      .map((node) => node.closest("label"))
      .filter(Boolean);
    expect(labels).toHaveLength(1);
    expect(labels[0]!.textContent).toContain("(Optional)");
    expect(labels[0]!.textContent).not.toContain("*");
  });
});
