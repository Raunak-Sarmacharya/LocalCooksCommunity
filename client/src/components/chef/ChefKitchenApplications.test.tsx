import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const state = vi.hoisted(() => ({ search: "?view=kitchen-requests", applications: [] as any[], loading: false, error: null as any, navigate: vi.fn(), refetch: vi.fn() }));
vi.mock("@/hooks/use-chef-kitchen-applications", () => ({ useChefKitchenApplications: () => ({ applications: state.applications, isLoading: state.loading, error: state.error, refetch: state.refetch }) }));
vi.mock("wouter", async original => ({ ...await original<typeof import("wouter")>(), useSearch: () => state.search, useLocation: () => ["/dashboard", state.navigate] }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, options?: any) => typeof options === "string" ? options : options?.defaultValue?.replace("{number}", String(options.number)) || key, i18n: { language: "en-CA" } }) }));
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

it("uses the real table for sorting, filtering, and mouse or keyboard row navigation", () => {
  render(page());
  const table = screen.getByRole("table");
  const newest = within(table).getByRole("link", { name: "APPLICATION-10" });
  fireEvent.click(newest.closest("tr")!);
  expect(state.navigate).toHaveBeenCalledWith("/dashboard?view=kitchen-requests&application=10");
  fireEvent.keyDown(within(table).getByRole("link", { name: "APPLICATION-8" }).closest("tr")!, { key: "Enter" });
  expect(state.navigate).toHaveBeenCalledWith("/dashboard?view=kitchen-requests&application=8");
  fireEvent.change(screen.getByRole("textbox", { name: "Search kitchen applications" }), { target: { value: "Kitchen 9" } });
  expect(within(table).getByRole("link", { name: "APPLICATION-9" })).toBeInTheDocument();
  expect(within(table).queryByRole("link", { name: "APPLICATION-8" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: /Action required/ }));
  expect(within(table).getByRole("link", { name: "APPLICATION-8" })).toBeInTheDocument();
  expect(within(table).queryByRole("link", { name: "APPLICATION-9" })).not.toBeInTheDocument();
});

it("opens a full page for the linked application with every submitted custom answer and document", () => {
  state.search += "&application=8";
  state.applications[1] = fixture(8, "approved", 2, { foodSafetyLicenseUrl: "https://files.localcooks.ca/documents/safety.pdf", foodSafetyLicenseExpiry: "2099-12-31", foodEstablishmentCertUrl: "https://files.localcooks.ca/documents/licence.pdf", foodEstablishmentCertExpiry: "2099-11-30", customFieldsData: { consent: false, file_a: "https://files.localcooks.ca/documents/business.pdf" }, tier2_completed_at: "2026-10-09", tier_data: { tierFiles: { tier2_insurance_document: "https://files.localcooks.ca/documents/insurance.pdf" }, kitchen_experience_description: "I prepare meals for 20 people.", tier2_custom_fields_data: { file_b: "https://files.localcooks.ca/documents/cleaning.pdf", capacity: 0 }, admin_review_note: "Private internal note" }, feedback: "Please renew your licence.", sourceTourId: 83 });
  render(page());
  expect(screen.getByRole("heading", { name: "Kitchen application", level: 1 })).toBeInTheDocument();
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
  expect(screen.queryByRole("link", { name: "Continue application" })).not.toBeInTheDocument();
});

it.each([
  ["approved", 2, {}, "Continue application"],
  ["approved", 3, {}, "Book kitchen"],
  ["rejected", 2, {}, "Apply again"],
])("offers the correct action for %s at tier %s", (status, tier, extra, label) => {
  state.search += "&application=8"; state.applications[1] = fixture(8, status, tier, extra);
  render(page());
  expect(screen.getByRole(label === "Book kitchen" ? "button" : "link", { name: label })).toBeInTheDocument();
});

it("keeps approved access visible when the kitchen is paused without offering booking", () => {
  state.search += "&application=9"; state.applications[2].locationListed = false;
  render(page());
  expect(screen.getByText(/Your kitchen access is approved\. Booking will be available/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Book kitchen" })).not.toBeInTheDocument();
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
