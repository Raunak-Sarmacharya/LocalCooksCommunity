import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, d?: any) => typeof d === "string" ? d : d?.defaultValue ?? key }) }));
import { MyDocuments, type ApplicationDocument } from "./MyDocuments";

afterEach(cleanup);
const doc = (key: string, extra: Partial<ApplicationDocument>): ApplicationDocument => ({ key, label: key, mode: "required", waived: false, uploaded: false,
  status: null, expiry: null, daysLeft: null, stage: null, renewalPending: false, ...extra });
const app = (documents: ApplicationDocument[]) => ({ id: 1, status: "approved", location: { name: "Harbour" }, documentsWaivedAt: "2026-10-26", documents }) as any;

it("a location that waived its documents and has none on file shows nothing", () => {
  const { container } = render(<MyDocuments applications={[app([doc("foodSafetyLicense", { waived: true }), doc("insurance", { waived: true })])]} />);
  expect(container).toBeEmptyDOMElement();
});

it("keeps a waived document the customer did upload", () => {
  render(<MyDocuments applications={[app([doc("foodSafetyLicense", { waived: true, uploaded: true }), doc("insurance", { waived: true })])]} />);
  expect(screen.getByTestId("my-documents")).toBeInTheDocument();
  expect(screen.queryByText("insurance")).not.toBeInTheDocument();
});
