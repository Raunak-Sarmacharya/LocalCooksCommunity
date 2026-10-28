import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BookingRulesSettings, { type BookingPoliciesHandle } from "./BookingRulesSettings";

vi.mock("@/i18n/manager", () => ({
  mt: (key: string) =>
    ({
      scpSave: "Save changes",
      bpSaveRules: "Save booking rules",
      savingShort: "Saving",
      saved: "Saved",
      replace: "Replace",
      bpViewDocument: "View document",
      cancel: "Cancel",
      uploaded: "Uploaded:",
      hoursSuffix: "hours",
    } as Record<string, string>)[key] ?? key,
}));

vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => key }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));

vi.mock("@/hooks/use-presigned-document-url", () => ({
  usePresignedDocumentUrl: () => ({ url: null, isLoading: false, error: null }),
}));

vi.mock("@/components/ui/manager-icons", () => {
  const Stub = () => <span aria-hidden />;
  return { Info: Stub, FileText: Stub, ExternalLink: Stub, RotateCcw: Stub, Loader2: Stub, AlertTriangle: Stub, ChevronDown: Stub, ChevronRight: Stub, ClipboardCheck: Stub, Lock: Stub };
});

vi.mock("@/components/chef/ui", () => ({
  ChefPageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => <><h1>{title}</h1>{actions}</>,
}));

// Dropzone internals live in SettingsFileUpload; only its presence matters here.
vi.mock("./SettingsFileUpload", () => ({
  SettingsFileUpload: ({ id }: { id: string }) => <input id={id} type="file" />,
}));

afterEach(cleanup);

const baseLocation = {
  id: 7,
  name: "Harbour Kitchen",
  cancellationPolicyHours: 24,
  defaultDailyBookingLimit: null as number | null,
  minimumBookingWindowHours: 1,
};

const uploadedLocation = {
  ...baseLocation,
  kitchenTermsUrl: "https://cdn.example.com/kitchen-terms.pdf",
  kitchenTermsUploadedAt: "2026-09-12T10:00:00.000Z",
};

const termsDropzone = () => document.getElementById("terms-upload");

describe("BookingRulesSettings", () => {
  it("leaves the embedded tab's save action to its parent", () => {
    render(<BookingRulesSettings location={baseLocation} onSave={vi.fn()} hideHeader hideArrivalTimings hideTerms />);
    fireEvent.change(screen.getByRole("textbox", { name: "bpNoticeLabel" }), { target: { value: "48" } });
    expect(screen.queryByRole("button", { name: /save\s*changes/i })).not.toBeInTheDocument();
  });
  it("groups kitchen minimum duration with policies without duplicating arrival or terms controls", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<BookingRulesSettings location={baseLocation} onSave={onSave} minimumBookingHours={2}
      hideArrivalTimings hideTerms policyOverrides={{ cancellationPolicyHours: null }} />);
    expect(screen.getAllByRole("textbox", { name: "bpShortestLabel" })).toHaveLength(1);
    expect(screen.queryByLabelText("checkinOpensLabel")).not.toBeInTheDocument();
    expect(termsDropzone()).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "bpShortestLabel" }), { target: { value: "3" } });
    fireEvent.click(await screen.findByRole("button", { name: /save\s*changes/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ minimumBookingHours: 3 })));
  });
  it("keeps the save action hidden until a value changes, then saves the whole set", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onDirtyChange = vi.fn();

    render(<BookingRulesSettings location={baseLocation} onSave={onSave} onDirtyChange={onDirtyChange} />);

    // Quiet at rest — no action floating in the middle of the page.
    // NB: StatusButton animates per character, so its accessible name can lose the
    // separating space — match loosely rather than on an exact string.
    expect(screen.queryByRole("button", { name: /save\s*changes/i })).not.toBeInTheDocument();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);

    fireEvent.change(screen.getByRole("textbox", { name: "bpNoticeLabel" }), { target: { value: "48" } });

    const saveButton = await screen.findByRole("button", { name: /save\s*changes/i });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        locationId: 7,
        cancellationPolicyHours: 24,
        defaultDailyBookingLimit: null,
        minimumBookingWindowHours: 48,
        taxRatePercent: null,
      });
    });
  });

  it("Location page: a tax-only change gets the section's own save and is listed above it (QA Oct 28)", () => {
    const onRequestSave = vi.fn();
    render(<BookingRulesSettings location={{ ...baseLocation, taxRatePercent: "15" }} onSave={vi.fn()} onRequestSave={onRequestSave} hideHeader hideArrivalTimings hideTerms />);
    expect(screen.getByRole("button", { name: "Save booking rules" })).toBeDisabled();
    fireEvent.change(document.getElementById("location-tax")!, { target: { value: "14" } });
    expect(screen.getByText("bpTaxValue")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save booking rules" }));
    expect(onRequestSave).toHaveBeenCalledOnce();
  });

  it("rules and arrival timing save separately; a leave-page save opens timing's confirmation instead of failing silently (QA Oct 28)", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const ref = createRef<BookingPoliciesHandle>();
    render(<BookingRulesSettings ref={ref} location={baseLocation} onSave={onSave} onRequestSave={vi.fn()} hideHeader hideTerms />);
    fireEvent.change(screen.getByRole("textbox", { name: "bpNoticeLabel" }), { target: { value: "48" } });
    fireEvent.change(document.getElementById("checkin-window")!, { target: { value: "30" } });
    // Timing has its own save in its own card.
    expect(within(screen.getByTestId("arrival-timing-section")).getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    let saved: boolean | undefined;
    await act(async () => { saved = await ref.current!.saveAllChanges(); });
    expect(saved).toBe(false);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ minimumBookingWindowHours: 48 });
    expect(onSave.mock.calls[0][0]).not.toHaveProperty("checkinWindowMinutesBefore");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("surfaces the uploaded document instead of a bare dropzone", () => {
    render(<BookingRulesSettings location={uploadedLocation} onSave={vi.fn()} />);

    // Filename + view link are what prove something is on file.
    expect(screen.getByText("kitchen-terms.pdf")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view document/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^replace$/i })).toBeInTheDocument();
    expect(termsDropzone()).not.toBeInTheDocument();
  });

  it("offers the dropzone when nothing is on file, and brings it back on Replace", () => {
    const { rerender } = render(<BookingRulesSettings location={baseLocation} onSave={vi.fn()} />);

    // Empty state: nothing to replace.
    expect(termsDropzone()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^replace$/i })).not.toBeInTheDocument();

    rerender(<BookingRulesSettings location={uploadedLocation} onSave={vi.fn()} />);
    expect(termsDropzone()).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^replace$/i }));
    expect(termsDropzone()).toBeInTheDocument();
  });
});
