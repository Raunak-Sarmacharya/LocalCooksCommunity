/**
 * REGRESSION HARNESS — DocumentUploadField
 *
 * Why this file exists.
 *
 * Every chef-side document upload goes through this one component, and its
 * "is a document already on file?" answer decides whether the chef sees a drop
 * zone or a stored-document row. That answer was briefly derived from a second
 * flag as well as `existingName`, and because callers passed that flag as a bare
 * JSX shorthand it was ALWAYS true — so every empty upload rendered a Replace
 * button for a document that did not exist.
 *
 * Two rules are pinned here:
 *
 *  1. A document is on file if and only if `existingName` was given.
 *  2. The Replace action lives INSIDE the stored-document row, never beside it.
 *     Rendered as a sibling it floated in the gap between two document cards and
 *     read as belonging to neither. Carbon's file-uploader anatomy puts a file's
 *     actions inside the uploaded-file element for exactly this reason.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { DocumentUploadField } from "./DocumentUploadField";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: Record<string, unknown>) => {
      const base = (opts?.defaultValue as string) ?? _key;
      if (!opts) return base;
      return base.replace(/\{(\w+)\}/g, (match, token: string) =>
        token in opts ? String(opts[token]) : match,
      );
    },
  }),
}));

function renderField(props: Partial<React.ComponentProps<typeof DocumentUploadField>> = {}) {
  return render(
    <DocumentUploadField
      id="doc"
      accept=".pdf"
      file={null}
      label="Certificate file"
      hint="PDF only"
      chooseLabel="Choose file"
      changeLabel="Change"
      onChange={() => {}}
      {...props}
    />,
  );
}

const dropzone = () => document.getElementById("doc");
const replaceButton = () => screen.queryByRole("button", { name: /^replace$/i });
const cancelButton = () => screen.queryByRole("button", { name: /^cancel$/i });
const storedRow = () => screen.queryByTestId("stored-document-row");

describe("DocumentUploadField", () => {
  it("shows the drop zone — and no Replace — when nothing is on file", () => {
    renderField();

    expect(dropzone()).toBeInTheDocument();
    expect(replaceButton()).not.toBeInTheDocument();
    expect(storedRow()).not.toBeInTheDocument();
    expect(screen.getByText("Certificate file")).toBeInTheDocument();
  });

  it("shows the stored row and hides the drop zone when a document is on file", () => {
    renderField({ existingName: "kitchen-terms.pdf" });

    expect(storedRow()).toBeInTheDocument();
    expect(dropzone()).not.toBeInTheDocument();
    expect(screen.getByText("kitchen-terms.pdf")).toBeInTheDocument();
  });

  it("puts the Replace action INSIDE the stored row, beneath the verification chip", () => {
    renderField({
      existingName: "kitchen-terms.pdf",
      existingNote: "Already on file",
      existingTrailing: <span>Verified</span>,
    });

    const row = storedRow()!;
    expect(within(row).getByText("kitchen-terms.pdf")).toBeInTheDocument();

    // The whole point: the action belongs to the document it replaces...
    const button = within(row).getByRole("button", { name: /^replace$/i });
    // ...and it sits on the row AFTER the chip, not beside the file name where it
    // competed with the chip and read as a second badge.
    const chip = within(row).getByText("Verified");
    expect(chip.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders the stored note, expiry, view link and trailing slot inside the row", () => {
    renderField({
      existingName: "kitchen-terms.pdf",
      existingNote: "Review pending",
      existingExpiry: "2099-12-31",
      existingUrl: "/terms.pdf",
      existingTrailing: <span>Verified</span>,
    });

    const row = storedRow()!;
    expect(within(row).getByText("Review pending")).toBeInTheDocument();
    expect(within(row).getByText(/^Expires /)).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: /view license/i })).toHaveAttribute("href", "/terms.pdf");
    expect(within(row).getByText("Verified")).toBeInTheDocument();
  });

  it("warns that a VERIFIED document must be verified again, and that access is unaffected", () => {
    renderField({ existingName: "kitchen-terms.pdf", existingVerified: true });

    const row = storedRow()!;
    expect(within(row).getByText(/require verification again/i)).toBeInTheDocument();
    // The reassuring half matters as much as the warning.
    expect(within(row).getByText(/booking access stays the same/i)).toBeInTheDocument();
  });

  it("does not claim a re-verification when there was none to lose", () => {
    renderField({ existingName: "kitchen-terms.pdf" });

    const row = storedRow()!;
    expect(within(row).getByText(/send the new document for review/i)).toBeInTheDocument();
    expect(within(row).queryByText(/verification again/i)).not.toBeInTheDocument();
  });

  it("brings the drop zone back on Replace and returns on Cancel", () => {
    renderField({ existingName: "kitchen-terms.pdf" });

    fireEvent.click(replaceButton()!);
    expect(dropzone()).toBeInTheDocument();
    expect(storedRow()).not.toBeInTheDocument();

    fireEvent.click(cancelButton()!);
    expect(dropzone()).not.toBeInTheDocument();
    expect(storedRow()).toBeInTheDocument();
  });
});
