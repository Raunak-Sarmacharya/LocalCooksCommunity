import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@/i18n';
import { RenewAccessDocuments } from './RenewAccessDocuments';

afterEach(cleanup);

describe('renewal form status', () => {
  it('tells the chef a pending renewal is waiting and the current document stays valid', () => {
    render(<RenewAccessDocuments applicationId={5} renewals={[{ key: 'foodSafetyLicense', status: 'pending', expiry: '2099-06-01' }]} onRenewed={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent('Your renewed Food Safety License (expires June 1, 2099) is waiting for review. Your current document stays valid until it expires.');
  });

  it('shows why the last renewal was not accepted', () => {
    render(<RenewAccessDocuments applicationId={5} renewals={[{ key: 'foodSafetyLicense', status: 'rejected', rejectionReason: 'The photo is blurry.' }]} onRenewed={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent('was not accepted: The photo is blurry.');
  });

  it('shows nothing extra when nothing was submitted', () => {
    render(<RenewAccessDocuments applicationId={5} onRenewed={() => {}} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
