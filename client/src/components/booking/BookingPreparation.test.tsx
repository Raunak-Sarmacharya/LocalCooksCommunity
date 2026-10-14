vi.mock('@/i18n/chef-ns', async () => ({ ct: (await import('@/test/booking-i18n')).useBookingTranslation('chef').t }));
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en-CA' }, t: (_key: string, fallback: any) => {
  if (typeof fallback === 'string') return fallback;
  // Minimal ICU stand-in: fill {name} and collapse the hours plural to its "other" branch.
  return String(fallback?.defaultValue ?? _key).replace(/\{hours, plural,.*?other \{# hours\}\}/, `${fallback.hours} hours`).replace(/\{(\w+)\}/g, (_m, k) => String(fallback[k]));
} }) }));
import BookingPreparation from './BookingPreparation';
afterEach(cleanup);
describe('preparation before action windows and without tracking', () => {
  it.each(['completed', 'cancelled', 'pending'])('hides live preparation for a %s booking', (bookingStatus) => {
    render(<BookingPreparation bookingStatus={bookingStatus} arrivalInstructions="Private arrival instructions" departureInstructions="Private departure instructions" />);
    expect(screen.queryByText('Private arrival instructions')).not.toBeInTheDocument();
    expect(screen.queryByText('Private departure instructions')).not.toBeInTheDocument();
  });
  it('removes live preparation when an active booking completes', () => {
    const { rerender } = render(<BookingPreparation bookingStatus="confirmed" arrivalInstructions="Meet the kitchen manager" />);
    expect(screen.getByText('Meet the kitchen manager')).toBeVisible();
    rerender(<BookingPreparation bookingStatus="completed" arrivalInstructions="Meet the kitchen manager" />);
    expect(screen.queryByText('Meet the kitchen manager')).not.toBeInTheDocument();
  });
  it('shows the current instructions without requiring a check-in action or tracking configuration', () => {
    const { rerender } = render(<BookingPreparation arrivalInstructions="Meet at the side door at 9am" departureInstructions="Return the trolley before leaving" />);
    expect(screen.getByText('Meet at the side door at 9am')).toBeVisible();
    expect(screen.getByText('Return the trolley before leaving')).toBeVisible();
    expect(screen.getByText('Arrival instructions')).toBeVisible();
    expect(screen.getByText('Departure instructions')).toBeVisible();
    rerender(<BookingPreparation arrivalInstructions="Use the front door instead" />);
    expect(screen.queryByText('Meet at the side door at 9am')).toBeNull();
    expect(screen.getByText('Use the front door instead')).toBeVisible();
  });
  it('provides a useful contact next step when instructions have not been entered', () => {
    render(<BookingPreparation />);
    expect(screen.getByText(/Use your booking contact details if you need help getting in/)).toBeVisible();
  });
  describe('instruction release', () => {
    const release = '2026-10-14T12:00:00.000Z';
    const start = new Date('2026-10-16T12:00:00.000Z');
    it('shows the overview and no instruction headings before release', () => {
      render(<BookingPreparation bookingStatus="confirmed" arrivalInstructions={null} departureInstructions={null} instructionsReleased={false}
        instructionsReleaseAt={release} visitStartAt={start} timezone="UTC" arrivalMode="staffed" address="1 Harbour Rd"
        contact={{ email: 'k@example.com', phone: '555-0100' }} requiredTasks={['Wipe benches', 'Photo of the sink']} />);
      expect(screen.getByTestId('instructions-overview')).toBeVisible();
      expect(screen.getByText(/ask for your 6-digit visit code/)).toBeVisible();
      expect(screen.getByText(/1 Harbour Rd/)).toBeVisible();
      expect(screen.getByText(/555-0100 · k@example.com/)).toBeVisible();
      expect(screen.getByText('Wipe benches')).toBeVisible();
      expect(screen.getByText(/Arrival and departure instructions will appear here on .*Oct 14.* \(48 hours before your visit\)\. We'll email them to you too\./)).toBeVisible();
      expect(screen.queryByText('Arrival instructions')).toBeNull();
      expect(screen.queryByText(/No arrival instructions provided/)).toBeNull();
    });
    it.each([
      ['self', /Self check-in is on for this visit/],
      ['mixed', /Arrival method varies by visit/],
      ['legacy', /Follow the arrival instructions and confirm arrival/],
    ] as const)('uses the %s mode line', (arrivalMode, text) => {
      render(<BookingPreparation instructionsReleased={false} instructionsReleaseAt={release} arrivalMode={arrivalMode} />);
      expect(screen.getByText(text)).toBeVisible();
    });
    it('treats a missing flag as released and puts the mode line above the instructions', () => {
      render(<BookingPreparation arrivalInstructions="Side door" arrivalMode="self" />);
      expect(screen.getByText('Side door')).toBeVisible();
      expect(screen.getByTestId('arrival-mode-line')).toBeVisible();
      expect(screen.queryByTestId('instructions-overview')).toBeNull();
    });
    it('hides the overview for a cancelled booking', () => {
      render(<BookingPreparation bookingStatus="cancelled" instructionsReleased={false} instructionsReleaseAt={release} />);
      expect(screen.queryByTestId('instructions-overview')).toBeNull();
    });
  });
});

describe('after the visit has started or finished', () => {
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const future = new Date(Date.now() + 86_400_000).toISOString();
  it('does not show a pre-release overview whose release time already passed', () => {
    const { container, rerender } = render(<BookingPreparation bookingStatus="confirmed" instructionsReleased={false} instructionsReleaseAt={past} arrivalMode="staffed" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<BookingPreparation bookingStatus="confirmed" instructionsReleased={false} instructionsReleaseAt={future} arrivalMode="staffed" />);
    expect(screen.getByTestId('instructions-overview')).toBeInTheDocument();
  });
  it('drops arrival guidance once checked in and keeps departure details', () => {
    render(<BookingPreparation inSession bookingStatus="confirmed" arrivalMode="staffed" arrivalInstructions="Meet staff at the door" departureInstructions="Lock the side door" />);
    expect(screen.queryByText('Meet staff at the door')).not.toBeInTheDocument();
    expect(screen.queryByTestId('arrival-mode-line')).not.toBeInTheDocument();
    expect(screen.getByText('Lock the side door')).toBeVisible();
  });
});
