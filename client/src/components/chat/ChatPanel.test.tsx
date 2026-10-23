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
