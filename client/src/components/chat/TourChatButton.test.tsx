import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
const state = vi.hoisted(() => ({ resolve: vi.fn(), search: '' }));
vi.mock('@/services/chat-service', () => ({ resolveTourConversation: state.resolve }));
vi.mock('wouter', () => ({ useSearch: () => state.search }));
vi.mock('./UnifiedChatView', () => ({ default: (props: any) => <div data-testid="specific-chat">{JSON.stringify(props)}</div> }));
import { TourChatButton } from './TourChatButton';
const resolved = { conversationId: 'original', chefId: 8, managerId: 12, chefName: 'Alex Chen', managerName: 'Morgan Lee' };
beforeEach(() => { vi.clearAllMocks(); state.search = ''; state.resolve.mockResolvedValue(resolved); });
describe('tour messaging entry', () => {
  it.each(['chef', 'manager'] as const)('opens server-returned exact context for %s, including terminal tours', async role => {
    render(<TourChatButton tour={{ id: 20, status: 'cancelled', adminReviewDecision: 'approved' }} role={role} />);
    fireEvent.click(screen.getByRole('button', { name: role === 'chef' ? 'Message manager' : 'Message chef' }));
    expect(await screen.findByRole('dialog')).toHaveAccessibleName(`Chat with ${role === 'chef' ? 'Morgan Lee' : 'Alex Chen'}`);
    const props = JSON.parse(screen.getByTestId('specific-chat').textContent!);
    expect(props).toEqual({ userId: role === 'chef' ? 8 : 12, role, initialConversationId: 'original', initialTourId: '20', hideConversationList: true });
    expect(state.resolve).toHaveBeenCalledWith(20);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it.each([{ status: 'pending_local_cooks', adminReviewDecision: null }, { status: 'cancelled', adminReviewDecision: 'denied' },
    { status: 'completed', adminReviewDecision: null }])('does not advertise ungranted tours: $status/$adminReviewDecision', tour => {
    render(<TourChatButton tour={{ id: 20, ...tour }} role="chef" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('shows recoverable provision failure and retries the same exact tour', async () => {
    state.resolve.mockRejectedValueOnce(Error('Messaging unavailable')).mockResolvedValueOnce(resolved);
    render(<TourChatButton tour={{ id: 20, status: 'pending', adminReviewDecision: 'approved' }} role="chef" />);
    fireEvent.click(screen.getByRole('button')); await screen.findByRole('alert');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button')); await screen.findByRole('dialog');
    expect(state.resolve.mock.calls).toEqual([[20], [20]]);
  });
  it.each(['chef', 'manager'] as const)('opens only the linked person from an email action for %s', async role => {
    state.search = '?view=viewings&viewing=20&action=message';
    render(<><TourChatButton tour={{ id: 7, status: 'confirmed' }} role={role} openFromLink />
      <TourChatButton tour={{ id: 20, status: 'confirmed' }} role={role} openFromLink /></>);
    await screen.findByRole('dialog');
    expect(state.resolve.mock.calls).toEqual([[20]]);
    expect(screen.getByTestId('specific-chat')).toHaveTextContent('"initialTourId":"20"');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(state.resolve).toHaveBeenCalledTimes(1);
  });
  it('does not open a dialog when participant context is missing', async () => {
    state.resolve.mockResolvedValue({ conversationId: 'original' });
    render(<TourChatButton tour={{ id: 20, status: 'confirmed' }} role="chef" />);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Messaging unavailable');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
