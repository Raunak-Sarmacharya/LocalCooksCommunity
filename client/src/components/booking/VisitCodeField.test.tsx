vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
vi.mock('@/lib/api', () => ({ getAuthHeaders: async () => ({ Authorization: 'Bearer fixture-token' }) }));
vi.mock('@/components/chat/UnifiedChatView', () => ({ default: ({ initialDraft }: { initialDraft?: string }) => <p data-testid="chat-draft">{initialDraft}</p> }));
vi.mock('./BookingProblemReport', () => ({ BookingProblemReport: () => <button type="button">Report a problem</button> }));
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VisitCodeField } from './VisitCodeField';

const state = { codeRequired: true, mode: 'code', attemptsLeft: 5, locked: false, revoked: false, consumed: false } as any;
const props = { state, value: '', onChange: () => {}, problem: null, canReportProblem: true, bookingId: 189, chefId: 380, kitchenName: 'Harbour Kitchen' };
beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ conversationId: 'conv-1' }) }))));
afterEach(() => vi.unstubAllGlobals());

describe("can't get in at check-in", () => {
  it('offers Message kitchen next to Report a problem, opening the chat with a ready "can’t get in" message', async () => {
    render(<VisitCodeField {...props} gate="code" />);
    const block = screen.getByTestId('visit-no-access');
    expect(block).toHaveTextContent('Report a problem');
    fireEvent.click(screen.getByRole('button', { name: 'Message kitchen' }));
    expect(await screen.findByTestId('chat-draft')).toHaveTextContent('Hi, I’m at Harbour Kitchen for my booking and can’t get in. Can you let me in?');
    expect(fetch).toHaveBeenCalledWith('/api/bookings/189/conversation', expect.objectContaining({ method: 'POST' }));
  });
  it('a locked code shows one Message kitchen, asking for a new code', async () => {
    render(<VisitCodeField {...props} gate="locked" />);
    expect(screen.getAllByRole('button', { name: 'Message kitchen' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Message kitchen' }));
    expect(await screen.findByTestId('chat-draft')).toHaveTextContent('I need a new check-in code for my booking at Harbour Kitchen.');
  });
});
