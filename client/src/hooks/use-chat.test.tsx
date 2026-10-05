import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const chat = vi.hoisted(() => ({ listener: null as null | ((messages: any[]) => void), mark: vi.fn(), invalidate: vi.fn(), userId: 3 }));
const queryClient = { invalidateQueries: chat.invalidate };
vi.mock('@/hooks/use-auth', () => ({ useFirebaseAuth: () => ({ user: { uid: 'real-chef-uid' } }) }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: { id: chat.userId } }), useQueryClient: () => queryClient }));
vi.mock('@/services/chat-service', () => ({ getMessages: vi.fn(async () => []), getAdminChatMessages: vi.fn(async () => []),
  subscribeToMessages: vi.fn((_id, listener) => { chat.listener = listener; return vi.fn(); }), markAsRead: chat.mark,
  sendMessage: vi.fn(), sendAdminChatMessage: vi.fn(), uploadChatFile: vi.fn() }));
import { useChat } from './use-chat';
const message = (id: string) => ({ id, senderId: 2, senderRole: 'manager', content: 'Booking coordination', type: 'text', readAt: null });
describe('conversation read visibility', () => {
  beforeEach(() => { chat.userId = 3; chat.listener = null; chat.mark.mockReset().mockResolvedValue(undefined); chat.invalidate.mockClear();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); });
  it('retains hidden subscription unread messages, then reads the visible snapshot', async () => {
    const { rerender } = renderHook(({ visible }) => useChat({ conversationId: 'thread', chefId: 3, managerId: 2, isVisible: visible }), { initialProps: { visible: false } });
    await waitFor(() => expect(chat.listener).toBeTruthy());
    act(() => chat.listener!([message('one'), message('two')]));
    expect(chat.mark).not.toHaveBeenCalled();
    rerender({ visible: true });
    await waitFor(() => expect(chat.mark).toHaveBeenCalledWith('thread', 3, 'chef', [message('one'), message('two')]));
  });
  it('keeps background and blurred tabs unread until focus returns', async () => {
    vi.mocked(document.hasFocus).mockReturnValue(false);
    renderHook(() => useChat({ conversationId: 'thread', chefId: 3, managerId: 2, isVisible: true }));
    await waitFor(() => expect(chat.listener).toBeTruthy());
    act(() => chat.listener!([message('one')]));
    expect(chat.mark).not.toHaveBeenCalled();
    vi.mocked(document.hasFocus).mockReturnValue(true);
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(chat.mark).toHaveBeenCalledTimes(1));
  });
  it('does not clear a participant badge when Local Cooks views the thread', async () => {
    renderHook(() => useChat({ conversationId: 'thread', chefId: 3, managerId: 2, viewerRole: 'admin', isVisible: true }));
    await act(async () => {});
    expect(chat.mark).not.toHaveBeenCalled();
  });
  it('keeps a hidden browser page unread until its visibility changes', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    renderHook(() => useChat({ conversationId: 'thread', chefId: 3, managerId: 2, isVisible: true }));
    await waitFor(() => expect(chat.listener).toBeTruthy());
    act(() => chat.listener!([message('one')])); expect(chat.mark).not.toHaveBeenCalled();
    visibility.mockReturnValue('visible'); act(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(chat.mark).toHaveBeenCalledWith('thread', 3, 'chef', [message('one')]));
  });
  it('never acknowledges the previous thread snapshot when the selected conversation changes', async () => {
    const { rerender } = renderHook(({ id }) => useChat({ conversationId: id, chefId: 3, managerId: 2, isVisible: false }), { initialProps: { id: 'first' } });
    await waitFor(() => expect(chat.listener).toBeTruthy()); act(() => chat.listener!([message('first-message')]));
    rerender({ id: 'second' }); await act(async () => {}); expect(chat.mark).not.toHaveBeenCalled();
    act(() => chat.listener!([message('second-message')])); expect(chat.mark).not.toHaveBeenCalled();
  });
});
