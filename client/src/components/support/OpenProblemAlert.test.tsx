vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
const data: { problems: unknown[] } = { problems: [] };
vi.mock('./CommitmentProblems', () => ({ useCommitmentProblems: () => ({ data }) }));
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OpenProblemAlert } from './OpenProblemAlert';

const report = (over: Record<string, unknown> = {}) => ({ id: 12, bookingId: 189, viewingId: null, kind: 'live', status: 'reported', claimedBy: null, revision: 1,
  description: 'The front door is locked and nobody answers the buzzer.', category: 'access',
  history: [{ revision: 1, actorId: 380, actorRole: 'chef', at: '2026-10-16T13:11:00Z', action: 'report', note: 'Report received' }], ...over });
const mount = (role: 'chef' | 'manager', active = true) => render(<OpenProblemAlert bookingId={189} role={role} chefName="Sam Chef" kitchenName="Harbour Kitchen"
  timezone="America/St_Johns" active={active} messageButton={<button type="button">Message</button>} onViewReport={() => {}} />);

describe('urgent report at the top of the booking', () => {
  it('kitchen: who can’t get in, when, what they wrote, and a way to message them', () => {
    data.problems = [report()];
    mount('manager');
    const row = screen.getByTestId('open-problem-alert');
    expect(row).toHaveTextContent('Sam Chef can’t get in');
    expect(row).toHaveTextContent('Reported at 10:41 a.m. Let them in or message them now.');
    expect(row).toHaveTextContent('The front door is locked');
    expect(screen.getByRole('button', { name: 'Message' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View report' })).toBeInTheDocument();
  });
  it('chef: both sides were told; don’t check in until inside', () => {
    data.problems = [report()];
    mount('chef');
    expect(screen.getByTestId('open-problem-alert')).toHaveTextContent('You told Harbour Kitchen you can’t get in');
    expect(screen.getByTestId('open-problem-alert')).toHaveTextContent('Don’t check in until you’re inside.');
  });
  it('nothing once resolved, after the visit, or for other kinds of report', () => {
    for (const problems of [[report({ status: 'resolved' })], [report({ category: 'equipment' })], [report({ kind: 'schedule' })]]) {
      data.problems = problems;
      const { container, unmount } = mount('manager');
      expect(container).toBeEmptyDOMElement(); unmount();
    }
    data.problems = [report()];
    expect(mount('manager', false).container).toBeEmptyDOMElement();
  });
});
