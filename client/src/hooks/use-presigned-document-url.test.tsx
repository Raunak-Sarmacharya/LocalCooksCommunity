import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { usePresignedDocumentUrl } from './use-presigned-document-url';

const resolve = vi.hoisted(() => vi.fn());
vi.mock('@/utils/r2-url-helper', () => ({ getAuthenticatedFileUrl: resolve }));
afterEach(() => { cleanup(); resolve.mockReset(); });

it('uses the shared document resolver and clears the link on failure', async () => {
  resolve.mockResolvedValueOnce('signed-terms');
  const { result, rerender } = renderHook(({ url }) => usePresignedDocumentUrl(url), { initialProps: { url: 'terms' } });
  expect(result.current).toMatchObject({ url: null, isLoading: true });
  await waitFor(() => expect(result.current.url).toBe('signed-terms'));
  resolve.mockRejectedValueOnce(new Error('Unavailable'));
  rerender({ url: 'custom-upload' });
  expect(result.current.url).toBeNull();
  await waitFor(() => expect(result.current.error?.message).toBe('Unavailable'));
  expect(result.current).toMatchObject({ url: null, isLoading: false });
});

it('ignores late responses for a previously selected document', async () => {
  let finishOld!: (url: string) => void;
  resolve.mockImplementationOnce(() => new Promise<string>(done => { finishOld = done; }));
  resolve.mockResolvedValueOnce('signed-new');
  const { result, rerender } = renderHook(({ url }) => usePresignedDocumentUrl(url), { initialProps: { url: 'old' } });
  rerender({ url: 'new' });
  await waitFor(() => expect(result.current.url).toBe('signed-new'));
  finishOld('signed-old');
  await waitFor(() => expect(result.current.url).toBe('signed-new'));
  rerender({ url: '' });
  expect(result.current).toEqual({ url: null, isLoading: false, error: null });
});
