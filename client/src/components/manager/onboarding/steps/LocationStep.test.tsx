import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two gates on the Business step, driven through the real component.
 *
 * The component owns both rules, and neither is a pure function, so the only honest
 * check is to render it and read the Continue button. Everything the wizard would
 * otherwise reach for — the onboarding context, Firebase, the upload hooks — is mocked,
 * because none of it is what is under test; the context is what supplies the form state
 * the gates read.
 */
const h = vi.hoisted(() => ({
  /** Overrides merged over the valid base form. */
  form: {} as Record<string, unknown>,
  /** What the auth user reports for `users.phone_number` and its proof. */
  account: { phoneNumber: "", phoneVerified: false },
  /** The licence on file, as the context holds it. */
  license: { expiryDate: "" },
  /**
   * Overrides for the STORED RECORD, which the form is seeded from.
   *
   * Separate from `form` on purpose: the two agree in the app until something is edited, and a
   * test that wants to know WHICH of them a screen reads has to be able to pull them apart.
   */
  record: {} as Record<string, unknown>,
  /** Which steps the wizard would call complete, so a case can open the review. */
  completed: {} as Record<string, boolean>,
}));

vi.mock("@/i18n/manager", () => ({
  mt: (key: string) => key,
}));
vi.mock("@/i18n/common-ns", () => ({
  tt: (key: string) => (key === "continue" ? "Continue" : key),
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));
vi.mock("@/hooks/use-auth", () => ({
  useFirebaseAuth: () => ({ user: h.account }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useSessionFileUpload", () => ({
  useSessionFileUpload: () => ({ uploadFile: vi.fn() }),
}));
vi.mock("@/components/manager/kitchen/KitchenPhotoFields", () => ({
  ACCEPTED_IMAGE_TYPES: ["image/png"],
  LogoPhotoField: () => null,
}));
// The verification form is not under test here — it is the component that decides
// whether the number is proved, and this file asserts what the step does with that
// verdict. Its own rules live in PhoneSignInSettings.test.tsx.
vi.mock("@/components/auth/PhoneSignInSettings", () => ({
  default: () => null,
}));
// The footer's animated label splits the text into one span per character, so a
// plain button is the readable stand-in. What this file checks is the `disabled`
// the step hands down, not how the button animates it.
vi.mock("@/components/ui/status-button", () => ({
  StatusButton: ({
    labels,
    disabled,
    onClick,
  }: {
    labels?: { idle?: string };
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>{labels?.idle}</button>
  ),
}));

vi.mock("../ManagerOnboardingContext", () => ({
  useManagerOnboarding: () => {
    /**
     * The stored record MIRRORS the seeded form, because that is what the app does:
     * `locationForm` is seeded from the fetched location, so arriving on a saved location
     * means the two agree. A record missing those fields made every render read as unsaved
     * work — the footer then names the button "saveAndContinue", and the Continue lookups
     * below would never find it.
     */
    const form = {
      name: "Harbour Kitchen",
      address: "1 Water St, St. John's, NL",
      logoUrl: "https://cdn.example.com/logo.png",
      contactEmail: "manager@example.com",
      contactPhone: "",
      preferredContactMethod: "email",
      notificationEmail: "",
      notificationPhone: "",
      ...h.form,
    };
    return {
      locationForm: {
        ...form,
        setName: vi.fn(),
        setAddress: vi.fn(),
        setLogoUrl: vi.fn(),
        setContactEmail: vi.fn(),
        setContactPhone: vi.fn(),
        setNotificationEmail: vi.fn(),
        setNotificationPhone: vi.fn(),
        setPreferredContactMethod: vi.fn(),
      },
      licenseForm: {
        file: null,
        setFile: vi.fn(),
        expiryDate: h.license.expiryDate,
        setExpiryDate: vi.fn(),
        isUploading: false,
        uploadedUrl: null,
        uploadFile: vi.fn(),
      },
      termsForm: {
        file: null,
        setFile: vi.fn(),
        isUploading: false,
        uploadedUrl: null,
        uploadFile: vi.fn(),
      },
      // A licence and terms already on file, WITH an expiry — i.e. a COMPLETE record, which is
      // what the base state has to be: the step opens where the record says, so an incomplete
      // base would send every case that expects part 0 to the part that is still owed instead.
      // Cases that need something missing override it through `h.record` / `h.license`.
      selectedLocation: {
        id: 1,
        name: form.name,
        address: form.address,
        logoUrl: form.logoUrl,
        preferredContactMethod: form.preferredContactMethod,
        contactEmail: form.contactEmail,
        contactPhone: form.contactPhone,
        kitchenLicenseUrl: "https://cdn.example.com/license.pdf",
        kitchenLicenseExpiry: h.license.expiryDate || null,
        kitchenTermsUrl: "https://cdn.example.com/terms.pdf",
        // Pulled apart from the form only when a case asks for it.
        ...h.record,
      },
      // The step opens wherever the RECORD says, so a case that wants to start at part 0 needs a
      // record with nothing left owing; a case that wants the review needs the same thing plus
      // the step flagged complete.
      completedSteps: h.completed,
      handleNext: vi.fn(),
      handleBack: vi.fn(),
      isFirstStep: false,
      isSubmitting: false,
      saveAndExit: vi.fn(),
      saveLocationDraft: vi.fn().mockResolvedValue(true),
      saveLocationFull: vi.fn().mockResolvedValue(true),
      setUnsavedChanges: vi.fn(),
      registerStepSave: vi.fn(),
    };
  },
}));

import LocationStep from "./LocationStep";

beforeEach(() => {
  h.form = {};
  h.account = { phoneNumber: "", phoneVerified: false };
  // The licence carries a date by default: it is what makes the base record complete, and a
  // complete record is what lets a case start at part 0. Cases about the missing date set it to
  // "" themselves.
  h.license = { expiryDate: "2027-03-01" };
  h.record = {};
  h.completed = {};
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const continueButton = () => screen.getByRole("button", { name: "Continue" });

/** Advance from part 0. The base form satisfies it, so the button is live. */
function goToPart1() {
  fireEvent.click(continueButton());
}

function goToPart2() {
  goToPart1();
  fireEvent.click(continueButton());
}

describe("Business step — contact part", () => {
  it("lets an email-only manager continue without proving a phone", () => {
    render(<LocationStep />);
    goToPart1();

    expect(continueButton()).toBeEnabled();
  });

  it("holds the manager on the part when phone is the contact method and no number is proved", () => {
    h.form = { preferredContactMethod: "phone", contactPhone: "+17095551234" };
    render(<LocationStep />);
    goToPart1();

    expect(continueButton()).toBeDisabled();
  });

  it("lets them continue once the account holds that same number as proved", () => {
    h.form = { preferredContactMethod: "phone", contactPhone: "+17095551234" };
    h.account = { phoneNumber: "+17095551234", phoneVerified: true };
    render(<LocationStep />);
    goToPart1();

    expect(continueButton()).toBeEnabled();
  });

  // The proof belongs to ONE number. Editing the field to a number nobody has
  // confirmed must take the gate back down, or the manager could pick a contact
  // method that reaches nobody.
  it("takes the gate back down when the field no longer holds the proved number", () => {
    h.form = { preferredContactMethod: "both", contactPhone: "+17095559999" };
    h.account = { phoneNumber: "+17095551234", phoneVerified: true };
    render(<LocationStep />);
    goToPart1();

    expect(continueButton()).toBeDisabled();
  });
});

describe("Business step — the review", () => {
  /**
   * The review reports what has been SAVED.
   *
   * It used to read the live form, so an uncommitted edit showed up in it: clear the business name
   * in part 1, press Back, and the review announced "Not set" for a name that was still on the
   * record and still going to be saved. The kitchen listing review has always read the record.
   *
   * `h.record` puts the two deliberately out of step, which is the only way to tell them apart —
   * in the app they agree until something is edited.
   */
  it("reports the saved record, not the draft the manager is typing into", () => {
    h.form = { name: "A draft that was never saved" };
    h.record = { name: "Harbour Kitchen" };
    h.completed = { location: true };
    /*
     * The record has to be COMPLETE for the review to be the screen this case lands on. A step
     * that is flagged complete but still owes a required part opens on that part instead — see
     * the "where it opens" block below. The base fixture supplies the licence expiry that makes
     * it complete; `h.record` deliberately does not remove it.
     */
    render(<LocationStep />);

    expect(screen.getByText("Harbour Kitchen")).toBeInTheDocument();
    expect(screen.queryByText("A draft that was never saved")).not.toBeInTheDocument();
  });
});

/**
 * Where a returning manager lands inside the step.
 *
 * The reported bug: fill in part 1 of the Business step, press "Save & exit", come back — and the
 * step opens on its REVIEW. That review reports the parts that are saved and reads "Not set" for
 * the ones that were never opened, and its Continue is the way forward, so it both looks finished
 * and lets the manager past work they never did.
 *
 * `completedSteps['location']` was never wrong about the STEP — it was simply not the question.
 * The step's own parts are, so the resume point reads the record.
 */
describe("Business step — where it opens", () => {
  const headOf = (key: string) => screen.queryByText(key) !== null;

  it("resumes at the CONTACT part for a location created outside the wizard", () => {
    /*
     * The requirement: the Business step has three internal parts, and completing some of them
     * elsewhere must not mark the whole step done — the wizard has to pick up at the first part the
     * record still owes.
     *
     * This is the shape a dashboard-created location has: the identity fields (name, address, logo)
     * are on the record because that is what creating one writes, and nothing else is — no contact
     * details, no licence. So part 1 is owed, and part 1 is where the step must open.
     *
     * No `h.completed` flag, deliberately: the manager has never finished this step, and the
     * derivation must not need one to get this right. `recordResumePart` reads the RECORD, so work
     * done anywhere else is counted without anything having to tell the wizard about it.
     */
    h.record = { contactEmail: "", kitchenLicenseUrl: null, kitchenLicenseExpiry: null };
    h.completed = {};
    render(<LocationStep />);

    expect(headOf("businessPartContactTitle")).toBe(true);
    expect(headOf("businessPartDetailsTitle")).toBe(false);
    expect(headOf("businessSummaryTitle")).toBe(false);
  });

  it("resumes at the LICENCE part once the contact details are on the record", () => {
    // The next outstanding part, by the same rule — proving it walks the parts in order rather
    // than always landing on the same one.
    h.record = { kitchenLicenseUrl: null, kitchenLicenseExpiry: null };
    h.completed = {};
    render(<LocationStep />);

    expect(headOf("businessPartDocumentsTitle")).toBe(true);
    expect(headOf("businessSummaryTitle")).toBe(false);
  });

  it("opens the part the record still owes, not the review, when the step is flagged complete", () => {
    h.completed = { location: true };
    // Part 1 saved (name, address, logo); contact details and the licence never were.
    h.record = { contactEmail: "", kitchenLicenseUrl: null, kitchenLicenseExpiry: null };
    render(<LocationStep />);

    expect(headOf("businessPartContactTitle")).toBe(true);
    expect(headOf("businessSummaryTitle")).toBe(false);
  });

  it("opens the documents part when only the licence is missing", () => {
    h.completed = { location: true };
    h.record = { kitchenLicenseUrl: null, kitchenLicenseExpiry: null };
    render(<LocationStep />);

    expect(headOf("businessPartDocumentsTitle")).toBe(true);
    expect(headOf("businessSummaryTitle")).toBe(false);
  });

  it("opens the review once the record owes nothing", () => {
    h.completed = { location: true };
    h.license = { expiryDate: "2027-03-01" };
    render(<LocationStep />);

    expect(headOf("businessSummaryTitle")).toBe(true);
  });

  it("will not let the review be a way past a required part", () => {
    /*
     * Defence in depth. With the rule above this is unreachable — but the review used to be
     * exempt from the gate on the stated grounds that "it is only reachable once the step is
     * complete", which was false whenever the step was flagged complete from a part. Removing the
     * licence from the record while the review is open is the cheapest way to ask the gate a
     * question it must answer: an ungated review is a Skip button wearing a summary's clothes.
     */
    h.completed = { location: true };
    h.license = { expiryDate: "2027-03-01" };
    const { rerender } = render(<LocationStep />);
    expect(headOf("businessSummaryTitle")).toBe(true);
    expect(continueButton()).toBeEnabled();

    h.record = { kitchenLicenseUrl: null, kitchenLicenseExpiry: null };
    rerender(<LocationStep />);

    expect(continueButton()).toBeDisabled();
  });
});

describe("Business step — documents part", () => {
  // The reported bug: the licence and the terms were on file, no expiry date had ever
  // been entered, and Continue was live — so a licence nobody can review or warn about
  // could be submitted.
  it("holds the manager when a licence is on file with no expiry date", () => {
    h.license = { expiryDate: "" };
    render(<LocationStep />);
    goToPart2();

    expect(continueButton()).toBeDisabled();
  });

  it("lets them continue once the licence carries an expiry date", () => {
    h.license = { expiryDate: "" };
    const { rerender } = render(<LocationStep />);
    goToPart2();
    expect(continueButton()).toBeDisabled();

    // The date arriving is the only thing that changes — the licence and the terms are
    // already on file. Entering it through the calendar is a Radix interaction, not
    // this rule, so it is supplied the way the context supplies it.
    h.license = { expiryDate: "2027-03-01" };
    rerender(<LocationStep />);

    expect(continueButton()).toBeEnabled();
  });

  // A licence that is already on file is not pending work. Comparing the session's upload
  // slot (null when nothing was chosen) against the stored URL made opening this part read
  // as unsaved, so the footer offered to save a record nobody had touched. The button is
  // looked up BY NAME, so this fails if the label flips to the save variant.
  it("does not read a licence that is already on file as unsaved work", () => {
    h.license = { expiryDate: "2027-03-01" };
    render(<LocationStep />);
    goToPart2();

    expect(continueButton()).toBeEnabled();
    expect(screen.queryByRole("button", { name: "saveAndContinue" })).not.toBeInTheDocument();
  });
});
