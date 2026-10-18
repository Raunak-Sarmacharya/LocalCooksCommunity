import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/api', () => ({ apiClient: {} }));
vi.mock('react-i18next', async original => ({ ...await original<object>(), useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
vi.mock('@/components/ui/date-field', () => ({ DateField: (props: any) => <input type="date" aria-label={props['aria-label']} value={props.value} onChange={event => props.onChange(event.target.value)} /> }));
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: any) => <select aria-label="Status" value={value} onChange={event => onValueChange(event.target.value)}>{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null, SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));
vi.mock('@/components/booking/DamageClaimCards', () => ({ DamageClaimCard: ({ claim, onChanged }: any) => <button onClick={onChanged}>Claim {claim.id}</button> }));
vi.mock('@/lib/damage-claims', async original => ({ ...await original<object>(), claimRequest: vi.fn() }));
import { claimRequest, type DamageClaimCardData } from '@/lib/damage-claims';
import { DamageClaimQueue } from './DamageClaimQueue';

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const claim = (id: number, status: string, day: string, extra = {}) => ({ id, status, createdAt: `${day}T12:00:00Z`,
  claimedAmountCents: 10000, amountCents: 6000, kitchenPaid: false, ...extra } as DamageClaimCardData);
function mount(claims: DamageClaimCardData[]) {
  vi.mocked(claimRequest).mockResolvedValue({ claims });
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DamageClaimQueue /></QueryClientProvider>);
}

it('totals shown claims, counts confirmed kitchen payments, and keeps open and closed groups', async () => {
  mount([claim(1, 'submitted', '2026-10-01'), claim(2, 'charge_succeeded', '2026-10-02', { kitchenPaid: true }),
    claim(3, 'rejected', '2026-10-03'), claim(4, 'charge_succeeded', '2026-10-04', { kitchenPaymentPending: true })]);
  expect(await screen.findByText('Claim 1')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Claimed $400.00 · Collected $60.00 · Still pending $120.00');
  expect(screen.getByTestId('claims-open')).toHaveTextContent('Claim 1');
  expect(screen.getByTestId('claims-closed')).toHaveTextContent('Claim 2');
});

it('combines inclusive filed dates and status, recalculates totals, and clears filters', async () => {
  mount([claim(1, 'submitted', '2026-10-01'), claim(2, 'charge_succeeded', '2026-10-02', { kitchenPaid: true }), claim(3, 'submitted', '2026-10-03')]);
  await screen.findByText('Claim 1');
  fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-02' } });
  fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-10-02' } });
  expect(screen.queryByText('Claim 1')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Claimed $100.00 · Collected $60.00 · Still pending $0.00');
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'submitted' } });
  expect(screen.getByText('No claims match these filters.')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Claimed $0.00 · Collected $0.00 · Still pending $0.00');
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(screen.getByText('Claim 1')).toBeInTheDocument();
  expect(screen.getByText('Claim 3')).toBeInTheDocument();
});
