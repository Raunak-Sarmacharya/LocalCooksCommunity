import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import CheckinCheckoutSettings from './CheckinCheckoutSettings';

const state = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock('@/i18n/manager', () => ({ mt: (key: string) => key }));
vi.mock('@/i18n/common-ns', () => ({ tt: (key: string) => key }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/api', () => ({ apiGet: vi.fn(), apiPut: state.put }));
afterEach(cleanup);

it('saves both required notes and both stages together without requiring duties or stage switches', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(['checkin-checkout-settings', 33], { id: 1, locationId: 33, checkinEnabled: false, checkoutEnabled: false,
    checkinItems: [], checkoutItems: [], checkinPhotoRequirements: [], checkoutPhotoRequirements: [], checkinInstructions: null, checkoutInstructions: null });
  render(<QueryClientProvider client={client}><CheckinCheckoutSettings location={{ id: 33, name: 'Sunlight' }} /></QueryClientProvider>);
  const arrival = await screen.findByRole('textbox', { name: 'arrivalInstructionsTitle' });
  const departure = screen.getByRole('textbox', { name: 'departureInstructionsTitle' });
  expect(arrival).toBeRequired(); expect(departure).toBeRequired();
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'saveChanges' }).every(button => (button as HTMLButtonElement).disabled)).toBe(true);
  fireEvent.change(arrival, { target: { value: 'Use the main door.' } });
  expect(state.put).not.toHaveBeenCalled();
  fireEvent.change(departure, { target: { value: 'Lock the main door.' } });
  await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'saveChanges' })[0]); });
  await waitFor(() => expect(state.put).toHaveBeenCalledWith('/manager/locations/33/checkin-checkout-settings', expect.objectContaining({
    checkinEnabled: true, checkoutEnabled: true, checkinInstructions: 'Use the main door.', checkoutInstructions: 'Lock the main door.',
    checkinItems: [], checkoutItems: [], checkinPhotoRequirements: [], checkoutPhotoRequirements: [] })));
  client.clear();
});
