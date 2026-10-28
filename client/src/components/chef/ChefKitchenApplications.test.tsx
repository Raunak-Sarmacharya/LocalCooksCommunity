import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const state = vi.hoisted(() => ({ search: "?view=kitchen-requests", applications: [] as any[], loading: false, error: null as any, navigate: vi.fn(), refetch: vi.fn() }));
vi.mock("@/hooks/use-chef-kitchen-applications", () => ({ useChefKitchenApplications: () => ({ applications: state.applications, isLoading: state.loading, error: state.error, refetch: state.refetch }) }));
vi.mock("wouter", async original => ({ ...await original<typeof import("wouter")>(), useSearch: () => state.search, useLocation: () => ["/dashboard", state.navigate] }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, options?: any) => typeof options === "string" ? options : options?.defaultValue?.replace(/\{(\w+)\}/g, (_: string, name: string) => String(options[name] ?? "")) || key, i18n: { language: "en-CA" } }) }));
vi.mock("@/hooks/use-presigned-document-url", () => ({ usePresignedDocumentUrl: (url: string) => ({ url, isLoading: false, error: null }) }));
import ChefKitchenApplications from "./ChefKitchenApplications";

const fixture = (id: number, status: string, current_tier: number, extra = {}) => ({ id, status, current_tier, createdAt: "2026-10-01", updatedAt: "2026-10-09", locationId: 46, location: { id: 46, name: `Kitchen ${id}`, address: "14 McDougall St" }, fullName: "Jamie Chef", email: "jamie@example.test", phone: "555-0100", kitchenPreference: "commercial", foodSafetyLicense: "yes", businessDescription: JSON.stringify({ businessName: "Jamie’s catering", businessType: "Catering", description: "Fresh meals", usageFrequency: "weekly", sessionDuration: "2-4" }), ...extra });
let client: QueryClient;
beforeEach(() => {
  state.search = "?view=kitchen-requests"; state.loading = false; state.error = null; state.navigate.mockClear(); state.refetch.mockClear(); window.scrollTo = vi.fn();
  state.applications = [fixture(7, "inReview", 1), fixture(8, "approved", 2), fixture(9, "approved", 3), fixture(10, "cancelled", 1)];
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["/api/public/locations/46/requirements"], { tier1_custom_fields: [{ id: "consent", label: "Delivery available", type: "checkbox" }, { id: "file_a", label: "Business plan", type: "file" }], tier2_custom_fields: [{ id: "file_b", label: "Cleaning plan", type: "file" }, { id: "capacity", label: "Team size", type: "number" }] });
});
afterEach(() => { cleanup(); client.clear(); });
const page = () => <QueryClientProvider client={client}><ChefKitchenApplications /></QueryClientProvider>;

it("lists kitchens as cards, what needs the chef first, each with its next step (owner-approved mock, Oct 26)", () => {
  render(page());
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.queryByText(/APPLICATION-/)).not.toBeInTheDocument();
  const rows = screen.getAllByTestId(/^kitchen-access-row-/);
  expect(rows.map(row => row.getAttribute("data-testid"))).toEqual(["kitchen-access-row-8", "kitchen-access-row-7", "kitchen-access-row-9", "kitchen-access-row-10"]);
  expect(rows[0]).toHaveAttribute("href", "/dashboard?view=kitchen-requests&application=8");
  expect(within(rows[0]).getByText("Send booking requirements")).toBeInTheDocument();
  expect(within(rows[2]).getByText("Book kitchen time")).toBeInTheDocument();
  expect(screen.getByText(/1 needs you/)).toBeInTheDocument();
});

it("opens a full page for the linked application with every submitted custom answer and document", () => {
  state.search += "&application=8";
  state.applications[1] = fixture(8, "approved", 2, { foodSafetyLicenseUrl: "https://files.localcooks.ca/documents/safety.pdf", foodSafetyLicenseExpiry: "2099-12-31", foodEstablishmentCertUrl: "https://files.localcooks.ca/documents/licence.pdf", foodEstablishmentCertExpiry: "2099-11-30", customFieldsData: { consent: false, file_a: "https://files.localcooks.ca/documents/business.pdf" }, tier2_completed_at: "2026-10-09", tier_data: { tierFiles: { tier2_insurance_document: "https://files.localcooks.ca/documents/insurance.pdf" }, kitchen_experience_description: "I prepare meals for 20 people.", tier2_custom_fields_data: { file_b: "https://files.localcooks.ca/documents/cleaning.pdf", capacity: 0 }, admin_review_note: "Private internal note" }, feedback: "Please renew your licence.", sourceTourId: 83 });
  render(page());
  expect(screen.getByRole("heading", { name: "Kitchen 8", level: 1 })).toBeInTheDocument();
  expect(screen.getByTestId("kitchen-access-tracker")).toBeInTheDocument();
  expect(screen.getByTestId("kitchen-access-next")).toHaveTextContent("Kitchen 8 is checking your booking requirements");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.getByText("Jamie’s catering")).toBeInTheDocument();
  expect(screen.getByText("Weekly (regular user)")).toBeInTheDocument();
  expect(screen.getByText("2–4 hours")).toBeInTheDocument();
  expect(screen.getByText("Delivery available").nextElementSibling).toHaveTextContent("No");
  expect(screen.getByText("Team size").nextElementSibling).toHaveTextContent("0");
  expect(screen.getByText("I prepare meals for 20 people.")).toBeInTheDocument();
  expect(screen.getByText("Please renew your licence.")).toBeInTheDocument();
  for (const name of ["safety", "licence", "business", "insurance", "cleaning"]) expect(screen.getAllByRole("link").some(link => link.getAttribute("href") === `https://files.localcooks.ca/documents/${name}.pdf`)).toBe(true);
  expect(screen.getByRole("link", { name: "View kitchen tour" })).toHaveAttribute("href", "/dashboard?view=viewings&viewing=83");
  expect(screen.queryByText(/Private internal note|manager.*review|admin.*review/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Send booking requirements" })).not.toBeInTheDocument();
});

it.each([
  ["approved", 2, {}, "Send booking requirements"],
  ["approved", 3, {}, "Book kitchen time"],
  ["rejected", 2, {}, "Send a new request"],
])("offers the correct action for %s at tier %s", (status, tier, extra, label) => {
  state.search += "&application=8"; state.applications[1] = fixture(8, status, tier, extra);
  render(page());
  expect(screen.getByRole(label === "Book kitchen time" ? "button" : "link", { name: label })).toBeInTheDocument();
});

it("lands on the kitchen page after Send with a one-time banner, selected by location", () => {
  state.search += "&location=46&sent=1"; state.applications = [fixture(7, "inReview", 1)];
  render(page());
  expect(screen.getByTestId("request-sent-banner")).toHaveTextContent("Request sent to Kitchen 7.");
  expect(screen.getByTestId("kitchen-access-next")).toHaveTextContent("Waiting for Kitchen 7");
  expect(screen.getByText("Nothing is reserved or charged.", { exact: false })).toBeInTheDocument();
});

it("tells a chef who already applied where the request stands", () => {
  state.search += "&location=46&notice=applied"; state.applications = [fixture(7, "inReview", 1)];
  render(page());
  expect(screen.getByTestId("application-tour-notice")).toHaveTextContent("You’ve already sent Kitchen 7 a request.");
});

it("in review, the kitchen's documents are optional to add now, each from its own row (owner, Oct 27: no big form)", () => {
  state.search += "&application=7"; state.applications = [fixture(7, "inReview", 1, { documents: [{ key: "foodSafetyLicense", label: "Food safety certificate", mode: "required", hasExpiry: true, uploaded: false, status: null, expiry: null, daysLeft: null, stage: null, renewalPending: false, waived: false }] })];
  render(page());
  expect(screen.getByText("Next, the kitchen asks for these")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Upload" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Upload" }));
  expect(screen.getByRole("button", { name: "Send food safety certificate" })).toBeInTheDocument();
});

it("approved without booking requirements: step 2 reads Not needed and the page says so", () => {
  state.search += "&application=9"; state.applications[2] = fixture(9, "approved", 3, { documentsWaivedAt: "2026-10-20" });
  render(page());
  expect(screen.getByTestId("kitchen-access-tracker")).toHaveTextContent("Not needed");
  expect(screen.getByTestId("kitchen-access-next")).toHaveTextContent("doesn’t need booking requirements from you");
});

it("a customer the kitchen added sees who added them, not a request they never sent", () => {
  state.search += "&application=8"; state.applications[1] = fixture(8, "approved", 2, { tier_data: { addedByKitchen: true } });
  render(page());
  expect(screen.getByTestId("kitchen-access-tracker")).toHaveTextContent("Added by the kitchen");
  expect(screen.getByTestId("kitchen-access-next")).toHaveTextContent("Kitchen 8 added you as a customer.");
  expect(screen.queryByRole("heading", { name: "Your request" })).not.toBeInTheDocument();
});

it("keeps approved access visible when the kitchen is paused without offering booking", () => {
  state.search += "&application=9"; state.applications[2].locationListed = false;
  render(page());
  expect(screen.getByText(/Your kitchen access is approved\. Booking will be available/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Book kitchen time" })).not.toBeInTheDocument();
});

it("handles missing applications and fetch errors without showing another record", () => {
  state.search += "&application=999";
  const rendered = render(page());
  expect(screen.getByRole("alert")).toHaveTextContent("This application is unavailable");
  expect(screen.queryByText("Jamie Chef")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(state.refetch).toHaveBeenCalledOnce();
  state.error = new Error("offline"); rendered.rerender(page());
  expect(screen.getByRole("alert")).toHaveTextContent("We couldn’t load your kitchen applications");
});

it.each([["document_expired", { uploaded: true, status: "approved", expiry: "2026-10-20", daysLeft: -7, stage: "expired" }, "Send new copy"],
  ["document_review_required", { uploaded: false, status: null, expiry: null, daysLeft: null, stage: null }, "Send documents"]] as const)("replaces Book kitchen with the one document action when documents block booking (%s)", async (status, document, action) => {
  state.search += "&application=9"; state.applications[2] = fixture(9, "approved", 3, { tier2_completed_at: "2026-10-09", bookingEligibility: { canBook: false, status, message: "" },
    documents: [{ key: "foodSafetyLicense", label: "Food safety certificate", mode: "required", hasExpiry: true, renewalPending: false, waived: false, ...document }] });
  const scrollIntoView = vi.fn(); Element.prototype.scrollIntoView = scrollIntoView;
  render(page());
  expect(screen.queryByRole("button", { name: "Book kitchen time" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Send booking requirements" })).not.toBeInTheDocument();
  expect(screen.queryByTestId("document-upload-form")).toBeNull(); // opens on request, in the document's own row
  fireEvent.click(within(screen.getByTestId("kitchen-access-next")).getByRole("button", { name: action }));
  await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  expect(within(screen.getByTestId("document-foodSafetyLicense")).getByTestId("document-upload-form")).toBeInTheDocument();
});

it("shows no action at all while a renewal is under review or access has ended", () => {
  for (const status of ["renewal_under_review", "access_ended"]) {
    cleanup();
    state.search = "?view=kitchen-requests&application=9"; state.applications[2] = fixture(9, "approved", 3, { tier2_completed_at: "2026-10-09", bookingEligibility: { canBook: false, status, message: "" } });
    render(page());
    expect(screen.queryByRole("button", { name: "Book kitchen time" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Renew documents" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Send booking requirements" })).not.toBeInTheDocument();
  }
});
