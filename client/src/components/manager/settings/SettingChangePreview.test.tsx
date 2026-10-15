import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SettingChangePreview } from './SettingChangePreview';
vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
afterEach(cleanup);
const props = { whatChanges: 'A new arrival time.', appliesTo: 'now', undo: 'Change it back.', actionLabel: 'Save changes' };
it('shows four lines, waits for counts, and never promises a notification by default', () => {
  const save = vi.fn(); const { rerender } = render(<SettingChangePreview {...props} onSave={save} />);
  expect(screen.getByText('Checking your upcoming bookings…')).toBeInTheDocument();
  expect(screen.getByRole('button')).toBeDisabled();
  rerender(<SettingChangePreview {...props} onSave={save} impact={{ upcoming: 3, inSession: 1, pending: 0 }} />);
  expect(screen.getByText(/Affects 3 upcoming bookings/)).toHaveTextContent('Chefs see the new time');
  expect(screen.getAllByRole('term')).toHaveLength(4);
  fireEvent.click(screen.getByRole('button')); expect(save).toHaveBeenCalledOnce();
  rerender(<SettingChangePreview {...props} impact={{ upcoming: 0, inSession: 0, pending: 0 }} />);
  expect(screen.getByText('No upcoming bookings are affected.')).toBeInTheDocument();
});
it('requires confirmation, repeats the preview, and cancellation changes nothing', () => {
  const save = vi.fn(); render(<SettingChangePreview {...props} onSave={save} confirm impact={{ upcoming: 3, inSession: 0, pending: 0 }} />);
  fireEvent.click(screen.getByRole('button')); const dialog = screen.getByRole('dialog');
  expect(within(dialog).getAllByRole('term')).toHaveLength(4);
  expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeDisabled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Keep as is' })); expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button')); fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save changes' })); expect(save).toHaveBeenCalledOnce();
});
