import { afterEach, expect, it, vi } from "vitest";
import { getAuthenticatedFileUrl, getAuthenticatedImageUrl } from "./r2-url-helper";

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

it.each([
  '/api/files/r2-proxy?url=' + encodeURIComponent('https://files.localcooks.ca/documents/terms%20and%20policies.pdf'),
  '/api/files/r2-proxy?filename=terms%20and%20policies.pdf',
  'files.localcooks.ca/documents/terms%20and%20policies.pdf',
])('resolves document reference %s before signing', async reference => {
  const signed = 'https://bucket.r2.cloudflarestorage.com/terms.pdf?X-Amz-Signature=test';
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: signed }) });
  vi.stubGlobal('fetch', fetchMock);
  expect(await getAuthenticatedFileUrl(reference)).toBe(signed);
  const target = new URL(fetchMock.mock.calls[0][0], 'https://localcooks.ca').searchParams.get('url');
  expect(target).toBe(reference.includes('filename=')
    ? 'https://files.localcooks.ca/documents/terms and policies.pdf'
    : 'https://files.localcooks.ca/documents/terms%20and%20policies.pdf');
});

it('authenticates local documents without passing them to the R2 signing endpoint', async () => {
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  expect(await getAuthenticatedFileUrl('/api/files/documents/custom.pdf')).toBe('/api/files/documents/custom.pdf?token=test-token');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('surfaces a failed signing request instead of returning an inaccessible document link', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  await expect(getAuthenticatedFileUrl('https://files.localcooks.ca/documents/private.pdf')).rejects.toThrow('Failed to load document');
});
