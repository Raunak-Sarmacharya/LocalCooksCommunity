import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ callbacks: [] as any[], upload: vi.fn() }));
vi.mock('@/hooks/useSessionFileUpload', () => ({ useSessionFileUpload: (options: any) => {
  hooks.callbacks.push(options); return { uploadFile: hooks.upload, isUploading: false, uploadProgress: 0 };
} }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('sonner', () => ({ toast: { loading: vi.fn(), dismiss: vi.fn(), success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/smart-image', () => ({ SmartImage: (props: any) => <img {...props} /> }));
import { PhotoRequirementUploader, areAllRequiredPhotosUploaded } from './PhotoRequirementUploader';
const requirements = [{ id: 'floor', label: 'Floor', required: true }, { id: 'sink', label: 'Sink', required: true }];
function Harness() {
  const [photos, setPhotos] = useState<Record<string, string[]>>({ floor: ['prior'] });
  return <><PhotoRequirementUploader requirements={requirements} photos={photos} onPhotosChange={setPhotos} uploadFolder="test-only" /><output data-testid="photos">{JSON.stringify(photos)}</output></>;
}
describe('photo evidence recovery', () => {
  beforeEach(() => { hooks.callbacks = []; hooks.upload.mockClear(); });
  it('makes generic and configured optional photos optional', () => {
    expect(areAllRequiredPhotosUploaded([], {})).toBe(true);
    expect(areAllRequiredPhotosUploaded([{ id: 'optional', label: 'Optional', required: false }], {})).toBe(true);
    expect(areAllRequiredPhotosUploaded(requirements, { floor: ['prior'] })).toBe(false);
  });
  it('retains successful evidence on upload failure and exposes a focusable retry input', () => {
    const { container } = render(<Harness />);
    const sink = container.querySelector<HTMLInputElement>('#photo-slot-sink')!;
    sink.focus(); expect(document.activeElement).toBe(sink);
    act(() => hooks.callbacks[1].onError('Upload failed'));
    expect(screen.getByRole('alert')).toHaveTextContent('existing photos are retained');
    expect(screen.getByTestId('photos')).toHaveTextContent('prior');
    fireEvent.change(sink, { target: { files: [new File(['data'], 'sink.jpg', { type: 'image/jpeg' })] } });
    expect(hooks.upload).toHaveBeenCalledWith(expect.any(File), 'test-only');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('preserves other slots when concurrent upload callbacks complete together', () => {
    render(<Harness />);
    const [floor, sink] = hooks.callbacks;
    act(() => { sink.onSuccess({ url: 'sink-new' }); floor.onSuccess({ url: 'floor-new' }); });
    expect(JSON.parse(screen.getByTestId('photos').textContent!)).toEqual({ floor: ['prior', 'floor-new'], sink: ['sink-new'] });
  });
});
