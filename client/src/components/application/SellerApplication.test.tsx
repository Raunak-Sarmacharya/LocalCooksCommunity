import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationFormProvider } from "./ApplicationFormContext";
import CertificationsForm from "./CertificationsForm";
import KitchenPreferenceForm from "./KitchenPreferenceForm";
import { ApplicationStepFooter } from "./ApplicationStepFooter";
import copy from "@shared/i18n/locales/en-CA/chef.json";

const mocks = vi.hoisted(() => ({ upload: vi.fn(), toast: vi.fn(), navigate: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => (copy as Record<string, string>)[key] || key }) }));
vi.mock("@/hooks/use-auth", () => ({ useFirebaseAuth: () => ({ user: { uid: "chef-test" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: { getIdToken: async () => "test-token" } } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock("wouter", () => ({ useLocation: () => ["/apply", mocks.navigate] }));
vi.mock("@/hooks/useFileUpload", () => ({ useFileUpload: () => ({ uploadFile: mocks.upload, uploadProgress: 45, isUploading: false, error: null }) }));

function mount(children = <CertificationsForm />) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}><ApplicationFormProvider>{children}</ApplicationFormProvider></QueryClientProvider>);
}

async function openUpload(index = 0) {
  fireEvent.click(screen.getAllByRole("radio", { name: copy.sellerApp_yes })[index]);
  return screen.findByRole("dialog");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("PointerEvent", MouseEvent);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("seller certifications", () => {
  it.each([0, 1])("reverts Yes when upload %s is dismissed outside without a document", async (index) => {
    mount();
    await openUpload(index);
    // Radix installs its outside-pointer listener on the next task.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    fireEvent.pointerDown(document.body, { pointerType: "mouse", button: 0 });
    fireEvent.click(document.body);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getAllByRole("radio", { name: copy.sellerApp_yes })[index]).toHaveAttribute("aria-checked", "false");
  });

  it.each([copy.sellerApp_aboutFoodSafety, copy.sellerApp_aboutFoodEst])("keeps %s help concise with a Learn more link", async title => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: title }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("link", { name: /Learn more/ })).toHaveAttribute("target", "_blank");
    expect(within(dialog).getByRole("link")).toHaveAttribute("rel", "noopener noreferrer");
    const sentences = Array.from(dialog.querySelectorAll("p")).flatMap(p => p.textContent?.match(/[^.!?]+[.!?]+/g) || []);
    expect(sentences.length).toBeLessThanOrEqual(3);
  });

  it("shows real upload progress, blocks dismissal while uploading, and retains completed uploads", async () => {
    let finish!: (result: { success: boolean; url: string }) => void;
    mocks.upload.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    mount();
    const dialog = await openUpload();
    fireEvent.change(dialog.querySelector('input[type="file"]')!, { target: { files: [new File(["pdf"], "license.pdf", { type: "application/pdf" })] } });
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("progressbar")).toHaveAttribute("aria-valuenow", "45");
    expect(screen.getByRole("button", { name: copy.sellerApp_back, hidden: true })).toBeDisabled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => finish({ success: true, url: "https://example.com/license.pdf" }));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getAllByRole("radio", { name: copy.sellerApp_yes })[0]).toHaveAttribute("aria-checked", "true");
  });

  it("reverts a failed upload on dismissal", async () => {
    mocks.upload.mockResolvedValue(null);
    mount();
    const dialog = await openUpload(1);
    fireEvent.change(dialog.querySelector('input[type="file"]')!, { target: { files: [new File(["pdf"], "certificate.pdf", { type: "application/pdf" })] } });
    await waitFor(() => expect(mocks.upload).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getAllByRole("radio", { name: copy.sellerApp_yes })[1]).toHaveAttribute("aria-checked", "false");
  });

  it("does not retain Yes for a whitespace-only document URL", async () => {
    mount();
    await openUpload();
    fireEvent.mouseDown(screen.getByRole("tab", { name: copy.sellerApp_provideUrl }), { button: 0, ctrlKey: false });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getAllByRole("radio", { name: copy.sellerApp_yes })[0]).toHaveAttribute("aria-checked", "false");
  });

  it.each(["yes", "no"])("submits uploaded files once and respects the final %s answer", async (answer) => {
    mocks.upload.mockResolvedValue({ success: true, url: "https://example.com/license.pdf" });
    const submit = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 1 }) });
    vi.stubGlobal("fetch", submit);
    mount();
    const dialog = await openUpload();
    fireEvent.change(dialog.querySelector('input[type="file"]')!, { target: { files: [new File(["pdf"], "license.pdf", { type: "application/pdf" })] } });
    await waitFor(() => expect(screen.getByText("license.pdf")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    const noRadios = screen.getAllByRole("radio", { name: copy.sellerApp_no });
    if (answer === "no") fireEvent.click(noRadios[0]);
    fireEvent.click(noRadios[1]);
    fireEvent.click(screen.getByTestId("seller-application-submit"));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(JSON.parse(submit.mock.calls[0][1].body)).toMatchObject({ foodSafetyLicense: answer, foodSafetyLicenseUrl: answer === "yes" ? "https://example.com/license.pdf" : "", foodEstablishmentCertUrl: "" });
  });

  it("re-enables submission after a server error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Unavailable" }) }));
    mount();
    screen.getAllByRole("radio", { name: copy.sellerApp_no }).forEach(radio => fireEvent.click(radio));
    fireEvent.click(screen.getByTestId("seller-application-submit"));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })));
    await waitFor(() => expect(screen.getByTestId("seller-application-submit")).toBeEnabled());
    expect(screen.getByRole("button", { name: copy.sellerApp_back })).toBeEnabled();
  });

  it("gives all certification choices uniform rounded dimensions", () => {
    mount();
    screen.getAllByRole("radio").forEach(radio => {
      expect(radio.closest("label")).toHaveClass("h-11", "w-full", "rounded-xl");
    });
  });

  it("disables Back and Submit until submission completes and navigates to success", async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise(resolve => { finish = resolve; })));
    mount();
    screen.getAllByRole("radio", { name: copy.sellerApp_no }).forEach(radio => fireEvent.click(radio));
    fireEvent.click(screen.getByTestId("seller-application-submit"));
    expect(await screen.findByRole("status")).toHaveTextContent(copy.sellerApp_certSubmitting);
    expect(screen.getByRole("button", { name: copy.sellerApp_back })).toBeDisabled();
    expect(screen.getByTestId("seller-application-submit")).toBeDisabled();
    await act(async () => finish({ ok: true, json: async () => ({ id: 1 }) } as Response));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/success"));
  });
});

it("uses named site radio controls for kitchen settings", () => {
  mount(<KitchenPreferenceForm />);
  const radio = screen.getByRole("radio", { name: copy.sellerApp_kpHomeTitle });
  fireEvent.click(radio);
  expect(radio).toHaveAttribute("aria-checked", "true");
  expect(radio).toHaveClass("rounded-full");
});

it("keeps Cancel out of the form footer and rounds both actions", () => {
  mount(<ApplicationStepFooter showPrevious continueLabel="Continue" />);
  expect(screen.queryByTestId("seller-application-cancel")).not.toBeInTheDocument();
  screen.getAllByRole("button").forEach(button => expect(button).toHaveClass("rounded-xl"));
});
