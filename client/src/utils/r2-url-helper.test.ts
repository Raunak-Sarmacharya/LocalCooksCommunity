import { afterEach, expect, it, vi } from "vitest";
import { getAuthenticatedImageUrl } from "./r2-url-helper";

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: { getIdToken: async () => "test-token" } } }));
afterEach(() => vi.unstubAllGlobals());

it.each(["location-logos", "kitchen-covers", "images"])("authenticates a proxy for %s", async (folder) => {
  const url = `https://files.localcooks.ca/${folder}/371_file.png`;
  const signed = "https://bucket.r2.cloudflarestorage.com/file.png?X-Amz-Signature=test";
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: signed }) });
  vi.stubGlobal("fetch", fetchMock);
  expect(await getAuthenticatedImageUrl(`/api/files/r2-proxy?url=${encodeURIComponent(url)}`)).toBe(signed);
  expect(fetchMock).toHaveBeenCalledWith(`/api/files/r2-presigned?url=${encodeURIComponent(url)}`, expect.objectContaining({
    headers: { Authorization: "Bearer test-token" },
  }));
});

it("keeps public, local and signed images directly loadable", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  for (const url of ["/logo.png", "blob:preview", "data:image/png;base64,test", "https://files.localcooks.ca/public/kitchens/photo.png", "https://bucket.r2.cloudflarestorage.com/photo.png?X-Amz-Signature=test"]) {
    const result = await getAuthenticatedImageUrl(url);
    expect(result).toBe(url.includes('/public/') ? `/api/files/r2-proxy?url=${encodeURIComponent(url)}` : url);
  }
  expect(fetchMock).not.toHaveBeenCalled();
});
