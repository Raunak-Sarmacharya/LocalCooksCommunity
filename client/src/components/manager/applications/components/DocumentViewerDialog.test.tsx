import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@/i18n";

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));
vi.mock("@/hooks/use-presigned-document-url", () => ({ usePresignedDocumentUrl: () => ({ url: null }) }));
import { DocumentViewerDialog } from "./DocumentViewerDialog";

afterEach(cleanup);
const labels = { verified: "Verified", pending: "Pending", rejected: "Needs a new copy", needsReplacement: "Needs a replacement", expired: "Expired", verify: "Verify",
  openInNewTab: "Open in new tab", close: "Close", loading: "Loading", loadFailed: "Unavailable", expires: "Expires {date}" };
const mount = (onVerify = vi.fn()) => {
  render(<DocumentViewerDialog applicationId={67} open onOpenChange={vi.fn()} title="Business licence" subtitle="From TestSprite chef" url="/biz.pdf" status="pending"
    expiry="2027-10-27" sentAt="2026-10-27T15:00:00Z" setting="Required to book" customerName="TestSprite" reviewField="custom:biz" onVerify={onVerify}
    reviewNote="Check the name and the expiry date match." waitingNote="1 more document from TestSprite is waiting after this one." pausedNote="New bookings stay paused until they send a copy you verify." labels={labels} />);
  return onVerify;
};

describe("kitchen document check (mocks k1, k3)", () => {
  it("k1: facts row in one date format, what to check, how many more wait, and the two choices", () => {
    mount();
    expect(screen.getByText("From TestSprite chef")).toBeVisible();
    expect(screen.getByTestId("document-status")).toHaveTextContent("To check");
    for (const [term, value] of [["Expires", "Oct 27, 2027"], ["Sent", "Oct 27, 2026"], ["Your setting", "Required to book"]]) expect(screen.getByText(term).nextSibling).toHaveTextContent(value);
    expect(screen.getByText("Check the name and the expiry date match. 1 more document from TestSprite is waiting after this one.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Ask for a new copy" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Verify" })).toBeVisible();
  });

  it("verifies in one step", () => {
    const onVerify = mount();
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(onVerify).toHaveBeenCalledWith("custom:biz", "approved", undefined);
  });

  it("k3: asking for a new copy needs a note, says the customer sees it, and sends it trimmed", () => {
    const onVerify = mount();
    fireEvent.click(screen.getByRole("button", { name: "Ask for a new copy" }));
    expect(screen.getByTestId("document-status")).toHaveTextContent("Asking for a new copy");
    expect(screen.getByText("They’ll see this on their documents page and in the email we send them.")).toBeVisible();
    expect(screen.getByText("New bookings stay paused until they send a copy you verify.")).toBeVisible();
    const send = screen.getByRole("button", { name: "Send request" });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText("What should TestSprite fix?"), { target: { value: "   " } });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText("What should TestSprite fix?"), { target: { value: "  Wrong business name.  " } });
    fireEvent.click(send);
    expect(onVerify).toHaveBeenCalledWith("custom:biz", "rejected", "Wrong business name.");
  });

  it("Back returns to the two choices without sending", () => {
    const onVerify = mount();
    fireEvent.click(screen.getByRole("button", { name: "Ask for a new copy" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Verify" })).toBeVisible();
    expect(onVerify).not.toHaveBeenCalled();
  });
});
