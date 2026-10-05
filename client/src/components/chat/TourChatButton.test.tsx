import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
const state = vi.hoisted(() => ({ resolve: vi.fn(), navigate: vi.fn() }));
vi.mock('@/services/chat-service', () => ({ resolveTourConversation: state.resolve }));
vi.mock('wouter', () => ({ useLocation: () => ['', state.navigate] }));
import { TourChatButton } from './TourChatButton';
beforeEach(() => { vi.clearAllMocks(); });
describe('tour messaging entry', () => {
  it.each(['chef', 'manager'] as const)('opens server-returned exact context for %s, including terminal tours', async role => {
    state.resolve.mockResolvedValue({ path: '/dashboard?view=messages&conversation=original&tour=20' });
    render(<TourChatButton tour={{ id: 20, status: 'cancelled', adminReviewDecision: 'approved' }} role={role} />);
    fireEvent.click(screen.getByRole('button', { name: role === 'chef' ? 'Message manager' : 'Message chef' }));
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith('/dashboard?view=messages&conversation=original&tour=20'));
    expect(state.resolve).toHaveBeenCalledWith(20);
  });
  it.each([{ status: 'pending_local_cooks', adminReviewDecision: null }, { status: 'cancelled', adminReviewDecision: 'denied' },
    { status: 'completed', adminReviewDecision: null }])('does not advertise ungranted tours: $status/$adminReviewDecision', tour => {
    render(<TourChatButton tour={{ id: 20, ...tour }} role="chef" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('shows recoverable provision failure and retries the same exact tour', async () => {
    state.resolve.mockRejectedValueOnce(Error('Messaging unavailable')).mockResolvedValueOnce({ path: '/dashboard?view=messages&conversation=original&tour=20' });
    render(<TourChatButton tour={{ id: 20, status: 'pending', adminReviewDecision: 'approved' }} role="chef" />);
    fireEvent.click(screen.getByRole('button')); await screen.findByRole('alert');
    expect(state.navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button')); await waitFor(() => expect(state.navigate).toHaveBeenCalled());
    expect(state.resolve.mock.calls).toEqual([[20], [20]]);
  });
});
