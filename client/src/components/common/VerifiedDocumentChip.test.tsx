import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VerifiedDocumentChip } from "./VerifiedDocumentChip";

describe("VerifiedDocumentChip", () => {
  it("shows a brand chip only for a current approved upload", () => {
    const { rerender } = render(<VerifiedDocumentChip url="/certificate.pdf" status="approved" expiry="2099-12-31" />);
    expect(screen.getByText("Verified")).toHaveClass("bg-primary/10");
    rerender(<VerifiedDocumentChip url="/certificate.pdf" status="pending" expiry="2099-12-31" />);
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
    rerender(<VerifiedDocumentChip url="/certificate.pdf" status="approved" expiry="2020-01-01" />);
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
  });
});
