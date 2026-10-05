import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import BookingPreparation from './BookingPreparation';
afterEach(cleanup);
describe('preparation before action windows and without tracking', () => {
  it('shows the current instructions without requiring a check-in action or tracking configuration', () => {
    const { rerender } = render(<BookingPreparation arrivalInstructions="Meet at the side door at 9am" departureInstructions="Return the trolley before leaving" />);
    expect(screen.getByText('Meet at the side door at 9am')).toBeVisible();
    expect(screen.getByText('Return the trolley before leaving')).toBeVisible();
    rerender(<BookingPreparation arrivalInstructions="Use the front door instead" />);
    expect(screen.queryByText('Meet at the side door at 9am')).toBeNull();
    expect(screen.getByText('Use the front door instead')).toBeVisible();
  });
  it('provides a useful contact next step when instructions have not been entered', () => {
    render(<BookingPreparation />);
    expect(screen.getByText(/Contact the kitchen manager before arrival/)).toBeVisible();
  });
});
