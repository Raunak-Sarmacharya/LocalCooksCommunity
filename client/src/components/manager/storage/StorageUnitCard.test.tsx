import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, values?: any) => values?.date ? `${key}: ${values.date}` : key }) }));
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

it('shows move-in overdue and the actual start date instead of a future start label', () => {
  const row: UnitRow = { key: '1:1', listingId: 1, listingName: 'Shelf', kitchenId: 1, kitchenName: 'Harbour', unitIndex: 1,
    chip: 'moveInOverdue', rental: null, occupantName: 'Morgan Lee', date: { key: 'startedOn', value: '2026-10-17' }, needsAction: true };
  render(<StorageUnitCard row={row} />);
  expect(screen.getByText(/stChipMoveInOverdue · stDateStartedOn:.*Oct 17/)).toBeInTheDocument();
  expect(screen.queryByText('stChipReserved')).not.toBeInTheDocument();
  expect(screen.queryByText(/stDateStartsOn/)).not.toBeInTheDocument();
});

it('opens the current rental from the tile and links its next reservation separately', () => {
  const row: UnitRow = { key: '1:1', listingId: 1, listingName: 'Shelf', kitchenId: 1, kitchenName: 'Harbour', unitIndex: 1,
    chip: 'occupied', occupantName: 'Morgan Lee', date: { key: 'paidThrough', value: '2026-10-22' }, needsAction: false,
    rental: { id: 5, startOn: '2026-10-19', paidThrough: '2026-10-22' } as any,
    next: { id: 6, chef: { name: 'Alex' }, startOn: '2026-11-01' } as any };
  render(<StorageUnitCard row={row} />);
  expect(screen.getByRole('link', { name: 'stUnitLabel' })).toHaveAttribute('href', '/manager/storage/5');
  expect(screen.getByRole('link', { name: /stUnitNext/ })).toHaveAttribute('href', '/manager/storage/6');
  expect(screen.getByText(/Oct 19.*Oct 22/)).toBeInTheDocument();
});
