import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'test-token' } } }));
import { VisitAssistancePanel } from './VisitAssistancePanel';
const fetchMock = vi.fn();
const updatedAt = '2026-10-02T18:00:00Z';
function enterEvidence(time = '2026-10-02T17:00') {
  fireEvent.change(screen.getByLabelText(/Actual reported/), { target: { value: time } });
  fireEvent.change(screen.getByLabelText(/Reason and evidence/), { target: { value: 'Chef reported leaving after upload failed' } });
}
describe('manager assistance consumer', () => {
  beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
  it('requires a visit and explicit actual time, then sends the selected version and Newfoundland instant', async () => {
    const onSaved = vi.fn(async () => {});
    render(<VisitAssistancePanel bookingId={10} updatedAt={updatedAt} visits={[{ id: 5, startTime: '16:00', endTime: '18:00', updatedAt: '2026-10-02T18:01:00Z' }, { id: 6, startTime: '19:00', endTime: '20:00', updatedAt }]} onSaved={onSaved} />);
    expect(screen.getByRole('button', { name: 'Record assistance' })).toBeDisabled();
    enterEvidence(); expect(screen.getByRole('button', { name: 'Record assistance' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Visit'), { target: { value: '5' } });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    fireEvent.click(screen.getByRole('button', { name: 'Record assistance' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ visitId: 5, actualAt: '2026-10-02T19:30:00.000Z', expectedUpdatedAt: '2026-10-02T18:01:00Z', expectedBookingUpdatedAt: updatedAt });
  });
  it('retains input after a stale response and retries through the real storage endpoint', async () => {
    const onSaved = vi.fn(async () => {});
    render(<VisitAssistancePanel bookingId={30} updatedAt={updatedAt} storage onSaved={onSaved} />);
    enterEvidence(); fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Storage changed; refresh before assisting' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Record assistance' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your input is retained');
    expect(screen.getByLabelText(/Reason and evidence/)).toHaveValue('Chef reported leaving after upload failed');
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'confirm_removal' } });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    fireEvent.click(screen.getByRole('button', { name: 'Record assistance' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(fetchMock.mock.calls[1][0]).toBe('/api/manager/storage-bookings/30/assist-visit');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).action).toBe('confirm_removal');
  });
  it('requires an occurrence for repeated clock time and rejects a nonexistent spring time', () => {
    render(<VisitAssistancePanel bookingId={10} updatedAt={updatedAt} onSaved={async () => {}} />);
    enterEvidence('2026-11-01T01:30');
    expect(screen.getByRole('button', { name: 'Record assistance' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/This time occurs twice/), { target: { value: '1' } });
    expect(screen.getByRole('button', { name: 'Record assistance' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText(/Actual reported/), { target: { value: '2026-03-08T02:30' } });
    expect(screen.getByRole('button', { name: 'Record assistance' })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
