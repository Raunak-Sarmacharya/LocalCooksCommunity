import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CheckoutCancellationDisclosure, CheckoutConsentNotice } from './CheckoutCancellationDisclosure';
vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
const policy = { policy: { id: 1, version: 2, noticeHours: 48, lateChargePercent: 50 }, timezone: 'America/St_Johns', settings: { noticeOptions: [24, 48, 72], chargeOptions: [50, 100], default: { notice: 24, charge: 100 } } };
const inHours = (hours: number) => new Date(Date.now() + hours * 3600000).toISOString();
const openDetails = () => fireEvent.click(screen.getByRole('button', { name: 'Details' }));

it('normal booking: one calm line, full terms behind Details, no checkbox', () => {
  render(<CheckoutCancellationDisclosure policy={policy} startAt={inHours(5 * 24)} />);
  expect(screen.getByTestId('cancel-headline')).toHaveTextContent(/^Cancel for a refund until .*Newfoundland Time\)\.$/);
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByTestId('cancel-details')).toBeNull();
  expect(screen.queryByTestId('cancel-near-deadline')).toBeNull();
  openDetails();
  const details = screen.getByTestId('cancel-details');
  expect(screen.getByTestId('cancel-pre-confirmation')).toHaveTextContent('Free to cancel until the kitchen confirms your request — your card is only on hold.');
  expect(details).toHaveTextContent(/Cancel by .*Newfoundland.* for a full refund minus the actual card processing fee\. After that, you pay 50% of the booking total\./);
  expect(details).toHaveTextContent(/The kitchen answers your request at least an hour before the refund deadline/);
  expect(screen.getByTestId('cancel-no-show')).toHaveTextContent('No-shows aren’t refunded.');
  expect(screen.getByRole('button', { name: 'Hide details' })).toHaveAttribute('aria-expanded', 'true');
});

it('full late charge: details say there is no refund after the deadline (calm wording, owner Oct 16)', () => {
  render(<CheckoutCancellationDisclosure policy={{ ...policy, policy: { ...policy.policy, lateChargePercent: 100 } }} startAt={inHours(5 * 24)} />);
  openDetails();
  expect(screen.getByTestId('cancel-details')).toHaveTextContent(/After that, this booking isn’t refundable\./);
  expect(screen.getByTestId('cancel-no-show')).toBeInTheDocument();
});

it('short notice: the warning stays visible as the headline; no free-cancellation claim', () => {
  render(<CheckoutCancellationDisclosure policy={policy} startAt={inHours(1)} />);
  expect(screen.getByTestId('cancel-short-notice')).toHaveTextContent(/This booking starts within 48 hours\. Once the kitchen confirms, you pay 50% of the booking total if you cancel/);
  expect(screen.queryByText(/Cancel for a refund/)).toBeNull();
  openDetails();
  expect(screen.queryByText(/Cancel by/)).toBeNull();
  expect(screen.getByTestId('cancel-no-show')).toHaveTextContent('No-shows aren’t refunded.');
});

it('near the deadline: headline plus a visible warning that the kitchen may confirm after it ends', () => {
  // 48-hour policy, start in 48h40m: free cancellation ends in 40 minutes — too soon to require the kitchen to answer first.
  render(<CheckoutCancellationDisclosure policy={policy} startAt={new Date(Date.now() + (48 * 60 + 40) * 60000).toISOString()} />);
  expect(screen.getByTestId('cancel-headline')).toHaveTextContent(/^Cancel for a refund until/);
  expect(screen.getByTestId('cancel-near-deadline')).toHaveTextContent(/If the kitchen confirms after it, you pay 50% of the booking total/);
  openDetails();
  expect(screen.getByTestId('cancel-details')).toHaveTextContent(/Cancel by .*Newfoundland/);
  expect(screen.queryByText(/The kitchen answers your request at least an hour/)).toBeNull();
});

it('without a start time the headline states the notice in hours', () => {
  render(<CheckoutCancellationDisclosure policy={policy} />);
  expect(screen.getByTestId('cancel-headline')).toHaveTextContent('Cancel for a refund up to 48 hours before your booking.');
});

it('says so when the policy could not load', () => {
  render(<CheckoutCancellationDisclosure />);
  expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t load the cancellation policy');
  expect(screen.queryByRole('button', { name: 'Details' })).toBeNull();
});

it('details can be opened from outside (the consent line’s policy link)', () => {
  render(<CheckoutCancellationDisclosure policy={policy} startAt={inHours(5 * 24)} detailsOpen detailsId="cp-details" />);
  expect(screen.getByTestId('cancel-details')).toHaveAttribute('id', 'cp-details');
});

it('consent line under Checkout: selecting the button is the acceptance; links open the policy and the terms', () => {
  const show = vi.fn();
  render(<CheckoutConsentNotice buttonLabel="Checkout" onShowPolicy={show} />);
  expect(screen.getByTestId('checkout-consent')).toHaveTextContent('By selecting Checkout, you agree to the cancellation policy and the Local Cooks terms.');
  fireEvent.click(screen.getByRole('button', { name: 'cancellation policy' }));
  expect(show).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('link', { name: 'Local Cooks terms' })).toHaveAttribute('href', '/terms');
});

it('multi-day: one deadline sentence; a first day inside the notice gets the short-notice warning, never a past "Cancel by" date (live, Oct 18)', () => {
  const { unmount } = render(<CheckoutCancellationDisclosure policy={policy} startAt={inHours(5 * 24)} multiDay />);
  expect(screen.getByTestId('cancel-headline')).toHaveTextContent(/^Cancel by .* late charge applies to every day\.$/);
  unmount();
  render(<CheckoutCancellationDisclosure policy={policy} startAt={inHours(2)} multiDay />);
  expect(screen.getByTestId('cancel-short-notice')).toHaveTextContent(/This booking starts within 48 hours/);
  expect(screen.queryByText(/Cancel by/)).toBeNull();
});
