import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BookingRulesSettings from "./BookingRulesSettings";

vi.mock("@/i18n/manager", () => ({
  mt: (key: string) =>
    ({
      saveChanges: "Save Changes",
      savingShort: "Saving",
      saved: "Saved",
      replace: "Replace",
      viewDocument: "View Document",
      cancel: "Cancel",
      uploaded: "Uploaded:",
      hoursSuffix: "hours",
    } as Record<string, string>)[key] ?? key,
}));

vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => key }));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));

vi.mock("@/hooks/use-presigned-document-url", () => ({
  usePresignedDocumentUrl: () => ({ url: null, isLoading: false, error: null }),
}));

vi.mock("@/components/ui/manager-icons", () => {
  const Stub = () => <span aria-hidden />;
  return { Info: Stub, FileText: Stub, ExternalLink: Stub };
});

vi.mock("@/components/chef/ui", () => ({
  ChefPageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
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
  defaultDailyBookingLimit: 2,
  minimumBookingWindowHours: 1,
};

const uploadedLocation = {
  ...baseLocation,
  kitchenTermsUrl: "https://cdn.example.com/kitchen-terms.pdf",
  kitchenTermsUploadedAt: "2026-09-12T10:00:00.000Z",
};

const termsDropzone = () => document.getElementById("terms-upload");

describe("BookingRulesSettings", () => {
  it("keeps the save action hidden until a value changes, then saves the whole set", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onDirtyChange = vi.fn();

    render(<BookingRulesSettings location={baseLocation} onSave={onSave} onDirtyChange={onDirtyChange} />);

    // Quiet at rest — no action floating in the middle of the page.
    // NB: StatusButton animates per character, so its accessible name can lose the
    // separating space — match loosely rather than on an exact string.
    expect(screen.queryByRole("button", { name: /save\s*changes/i })).not.toBeInTheDocument();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);

    fireEvent.change(screen.getByLabelText("cancellationWindow"), { target: { value: "48" } });

    const saveButton = await screen.findByRole("button", { name: /save\s*changes/i });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        locationId: 7,
        cancellationPolicyHours: 48,
        defaultDailyBookingLimit: 2,
        minimumBookingWindowHours: 1,
      });
    });
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
