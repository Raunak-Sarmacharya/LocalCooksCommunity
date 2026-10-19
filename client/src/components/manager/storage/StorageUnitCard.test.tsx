import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('react-i18next', async () => {
  const { default: en } = await import('@shared/i18n/locales/en-CA/storage.json');
  return { useTranslation: () => ({ i18n: { language: 'en-CA' }, t: (key: string, values?: any) => key.startsWith('stService') || key === 'stUnitMoreActions' || key === 'stBackInService'
    ? (en as Record<string, string>)[key].replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? '')) : values?.date ? `${key}: ${values.date}` : key }) };
});
vi.mock('@/lib/api', () => ({ getAuthHeaders: async () => ({ Authorization: 'Bearer fixture' }) }));
import { StorageUnitCard } from './StorageUnitCard';
import type { UnitRow } from '@/lib/storage-board';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('opens the labelled menu and restores a unit with a localized reason prefilled', async () => {
  const fetchMock = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal('fetch', fetchMock);
  const onDone = vi.fn();
  const row: UnitRow = { key: '1:2', listingId: 1, listingName: 'Freezer', kitchenId: 1, kitchenName: 'Harbour', unitIndex: 2,
    chip: 'outOfService', rental: null, occupantName: null, date: null, needsAction: false, outOfService: { reason: 'Repair', at: '2026-10-16' } };
  render(<StorageUnitCard row={row} onDone={onDone} />);
  expect(screen.getByText('stChipOutOfService')).toBeInTheDocument();
  const trigger = screen.getByRole('button', { name: 'More actions for Unit 2' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'stPutBack' }));
  expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Put Unit 2 back in service?');
  expect(screen.getByText('It can be rented again right away.')).toBeInTheDocument();
  expect(screen.getByLabelText('stReasonLabel')).toHaveValue('Back in service');
  fireEvent.change(screen.getByLabelText('stReasonLabel'), { target: { value: '' } });
  expect(screen.getByRole('button', { name: 'stPutBack' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('stReasonLabel'), { target: { value: 'Repair completed' } });
  fireEvent.click(screen.getByRole('button', { name: 'stPutBack' }));
  await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
  expect(fetchMock).toHaveBeenCalledWith('/api/manager/storage-listings/1/units/2/service', expect.objectContaining({ body: JSON.stringify({ reason: 'Repair completed', outOfService: false }) }));
  await waitFor(() => expect(trigger).toHaveFocus());
});

it('shows move-in overdue and the actual start date instead of a future start label', () => {
  const row: UnitRow = { key: '1:1', listingId: 1, listingName: 'Shelf', kitchenId: 1, kitchenName: 'Harbour', unitIndex: 1,
    chip: 'moveInOverdue', rental: null, occupantName: 'Morgan Lee', date: { key: 'startedOn', value: '2026-10-17' }, needsAction: true };
  render(<StorageUnitCard row={row} />);
  expect(screen.getByText('stChipMoveInOverdue')).toHaveClass('whitespace-nowrap');
  expect(screen.getByText('stChipMoveInOverdue')).toHaveTextContent(/^stChipMoveInOverdue$/);
  expect(screen.getByText(/stDateStartedOn:.*Oct 17/)).toBeInTheDocument();
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
  expect(screen.queryByRole('button', { name: 'stViewUnit' })).toBeNull();
});

it('explains existing bookings, requires a reason, and posts taking a unit out of service', async () => {
  const fetchMock = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal('fetch', fetchMock);
  const onDone = vi.fn();
  const row: UnitRow = { key: '1:1', listingId: 1, listingName: 'Shelf', kitchenId: 1, kitchenName: 'Harbour', unitIndex: 1,
    chip: 'occupied', occupantName: 'Morgan', date: null, needsAction: false,
    rental: { id: 5, chef: { name: 'Morgan' }, startOn: '2026-10-19', paidThrough: '2026-10-22' } as any,
    next: { id: 6, chef: { name: 'Alex' }, startOn: '2026-11-01' } as any };
  render(<StorageUnitCard row={row} onDone={onDone} />);
  fireEvent.keyDown(screen.getByRole('button', { name: 'More actions for Unit 1' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'stTakeOutOfService' }));
  expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Take Unit 1 out of service?');
  expect(screen.getByText('No new rentals will be assigned to this unit until you put it back. Rentals already on it aren’t affected.')).toBeInTheDocument();
  expect(screen.getByText('Morgan’s rental stays as booked. To move it, use Change unit on the rental.')).toBeInTheDocument();
  expect(screen.getByText('Alex’s rental stays as booked. To move it, use Change unit on the rental.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'stTakeOutOfService' })).toBeDisabled();
  expect(screen.getByLabelText('stReasonLabel')).toBeRequired();
  expect(screen.getByLabelText('stReasonLabel')).toHaveAccessibleDescription('For your records.');
  fireEvent.change(screen.getByLabelText('stReasonLabel'), { target: { value: '  Repair door  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'stTakeOutOfService' }));
  await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
  expect(fetchMock).toHaveBeenCalledWith('/api/manager/storage-listings/1/units/1/service', expect.objectContaining({ method: 'POST', body: JSON.stringify({ reason: 'Repair door', outOfService: true }) }));
});

it('leaves an available tile unlinked', () => {
  render(<StorageUnitCard row={{ key: '1:1', listingId: 1, listingName: 'Shelf', kitchenId: 1, kitchenName: '', unitIndex: 1, chip: 'free', rental: null, occupantName: null, date: null, needsAction: false }} />);
  expect(screen.getByText('stUnitReady')).toBeInTheDocument();
  expect(screen.queryByRole('link')).toBeNull();
});
