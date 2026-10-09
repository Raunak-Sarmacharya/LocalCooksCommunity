import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AdminUserManagement } from './AdminUserManagement';
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: null } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/hooks/use-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
let cleanupPending = false;
let showAdmin = false;
const request = vi.fn(async (url: string, options?: RequestInit) => ({
  ok: true,
  json: async () => options?.method === 'PATCH' ? { id: 9, adminEmailNotifications: false } : options?.method === 'DELETE' ? {success:true} : url.endsWith('delete-impact')
    ? cleanupPending ? {cleanupPending:true,counts:{}} : {counts:{locations:1,kitchens:2,kitchen_bookings:3,booking_lifecycle_events:4}}
    : {users:[{id:7,username:'manager@fixture.invalid',role:'manager',firebaseUid:'uid',cleanupPending}, ...(showAdmin ? [{id:9,username:'test_admin@localcooks.ca',role:'admin',adminEmailNotifications:true}] : [])]},
}));
beforeEach(() => { cleanupPending=false; showAdmin=false; request.mockClear(); vi.stubGlobal('fetch',request); });

it('lets admins save email eligibility without exposing the control for managers', async () => {
  showAdmin = true;
  render(<AdminUserManagement />);
  const toggle = await screen.findByRole('switch', { name: 'Admin email notifications for test_admin@localcooks.ca' });
  expect(screen.getAllByRole('switch')).toHaveLength(1);
  expect(toggle).toBeChecked();
  fireEvent.click(toggle);
  await waitFor(() => expect(request).toHaveBeenCalledWith('/api/admin/users/9/admin-email-notifications', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ enabled: false }) })));
  await waitFor(() => expect(toggle).not.toBeChecked());
});

it('shows owned locations, kitchens and new dependencies as deletions', async () => {
  render(<AdminUserManagement />);
  fireEvent.click(await screen.findByRole('button',{name:'Complete Delete'}));
  expect(await screen.findByText('Owned locations')).toBeInTheDocument();
  expect(screen.getByText('Owned kitchens')).toBeInTheDocument();
  expect(screen.getByText('Booking lifecycle events')).toBeInTheDocument();
  expect(screen.getByText(/including other users' bookings/)).toBeInTheDocument();
  expect(screen.queryByText(/must be reassigned/)).not.toBeInTheDocument();
});

it('offers a retry for external cleanup after the database user is removed', async () => {
  cleanupPending=true;
  render(<AdminUserManagement />);
  fireEvent.click(await screen.findByRole('button',{name:'Retry Cleanup'}));
  expect(await screen.findByText(/database records are already removed/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Delete Permanently'}));
  await waitFor(() => expect(request).toHaveBeenCalledWith('/api/admin/users/7/complete',expect.objectContaining({method:'DELETE'})));
});
