import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/api', () => ({ getAuthHeaders: async () => ({ Authorization: 'Bearer fixture' }) }));
import { StorageUnitCard } from './StorageUnitCard';
import type { UnitRow } from '@/lib/storage-board';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('shows the service chip and restores a unit only after a reason is given', async () => {
  const fetchMock = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal('fetch', fetchMock);
  const onDone = vi.fn();
  const row: UnitRow = { key: '1:2', listingId: 1, listingName: 'Freezer', kitchenId: 1, kitchenName: 'Harbour', unitIndex: 2,
    chip: 'outOfService', rental: null, occupantName: null, date: null, needsAction: false, outOfService: { reason: 'Repair', at: '2026-10-16' } };
  render(<StorageUnitCard row={row} onDone={onDone} />);
  expect(screen.getByText('stChipOutOfService')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'stPutBack' }));
  expect(screen.getByRole('button', { name: 'stConfirm' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('stReasonLabel'), { target: { value: 'Repair completed' } });
  fireEvent.click(screen.getByRole('button', { name: 'stConfirm' }));
  await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
  expect(fetchMock).toHaveBeenCalledWith('/api/manager/storage-listings/1/units/2/service', expect.objectContaining({ body: JSON.stringify({ reason: 'Repair completed', outOfService: false }) }));
});
