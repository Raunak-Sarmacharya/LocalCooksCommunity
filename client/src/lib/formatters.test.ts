import { describe, expect, it } from "vitest";
import { getDocumentFilename, truncateFilename } from "./formatters";

describe("truncateFilename", () => {
    it("leaves a name that already fits alone", () => {
        expect(truncateFilename("license.pdf")).toBe("license.pdf");
    });

    it("keeps the extension, whatever it cuts", () => {
        const out = truncateFilename("IMG_20260114_101533-commercial-kitchen-license-scan.pdf");
        expect(out.endsWith(".pdf")).toBe(true);
        expect(out.length).toBeLessThanOrEqual(28);
    });

    it("keeps BOTH ends, so two scans of one licence stay distinguishable", () => {
        // The whole reason the middle is cut rather than the end: these two share a 40-character
        // prefix and differ only at the tail, which is where the version marker lives.
        const a = truncateFilename("harbour-kitchen-house-rules-and-policies-v4-signed.pdf");
        const b = truncateFilename("harbour-kitchen-house-rules-and-policies-v5-signed.pdf");
        expect(a).not.toBe(b);
        expect(a).toContain("v4");
        expect(b).toContain("v5");
    });

    it("still shortens a name with no extension", () => {
        const out = truncateFilename("a-fairly-long-document-name-with-no-extension-at-all");
        expect(out.length).toBeLessThanOrEqual(28);
        expect(out).toContain("…");
    });

    it("passes an empty name straight through", () => {
        expect(truncateFilename("")).toBe("");
    });
});

describe('getDocumentFilename', () => {
  it('shows the name the user uploaded, without the storage prefix', () => {
    expect(getDocumentFilename('https://files.localcooks.ca/documents/379_file_1792444457787_phase0-kitchen-terms.pdf')).toBe('phase0-kitchen-terms.pdf');
    expect(getDocumentFilename('https://files.localcooks.ca/documents/221_1768267179125_House%20rules.pdf')).toBe('House rules.pdf');
    expect(getDocumentFilename('https://files.localcooks.ca/documents/terms_2024.pdf')).toBe('terms_2024.pdf');
  });
});
