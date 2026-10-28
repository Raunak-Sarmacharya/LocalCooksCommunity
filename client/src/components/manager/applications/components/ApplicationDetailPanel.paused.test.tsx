import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApplicationDetailPanel } from "./ApplicationDetailPanel";

vi.mock("@/i18n/manager", () => ({ mt: (key: string, values?: Record<string, unknown>) => values?.document ? `${key}:${values.document}` : key }));

const approved = {
  id: 67, chefId: 380, locationId: 47, fullName: "Ada Lovelace", email: "ada@example.test", phone: null, status: "approved", current_tier: 3,
  createdAt: "2026-10-01T12:00:00Z", tier1_completed_at: "2026-10-01T12:00:00Z", tier2_completed_at: "2026-10-02T12:00:00Z",
  foodSafetyLicense: "yes", foodSafetyLicenseUrl: "/fsc.pdf", foodSafetyLicenseStatus: "approved", foodSafetyLicenseExpiry: "2027-06-15",
  tier_data: {}, customFieldsData: {}, documentRenewals: [],
};
const requirements = { tier2_custom_fields: [{ id: "biz", label: "Business licence", type: "file", document: true, required: true }] };
const mount = (application: object) => render(<ApplicationDetailPanel application={application as never} locationRequirements={requirements as never}
  onApprove={vi.fn()} onApproveTier2={vi.fn()} onVerifyDocument={vi.fn()} onReject={vi.fn()} onRevokeAccess={vi.fn()} onOpenChat={vi.fn()}
  isUpdating={false} reviewFeedback="" onFeedbackChange={vi.fn()} />);

describe("ApplicationDetailPanel booking status", () => {
  it("says new bookings are paused, and for which document, when an approved customer is missing one", () => {
    mount(approved);
    expect(screen.getByText("arPausedTitle:Business licence")).toBeInTheDocument();
    expect(screen.getByText("arStageBookingPaused:Business licence")).toBeInTheDocument();
    expect(screen.queryByText("arStageCanBookNote")).not.toBeInTheDocument();
  });
  it("says they can book once every required document is approved", () => {
    mount({ ...approved, tier_data: { tier2_custom_fields_data: { biz: "/biz.pdf", biz__expiry: "2027-10-27" }, customDocumentStatus: { biz: "approved" } } });
    expect(screen.getByText("arStageCanBookNote")).toBeInTheDocument();
    expect(screen.queryByText(/arPausedTitle/)).not.toBeInTheDocument();
  });
});
