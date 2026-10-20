import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CheckoutCancellationDisclosure, CheckoutConsentNotice } from './CheckoutCancellationDisclosure';
vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
const policy = { policy: { id: 1, version: 2, noticeHours: 48, lateChargePercent: 50 }, timezone: 'America/St_Johns', settings: { noticeOptions: [24, 48, 72], chargeOptions: [50, 100], default: { notice: 24, charge: 100 } } };
const inHours = (hours: number) => new Date(Date.now() + hours * 3600000).toISOString();
const openDetails = () => fireEvent.click(screen.getByRole('button', { name: 'Details' }));

it('normal booking: one calm line, the policy timeline behind Details, no checkbox', () => {
  render(<CheckoutCancellationDisclosure policy={policy} startAt={inHours(5 * 24)} />);
  expect(screen.getByTestId('cancel-headline')).toHaveTextContent(/^Free to cancel until the kitchen accepts\. After that, cancel by .*Newfoundland Time\) for a refund, minus the card processing fee\.$/);
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByTestId('cancel-details')).toBeNull();
  expect(screen.queryByTestId('cancel-near-deadline')).toBeNull();
  openDetails();
  const details = screen.getByTestId('cancel-details');
  // The same timeline as the kitchen page and the policy dialog, with the real deadline.
  expect(details).toHaveTextContent(/Until the kitchen accepts.*Nothing is charged/);
  expect(details).toHaveTextContent(/Until .*Newfoundland Time\).*Full refund, minus the card processing fee\./);
  expect(details).toHaveTextContent(/After .*Newfoundland Time\).*You get 50% back, after the card processing fee\./);
  expect(details).toHaveTextContent('No-shows aren’t refunded.');
  expect(details).toHaveTextContent(/The kitchen answers your request at least an hour before the refund deadline/);
  expect(details.textContent).not.toMatch(/—/);
  expect(screen.getByRole('button', { name: 'Hide details' })).toHaveAttribute('aria-expanded', 'true');
});

it('full late charge: the timeline says there is no refund after the deadline', () => {
  render(<CheckoutCancellationDisclosure policy={{ ...policy, policy: { ...policy.policy, lateChargePercent: 100 } }} startAt={inHours(5 * 24)} />);
  openDetails();
  expect(screen.getByTestId('cancel-details')).toHaveTextContent(/After .*No refund\./);
});

it('short notice: the warning stays visible as the headline; no free-cancellation claim', () => {
  render(<CheckoutCancellationDisclosure policy={policy} startAt={inHours(1)} />);
  expect(screen.getByTestId('cancel-short-notice')).toHaveTextContent(/This booking starts within 48 hours\. Once the kitchen accepts, you pay 50% of the booking total if you cancel/);
  expect(screen.queryByTestId('cancel-headline')).toBeNull();
  openDetails();
  expect(screen.getByTestId('cancel-details')).toHaveTextContent('No-shows aren’t refunded.');
});

it('near the deadline: headline plus a visible warning that the kitchen may accept after it ends', () => {
  // 48-hour policy, start in 48h40m: the refund deadline ends in 40 minutes, too soon to require the kitchen to answer first.
  render(<CheckoutCancellationDisclosure policy={policy} startAt={new Date(Date.now() + (48 * 60 + 40) * 60000).toISOString()} />);
  expect(screen.getByTestId('cancel-headline')).toHaveTextContent(/^Free to cancel until the kitchen accepts/);
  expect(screen.getByTestId('cancel-near-deadline')).toHaveTextContent(/If the kitchen accepts after it, you pay 50% of the booking total/);
  openDetails();
  expect(screen.queryByText(/The kitchen answers your request at least an hour/)).toBeNull();
});

it('without a start time the headline states the notice in hours', () => {
  render(<CheckoutCancellationDisclosure policy={policy} />);
  expect(screen.getByTestId('cancel-headline')).toHaveTextContent('Free to cancel until the kitchen accepts. After that, cancel up to 48 hours before for a refund, minus the card processing fee.');
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

it('a first day inside the notice gets the short-notice warning, never a past deadline (live, Oct 18)', () => {
  render(<CheckoutCancellationDisclosure policy={policy} startAt={inHours(2)} />);
  expect(screen.getByTestId('cancel-short-notice')).toHaveTextContent(/This booking starts within 48 hours/);
  expect(screen.queryByText(/cancel by/i)).toBeNull();
});

it('inside another card it drops its own box', () => {
  const { container } = render(<CheckoutCancellationDisclosure bare policy={policy} startAt={inHours(5 * 24)} />);
  expect(container.querySelector('section')).not.toHaveClass('border');
});
