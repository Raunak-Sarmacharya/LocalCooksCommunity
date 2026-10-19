import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StorageMoreActions } from "./StorageMoreActions";
import type { StorageRental } from "@/lib/storage-board";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({}) }));
vi.mock("@/components/booking/PhotoRequirementUploader", () => ({
  flattenPhotos: (photos: Record<string, string[]>) => Object.values(photos).flat(),
  PhotoRequirementUploader: ({ uploadFolder, photos, onPhotosChange, requirements }: any) => <button
    data-folder={uploadFolder} data-requirements={requirements.length} onClick={() => onPhotosChange({ ...photos, __generic__: ["https://files.localcooks.ca/handover.jpg"] })}>Upload evidence</button>,
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each(["handover", "items-still-here"])("uploads and submits evidence for %s through the shared uploader", async action => {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  vi.stubGlobal("fetch", fetchMock);
  const rental = { id: 5, actions: [action], chef: null, listing: { name: "Shelf" }, unitLabel: "1", startOn: "2026-10-19", paidThrough: "2026-10-25", terms: [] } as unknown as StorageRental;
  const onDone = vi.fn();
  render(<StorageMoreActions rental={rental} onDone={onDone} />);
  fireEvent.click(screen.getByRole("button"));
  expect(screen.queryByRole("textbox", { name: "stPhotosLabel" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "stConfirm" }));
  expect(screen.getByRole("alert")).toHaveTextContent("stPhotoEvidenceRequired");
  const upload = screen.getByRole("button", { name: "Upload evidence" });
  expect(upload).toHaveAttribute("data-folder", "storage-handover");
  expect(upload).toHaveAttribute("data-requirements", "0");
  fireEvent.click(upload);
  fireEvent.click(screen.getByRole("button", { name: "stConfirm" }));
  await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
  expect(fetchMock).toHaveBeenCalledWith(`/api/manager/storage-rentals/5/${action}`, expect.objectContaining({
    body: expect.stringContaining('"photoUrls":["https://files.localcooks.ca/handover.jpg"]'),
  }));
});
