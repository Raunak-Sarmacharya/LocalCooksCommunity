import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { ApplicationFormProvider, useApplicationForm } from "./ApplicationFormContext";
import CertificationsForm from "./CertificationsForm";
import KitchenPreferenceForm from "./KitchenPreferenceForm";
import { ApplicationStepFooter } from "./ApplicationStepFooter";
import type { ApplicationFormData } from "@/lib/applicationSchema";
import copy from "@shared/i18n/locales/en-CA/chef.json";

const mocks = vi.hoisted(() => ({ upload: vi.fn(), toast: vi.fn(), navigate: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, vars?: Record<string, unknown>) =>
  ((copy as Record<string, string>)[key] || key).replace(/\{(\w+)\}/g, (_, name) => String(vars?.[name] ?? "")) }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: { getIdToken: async () => "test-token" } } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock("wouter", () => ({ useLocation: () => ["/dashboard", mocks.navigate] }));
vi.mock("@/hooks/useFileUpload", () => ({ useFileUpload: () => ({ uploadFile: mocks.upload, uploadProgress: 45, isUploading: false, error: null }) }));

function Seed({ data }: { data: Partial<ApplicationFormData> }) {
  const { updateFormData } = useApplicationForm();
  useEffect(() => { updateFormData(data); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
const sent = (data: Partial<ApplicationFormData>, children = <CertificationsForm />) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
    <ApplicationFormProvider><Seed data={{ fullName: "Sam Seller", email: "sam@example.com", phone: "+17095550188", contactMethod: "text", ...data }} />{children}</ApplicationFormProvider>
  </QueryClientProvider>);
const rows = () => screen.getAllByRole("button", { name: copy.sell_upload });
const body = (fetchMock: ReturnType<typeof vi.fn>) => JSON.parse(fetchMock.mock.calls[0][1].body);

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("documents step", () => {
  it("asks for the documents of the kitchen setting; a Local Cooks kitchen's licence is not needed", async () => {
    sent({ kitchenPreference: "commercial", commercialKitchen: "localcooks" });
    expect(await screen.findByText(copy.sell_doc_foodSafetyTraining)).toBeInTheDocument();
    expect(screen.getByText(copy.sell_doc_establishmentLicence)).toBeInTheDocument();
    expect(screen.getByText(copy.sell_notNeeded)).toBeInTheDocument();
    expect(rows()).toHaveLength(1);
    expect(screen.getByRole("link", { name: copy.sell_docApprovedCourses })).toHaveAttribute("href", expect.stringContaining("gov.nl.ca"));
  });

  it("home: Service NL registration and a recommended food safety certificate", async () => {
    sent({ kitchenPreference: "home" });
    expect(await screen.findByText(copy.sell_doc_homeRegistration)).toBeInTheDocument();
    expect(screen.getByText(copy.sell_docRecommendedHome)).toBeInTheDocument();
    expect(rows()).toHaveLength(2);
  });

  it("each row needs an upload or 'I don't have it yet'; then it sends without documents", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 1 }) });
    vi.stubGlobal("fetch", fetchMock);
    sent({ kitchenPreference: "notSure", foodTypes: ["baked"] });
    fireEvent.click(await screen.findByTestId("seller-application-submit"));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.sell_answerEachDocument);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: copy.sell_dontHaveYet }));
    expect(screen.getByText(copy.sell_missingIsFine)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("seller-application-submit"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(body(fetchMock)).toMatchObject({ kitchenPreference: "notSure", contactMethod: "text", foodTypes: ["baked"], foodSafetyLicense: "no", foodSafetyLicenseUrl: "" });
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/dashboard?view=applications&sent=1"));
  });

  it("an uploaded file is sent once, by its uploaded address", async () => {
    mocks.upload.mockResolvedValue({ success: true, url: "https://files.example/documents/7_cert.pdf" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 1 }) });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = sent({ kitchenPreference: "notSure" });
    await screen.findByText(copy.sell_doc_foodSafety);
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["pdf"], "cert.pdf", { type: "application/pdf" })] } });
    expect(await screen.findByText("cert.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("seller-application-submit"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(body(fetchMock)).toMatchObject({ foodSafetyLicense: "yes", foodSafetyLicenseUrl: "https://files.example/documents/7_cert.pdf" });
  });

  it("a server error says so and lets them try again", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: "Unavailable" }) }));
    sent({ kitchenPreference: "notSure" });
    fireEvent.click(await screen.findByRole("checkbox", { name: copy.sell_dontHaveYet }));
    fireEvent.click(screen.getByTestId("seller-application-submit"));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive", description: "Unavailable" })));
    await waitFor(() => expect(screen.getByTestId("seller-application-submit")).toBeEnabled());
  });
});

describe("kitchen step", () => {
  it("needs a choice; commercial asks which kitchen", async () => {
    sent({}, <KitchenPreferenceForm />);
    fireEvent.click(await screen.findByTestId("seller-application-continue"));
    expect(screen.getByRole("alert")).toHaveTextContent(copy.sell_kitchenRequired);
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(copy.sell_kitchenCommercial) }));
    expect(screen.getByRole("radio", { name: copy.sell_kitchenLocalCooks })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: copy.sell_foodBaked }));
    expect(screen.getByRole("button", { name: copy.sell_foodBaked })).toHaveAttribute("aria-pressed", "true");
  });
});

it("puts Back on the left and the main action on the right", () => {
  sent({}, <ApplicationStepFooter showPrevious continueLabel="Continue" />);
  const [back, next] = screen.getAllByRole("button");
  expect(back).toHaveTextContent(copy.sellerApp_back);
  expect(next).toHaveTextContent("Continue");
  expect(screen.queryByTestId("seller-application-cancel")).not.toBeInTheDocument();
});
