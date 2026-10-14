vi.mock('@/i18n/chef-ns', async () => ({ ct: (await import('@/test/booking-i18n')).useBookingTranslation('chef').t }));
vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'test-token' } } }));
import { VisitAssistancePanel } from './VisitAssistancePanel';
const fetchMock = vi.fn();
const updatedAt = '2026-10-02T18:00:00Z';
function enterEvidence(time = '2026-10-02T17:00') {
  fireEvent.change(screen.getByLabelText(/Departure time/), { target: { value: time } });
  fireEvent.change(screen.getByLabelText(/Note to/), { target: { value: 'Chef reported leaving after upload failed' } });
}
describe('manager assistance consumer', () => {
  beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
  it('requires a visit and explicit actual time, then sends the selected version and Newfoundland instant', async () => {
    const onSaved = vi.fn(async () => {});
    render(<VisitAssistancePanel bookingId={10} updatedAt={updatedAt} visits={[{ id: 5, startTime: '16:00', endTime: '18:00', updatedAt: '2026-10-02T18:01:00Z' }, { id: 6, startTime: '19:00', endTime: '20:00', updatedAt }]} onSaved={onSaved} />);
    expect(screen.getByRole('button', { name: 'Save departure time' })).toBeDisabled();
    enterEvidence(); expect(screen.getByRole('button', { name: 'Save departure time' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Visit'), { target: { value: '5' } });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    fireEvent.click(screen.getByRole('button', { name: 'Save departure time' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ visitId: 5, actualAt: '2026-10-02T17:00', expectedUpdatedAt: '2026-10-02T18:01:00Z', expectedBookingUpdatedAt: updatedAt });
  });
  it('retains input after a stale response and retries through the real storage endpoint', async () => {
    const onSaved = vi.fn(async () => {});
    render(<VisitAssistancePanel bookingId={30} updatedAt={updatedAt} storage onSaved={onSaved} />);
    enterEvidence(); fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Storage changed; refresh before assisting' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Save departure time' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your note is still here');
    expect(screen.getByLabelText(/Note to/)).toHaveValue('Chef reported leaving after upload failed');
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'confirm_removal' } });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm storage collected' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(fetchMock.mock.calls[1][0]).toBe('/api/manager/storage-bookings/30/assist-visit');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).action).toBe('confirm_removal');
  });
  it('requires an occurrence for repeated clock time and rejects a nonexistent spring time', () => {
    render(<VisitAssistancePanel bookingId={10} updatedAt={updatedAt} onSaved={async () => {}} />);
    enterEvidence('2026-11-01T01:30');
    expect(screen.getByRole('button', { name: 'Save departure time' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/This time occurs twice/), { target: { value: '1' } });
    expect(screen.getByRole('button', { name: 'Save departure time' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText(/Departure time/), { target: { value: '2026-03-08T02:30' } });
    expect(screen.getByRole('button', { name: 'Save departure time' })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not invent a repeated time for a kitchen without daylight saving time', async () => {
    render(<VisitAssistancePanel bookingId={10} updatedAt={updatedAt} timezone="Asia/Tokyo" onSaved={async () => {}} />);
    enterEvidence('2026-11-01T01:30');
    expect(screen.getByLabelText(/Departure time/)).toHaveAccessibleName(/Japan Standard Time/);
    expect(screen.queryByLabelText(/This time occurs twice/)).not.toBeInTheDocument();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    fireEvent.click(screen.getByRole('button', { name: 'Save departure time' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).actualAt).toBe('2026-11-01T01:30');
  });

  it('disambiguates a repeated kitchen time using its actual zone', async () => {
    render(<VisitAssistancePanel bookingId={10} updatedAt={updatedAt} timezone="America/Toronto" onSaved={async () => {}} />);
    enterEvidence('2026-11-01T01:30');
    expect(screen.getByRole('button', { name: 'Save departure time' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/This time occurs twice/), { target: { value: '1' } });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    fireEvent.click(screen.getByRole('button', { name: 'Save departure time' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).actualAt).toBe('2026-11-01T06:30:00.000Z');
  });
});
