import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
const state = vi.hoisted(() => ({ rows: [] as any[], resolve: vi.fn(), panel: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { displayName: 'Viewer', getIdToken: async () => 'token' } } }));
vi.mock('@/services/chat-service', () => ({ getAllConversations: async () => state.rows,
  getLiveChatParticipants: async () => new Set([3, 2]), setConversationArchived: vi.fn(), resolveTourConversation: state.resolve }));
vi.mock('./ChatPanel', () => ({ default: (props: any) => { state.panel(props); return <div data-testid="thread">{props.conversationId}</div>; } }));
import UnifiedChatView from './UnifiedChatView';
function show(props = {}) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <UnifiedChatView userId={3} role="chef" {...props} /></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks(); window.history.replaceState({}, '', '/dashboard');
  state.rows = [5, 6].map(locationId => ({ id: 'original-' + locationId, chefId: 3, managerId: 2, locationId,
    chefName: 'Actual Chef', managerName: 'Actual Manager', locationName: 'Kitchen ' + locationId,
    createdAt: new Date(), lastMessageAt: new Date(), unreadChefCount: 0, unreadManagerCount: 0 }));
});
describe('shared inbox and exact selection', () => {
  it('uses authoritative tour-only chef names in the manager list, header and search', async () => {
    state.rows[1].chefId = 4; state.rows[1].chefName = 'Other Chef';
    show({ userId: 2, role: 'manager', initialConversationId: 'original-5' });
    await screen.findByTestId('thread');
    expect(state.panel).toHaveBeenLastCalledWith(expect.objectContaining({ chefName: 'Actual Chef', applicationId: undefined }));
    expect(screen.getByText('Actual Chef')).toBeTruthy();
    expect(screen.queryByText('Chef #3')).toBeNull();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Actual Chef' } });
    expect(screen.getByText('Kitchen 5')).toBeTruthy();
    expect(screen.queryByText('Kitchen 6')).toBeNull();
  });
  it('retains real approved application chef-name fallback when the DTO name is absent', async () => {
    state.rows[0].chefName = undefined; state.rows[0].applicationId = 8;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ id: 8, status: 'approved', fullName: 'Application Chef' }] })));
    show({ userId: 2, role: 'manager', initialConversationId: 'original-5' });
    await waitFor(() => expect(state.panel).toHaveBeenLastCalledWith(expect.objectContaining({ chefName: 'Application Chef' })));
    expect(screen.getByText('Application Chef')).toBeTruthy();
  });
  it('opens a tour-only thread without application/book permission and uses supplied names', async () => {
    state.resolve.mockResolvedValue({ conversationId: 'original-5' });
    show({ initialConversationId: 'original-5', initialTourId: '20' });
    await screen.findByTestId('thread');
    expect(state.panel).toHaveBeenLastCalledWith(expect.objectContaining({ applicationId: undefined, canBook: false, managerName: 'Actual Manager' }));
    expect(screen.getAllByText('Actual Manager')).toHaveLength(2);
    expect(screen.getByText('Kitchen 5')).toBeTruthy(); expect(screen.getByText('Kitchen 6')).toBeTruthy();
  });
  it('does not substitute another conversation when an exact tour link disagrees', async () => {
    state.resolve.mockResolvedValue({ conversationId: 'original-6' });
    show({ initialConversationId: 'original-5', initialTourId: '20' });
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer matches');
    expect(screen.queryByTestId('thread')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(state.resolve).toHaveBeenCalledTimes(2));
  });
  it('uses the same thread with approved application permissions when real context arrives', async () => {
    state.rows[0].applicationId = 8;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ id: 8, status: 'approved', current_tier: 3, tier2_completed_at: '2026-10-01' }] })));
    show({ initialConversationId: 'original-5' });
    await waitFor(() => expect(state.panel).toHaveBeenLastCalledWith(expect.objectContaining({ conversationId: 'original-5', applicationId: 8, canBook: true })));
  });
  it('reports unavailable old IDs and keeps existing booking context on an authorized exact thread', async () => {
    const old = show({ initialConversationId: 'missing' });
    expect(await screen.findByRole('alert')).toHaveTextContent('unavailable'); old.unmount();
    window.history.replaceState({}, '', '/dashboard?view=messages&conversation=original-5&booking=10');
    show({ initialConversationId: 'original-5' }); await screen.findByTestId('thread');
    expect(state.panel).toHaveBeenLastCalledWith(expect.objectContaining({ bookingId: 10 }));
  });
});
