import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const chat = vi.hoisted(() => ({ messages: [] as unknown[] }));
vi.mock('@/hooks/use-chat', () => ({ useChat: () => ({ messages: chat.messages, isLoading: false, isSending: false, currentUserId: 2,
  handleSendMessage: vi.fn(), isManager: true, isAdmin: false, role: 'manager', error: null }) }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: null } }));
vi.mock('./FacilityDocumentsPanel', () => ({ default: () => <div data-testid="application-documents">Application documents</div> }));
vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
Element.prototype.scrollIntoView = () => {};
import ChatPanel from './ChatPanel';
describe('optional application panels', () => {
  it('has a normal composer for tour-only managers and makes no application document request', () => {
    render(<ChatPanel conversationId="original" chefId={3} managerId={2} locationId={5} />);
    expect(screen.queryByTestId('application-documents')).toBeNull();
    expect(screen.getByRole('textbox')).toBeTruthy();
  });
  it('exposes the existing document panel only with real application context', () => {
    render(<ChatPanel conversationId="original" applicationId={8} chefId={3} managerId={2} locationId={5} />);
    expect(screen.getByTestId('application-documents')).toBeTruthy();
  });
});
describe('message times', () => {
  it('uses the 12-hour app clock and a divider when the day changes', () => {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); yesterday.setHours(19, 27, 0, 0);
    const today = new Date(); today.setHours(11, 46, 0, 0);
    chat.messages = [{ id: 'a', senderId: 3, senderRole: 'chef', content: 'Running late', createdAt: yesterday, type: 'text' },
      { id: 'b', senderId: 2, senderRole: 'manager', content: 'No problem', createdAt: yesterday, type: 'text' },
      { id: 'c', senderId: 3, senderRole: 'chef', content: 'Stand mixer?', createdAt: today, type: 'text' }];
    render(<ChatPanel conversationId="original" chefId={3} managerId={2} locationId={5} />);
    expect(screen.getAllByRole('separator').map(item => item.textContent)).toEqual(['chatYesterday', 'chatToday']);
    expect(screen.getAllByText(/^7:27\s?p\.m\.$/i)).toHaveLength(2);
    expect(screen.getByText(/^11:46\s?a\.m\.$/i)).toBeTruthy();
    chat.messages = [];
  });
});
describe('booking, tour and storage updates in the thread', () => {
  const event = (id: number, action: string, at: Date) => ({ kind: 'booking', id, action, at: at.toISOString(),
    item: { kind: 'booking', id, status: 'confirmed', date: '2026-11-16', startTime: '10:00', endTime: '12:00', href: `/manager/booking/${id}` } });
  const context = (events: unknown[]) => ({ kitchen: { name: 'Harbour', address: null, imageUrl: null, timezone: 'America/St_Johns' }, access: null,
    upcoming: [], past: { count: 0, latest: [] }, events }) as any;
  it('weaves updates between messages and collapses a run of several to the latest', () => {
    const base = new Date(); base.setHours(9, 0, 0, 0);
    const at = (minutes: number) => new Date(base.getTime() + minutes * 60_000);
    chat.messages = [{ id: 'a', senderId: 3, senderRole: 'chef', content: 'Hi there', createdAt: at(0), type: 'text' }];
    render(<ChatPanel conversationId="original" chefId={3} managerId={2} locationId={5}
      context={context([event(1, 'confirmed', at(10)), event(2, 'confirmed', at(20)), event(3, 'cancelled', at(30))])} />);
    expect(screen.getByText('Hi there')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'chatEarlierUpdates' })).toBeTruthy();
    expect(screen.getAllByText(/chatEvent_booking_/)).toHaveLength(1);
    expect(screen.getByText(/chatEvent_booking_cancelled/)).toBeTruthy();
    screen.getByRole('button', { name: 'chatEarlierUpdates' }).click();
    chat.messages = [];
  });
});
