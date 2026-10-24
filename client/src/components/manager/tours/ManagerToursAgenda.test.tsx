import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ManagerToursAgenda, type TourAgendaRecord } from './ManagerToursAgenda';

vi.mock('react-i18next', async importOriginal => ({ ...(await importOriginal<object>()), useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
afterEach(cleanup);

const hour = 3_600_000;
const record = (id: number, patch: Partial<TourAgendaRecord['viewing']>, name = 'Sam Lee'): TourAgendaRecord => ({
  viewing: { id, status: 'confirmed', scheduledAt: new Date(Date.now() + 72 * hour).toISOString(), durationMinutes: 30, createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), disruptionReason: null, cancelledBy: null, adminReviewDecision: null, adminReviewedAt: new Date().toISOString(),
    requestExpiredAt: null, requestedRescheduleAt: null, rescheduleProposedSlots: [], ...patch },
  chefName: name, kitchenName: 'Harbour Kitchen', locationName: 'Harbour House', locationTimezone: 'America/St_Johns' });

it('leads with what waits on the kitchen, one action per row, and every row opens the tour', () => {
  const onOpen = vi.fn();
  const request = record(1, { status: 'pending' }, 'Ana Request');
  const ended = record(2, { scheduledAt: new Date(Date.now() - 2 * hour).toISOString() }, 'Ben Visit');
  const later = record(3, {}, 'Cy Later');
  render(<ManagerToursAgenda records={[later, ended, request, record(4, { status: 'completed', scheduledAt: new Date(Date.now() - 96 * hour).toISOString() }, 'Di Past')]} onOpen={onOpen} />);
  const needs = screen.getByTestId('tour-group-needs_action');
  expect(within(needs).getAllByTestId('manager-tour-row').map(row => row.dataset.state)).toEqual(['request', 'record']);
  expect(within(needs).getByRole('button', { name: /^Review request: Ana Request/ })).toBeInTheDocument();
  fireEvent.click(within(needs).getByRole('button', { name: /^Did they come\?: Ben Visit/ }));
  expect(onOpen).toHaveBeenLastCalledWith(ended);
  const upcoming = screen.getByTestId('tour-group-upcoming');
  expect(within(upcoming).getByText('Cy Later')).toBeInTheDocument();
  expect(within(upcoming).queryByRole('button', { name: /Review|Did they come/ })).not.toBeInTheDocument();
  fireEvent.click(within(upcoming).getByRole('button', { name: /TOUR-3/ }));
  expect(onOpen).toHaveBeenLastCalledWith(later);
  expect(screen.queryByText('Di Past')).not.toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole('tab', { name: /Past/ }));
  expect(screen.getByText('Di Past')).toBeInTheDocument();
});
