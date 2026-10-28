import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@/i18n";

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: { getIdToken: async () => "token" } } }));
import { YourDocuments } from "./YourDocuments";
import type { ApplicationDocument } from "./MyDocuments";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const doc = (key: string, label: string, extra: Partial<ApplicationDocument> = {}): ApplicationDocument => ({ key, label, mode: "required", hasExpiry: true, waived: false, uploaded: true,
  status: "approved", expiry: "2027-06-15", daysLeft: 200, stage: null, renewalPending: false, sentAt: "2026-10-13T15:00:00Z", checkedAt: "2026-10-13T16:00:00Z", note: null, renewal: null, ...extra });
const verified = [doc("foodSafetyLicense", "Food Safety Certificate"), doc("foodEstablishmentCert", "Food Establishment Licence")];
const mount = (documents: ApplicationDocument[], extra: Partial<Parameters<typeof YourDocuments>[0]> = {}) => {
  const onOpen = vi.fn(); const onSent = vi.fn();
  const view = render(<YourDocuments applicationId={67} documents={documents} kitchenName="PHASE0 Test Kitchen" sentToKitchen canUpload title="Your documents for PHASE0 Test Kitchen" lead=""
    openKey={null} onOpen={onOpen} onSent={onSent} viewLink={() => <a href="#">View</a>} {...extra} />);
  return { ...view, onOpen, onSent };
};
const row = (key: string) => within(screen.getByTestId(`document-${key}`));
const group = (name: string) => screen.getByRole("heading", { name }).parentElement!;

describe("Your documents (owner-approved mocks c1–c6)", () => {
  it("c1: two not sent go under To send with Upload; verified ones under On file with View only", () => {
    const { onOpen } = mount([...verified, doc("custom:biz", "Business licence", { uploaded: false, status: null, expiry: null, sentAt: null }),
      doc("custom:rules", "Signed house rules", { uploaded: false, status: null, expiry: null, hasExpiry: false, sentAt: null })]);
    expect(within(group("To send")).getAllByRole("listitem")).toHaveLength(2);
    expect(row("custom:biz").getByText("Not sent")).toBeVisible();
    expect(row("custom:biz").getByText("Required to book · has an expiry date")).toBeVisible();
    expect(row("custom:rules").getByText("Required to book · no expiry")).toBeVisible();
    fireEvent.click(row("custom:biz").getByRole("button", { name: "Upload" }));
    expect(onOpen).toHaveBeenCalledWith("custom:biz");
    expect(row("foodSafetyLicense").getByText("Verified")).toBeVisible();
    expect(row("foodSafetyLicense").queryByRole("button")).toBeNull();
    expect(row("foodSafetyLicense").getByText("Required to book · expires Jun 15, 2027")).toBeVisible();
  });

  it("c2: a sent copy is With the kitchen, shows when it was sent, and can't be replaced", () => {
    mount([...verified, doc("custom:biz", "Business licence", { status: "pending", expiry: "2027-10-27", sentAt: "2026-10-27T15:00:00Z" })]);
    expect(row("custom:biz").getByText("With the kitchen")).toBeVisible();
    expect(row("custom:biz").getByText("Required to book · sent Oct 27, 2026 · expires Oct 27, 2027")).toBeVisible();
    expect(row("custom:biz").queryByRole("button")).toBeNull();
    expect(row("custom:biz").getByRole("link", { name: "View" })).toBeVisible();
  });

  it("c3: a new copy asked for shows the kitchen's note and Upload a new copy", () => {
    mount([...verified, doc("custom:biz", "Business licence", { status: "rejected", sentAt: "2026-10-27T15:00:00Z", note: { text: "Wrong business name.", at: "2026-10-27T18:00:00Z" } })]);
    expect(row("custom:biz").getByText("New copy needed")).toBeVisible();
    expect(row("custom:biz").getByText("Note from PHASE0 Test Kitchen · Oct 27, 2026")).toBeVisible();
    expect(row("custom:biz").getByText("Wrong business name.")).toBeVisible();
    expect(row("custom:biz").getByRole("button", { name: "Upload a new copy" })).toBeVisible();
  });

  it("c4: expiring in 12 days: Expiring soon, Send new copy, and that booking pauses on the day if not verified", () => {
    mount([doc("foodSafetyLicense", "Food Safety Certificate", { expiry: "2026-11-08", daysLeft: 12, stage: "14_day" })]);
    expect(within(group("Expiring soon")).getByText("Expires in 12 days")).toBeVisible();
    expect(row("foodSafetyLicense").getByRole("button", { name: "Send new copy" })).toBeVisible();
    expect(row("foodSafetyLicense").getByText(/You can keep booking until Nov 8, 2026\. If the kitchen hasn’t verified the new copy by then, new bookings pause until it does\./)).toBeVisible();
  });

  it("c5: expired goes to To send with Send new copy", () => {
    mount([doc("foodSafetyLicense", "Food Safety Certificate", { expiry: "2026-10-20", daysLeft: -7, stage: "expired" })]);
    expect(within(group("To send")).getByText("Expired")).toBeVisible();
    expect(row("foodSafetyLicense").getByText("Required to book · expired Oct 20, 2026")).toBeVisible();
    expect(row("foodSafetyLicense").getByRole("button", { name: "Send new copy" })).toBeVisible();
  });

  it("c6: a renewal with the kitchen keeps the current copy Verified, shows the new one's dates, and offers no upload", () => {
    mount([doc("foodSafetyLicense", "Food Safety Certificate", { expiry: "2026-11-08", daysLeft: 12, stage: "14_day", renewalPending: true,
      renewal: { status: "pending", sentAt: "2026-10-27T15:00:00Z", expiry: "2027-11-08", note: null } })]);
    expect(within(group("Renewal with the kitchen")).getByText("Verified")).toBeVisible();
    expect(row("foodSafetyLicense").getByText("New copy with the kitchen")).toBeVisible();
    expect(row("foodSafetyLicense").getByText(/sent Oct 27, 2026 · expires Nov 8, 2027/)).toBeVisible();
    expect(row("foodSafetyLicense").queryByRole("button")).toBeNull();
  });

  it("an optional document not sent says Optional; a waived one isn't listed", () => {
    mount([doc("insurance", "Insurance", { mode: "track", uploaded: false, status: null, expiry: null }), doc("custom:x", "Pest control", { uploaded: false, waived: true, status: null })]);
    expect(row("insurance").getByText("Optional · has an expiry date")).toBeVisible();
    expect(screen.queryByTestId("document-custom:x")).toBeNull();
  });
});

describe("sending one document from its row", () => {
  const open = () => mount([...verified, doc("custom:biz", "Business licence", { uploaded: false, status: null, expiry: null, sentAt: null })], { openKey: "custom:biz" });
  const choose = (name = "business-licence.pdf", size = 219_000) => {
    const file = new File(["x"], name, { type: "application/pdf" });
    Object.defineProperty(file, "size", { value: size });
    fireEvent.change(screen.getByLabelText("File"), { target: { files: [file] } });
  };

  it("needs a file and an expiry date, then sends only that document to the existing PATCH", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const { onSent, onOpen } = open();
    const send = screen.getByRole("button", { name: "Send business licence" });
    expect(send).toBeDisabled();
    choose();
    expect(screen.getByText("business-licence.pdf")).toBeVisible();
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Expiry date"));
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    // Month/year menus jump straight to the date on the licence.
    expect(screen.getAllByRole("combobox").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Pick the date printed on the business licence. It has to be after today.")).toBeVisible();
    if (tomorrow.getDate() === 1) fireEvent.click(screen.getByRole("button", { name: /next month/i }));
    fireEvent.click(within(screen.getByRole("grid")).getAllByRole("gridcell", { name: String(tomorrow.getDate()) }).find(cell => !cell.hasAttribute("disabled") && !cell.className.includes("outside"))!);
    fireEvent.click(screen.getByRole("button", { name: "Send business licence" }));
    await waitFor(() => expect(onSent).toHaveBeenCalledWith("Business licence"));
    expect(onOpen).toHaveBeenCalledWith(null);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/firebase/chef/kitchen-applications/67/documents");
    expect(init.method).toBe("PATCH");
    const body = init.body as FormData;
    expect((body.get("custom_biz") as File).name).toBe("business-licence.pdf");
    const pad = (n: number) => String(n).padStart(2, "0");
    expect(body.get("custom_biz__expiry")).toBe(`${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`);
    expect([...body.keys()]).toEqual(["custom_biz", "custom_biz__expiry"]);
  });

  it("today can't be picked: the server wants a date after today", () => {
    open();
    fireEvent.click(screen.getByLabelText("Expiry date"));
    const today = String(new Date().getDate());
    const cells = within(screen.getByRole("grid")).getAllByRole("gridcell", { name: today }).filter(cell => !cell.className.includes("outside"));
    expect(cells.length).toBe(1);
    expect(cells.every(cell => cell.hasAttribute("disabled"))).toBe(true);
  });

  it("an undated document asks for the file only; a file over 10 MB is refused before upload", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    mount([doc("custom:rules", "Signed house rules", { uploaded: false, status: null, expiry: null, hasExpiry: false, sentAt: null })], { openKey: "custom:rules" });
    expect(screen.queryByLabelText("Expiry date")).toBeNull();
    choose("rules.pdf", 11 * 1024 * 1024);
    fireEvent.click(screen.getByRole("button", { name: "Send signed house rules" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That file is over 10 MB. Choose a smaller one.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("says plainly when the kitchen is already checking it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "DOCUMENT_WITH_KITCHEN", error: "x" }), { status: 409 })));
    mount([doc("custom:rules", "Signed house rules", { uploaded: false, status: null, expiry: null, hasExpiry: false, sentAt: null })], { openKey: "custom:rules" });
    choose("rules.pdf");
    fireEvent.click(screen.getByRole("button", { name: "Send signed house rules" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The kitchen is checking this document. Message the kitchen if it needs to change.");
  });
});
