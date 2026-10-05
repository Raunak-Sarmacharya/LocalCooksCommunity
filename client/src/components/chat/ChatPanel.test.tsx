import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('@/hooks/use-chat', () => ({ useChat: () => ({ messages: [], isLoading: false, isSending: false, currentUserId: 2,
  handleSendMessage: vi.fn(), isManager: true, isAdmin: false, role: 'manager', error: null }) }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: null } }));
vi.mock('./FacilityDocumentsPanel', () => ({ default: () => <div data-testid="application-documents">Application documents</div> }));
vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
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
