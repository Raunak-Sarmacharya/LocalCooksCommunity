import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CoverPhotoField, CoverPhotoTile, GalleryPhotoField, LogoPhotoField } from "./KitchenPhotoFields";
import { getAuthenticatedImageUrl } from "@/utils/r2-url-helper";

vi.mock("@/utils/r2-url-helper", () => ({
  getAuthenticatedImageUrl: vi.fn(),
  getR2ProxyUrl: (url: string) => `/api/files/r2-proxy?url=${encodeURIComponent(url)}`,
}));
vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));

it.each(["logo", "cover", "tile", "gallery"])("previews an unsaved %s using authenticated access", async (kind) => {
  cleanup();
  const logo = `https://files.localcooks.ca/${kind === "logo" ? "location-logos" : "kitchen-covers"}/371_file_1791484478614_LoCo_Red.png`;
  const signed = "https://bucket.r2.cloudflarestorage.com/location-logos/logo.png?X-Amz-Signature=test";
  vi.mocked(getAuthenticatedImageUrl).mockResolvedValue(signed);
  const Field = kind === "logo" ? LogoPhotoField : kind === "cover" ? CoverPhotoField : CoverPhotoTile;
  const { rerender, container } = render(kind === "gallery"
    ? <GalleryPhotoField images={[logo]} onSelectFiles={vi.fn()} onReplace={vi.fn()} onRemove={vi.fn()} />
    : <Field value={logo} onSelectFile={vi.fn()} onRemove={vi.fn()} />);
  expect(getAuthenticatedImageUrl).toHaveBeenCalledWith(`/api/files/r2-proxy?url=${encodeURIComponent(logo)}`);
  await waitFor(() => expect(container.querySelector("img")).toHaveAttribute("src", signed));
  rerender(<LogoPhotoField value="" onSelectFile={vi.fn()} onRemove={vi.fn()} />);
  expect(screen.queryByRole("img")).toBeNull();
});
