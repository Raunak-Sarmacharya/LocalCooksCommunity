import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ before: {} as any, after: {} as any, email: vi.fn(), access: vi.fn(), notify: vi.fn() }));
vi.mock('../db', () => ({ pool: {}, db: {
  select: () => { const chain: any = { from: () => chain, where: () => chain, limit: () => chain, then: (resolve: any) => Promise.resolve([]).then(resolve) }; return chain; },
  insert: () => ({ values: state.access }),
} }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), requireManager: vi.fn(), requireAdmin: vi.fn() }));
vi.mock('../fileUpload', () => ({ upload: { any: () => vi.fn(), fields: () => vi.fn() }, uploadToBlob: vi.fn() }));
vi.mock('../chat-service', () => ({ getAdminDb: vi.fn(), initializeConversation: async () => 'chat-57', initializeSharedConversation: vi.fn(), sendSystemNotification: vi.fn(), notifyTierTransition: vi.fn() }));
vi.mock('../domains/applications/chef-application.service', () => ({ chefApplicationService: {
  getApplicationById: async () => state.before,
  getApplicationsForManager: async () => [state.before],
  updateApplicationStatus: async () => state.after,
  updateApplicationTier: async () => state.after,
} }));
vi.mock('../domains/locations/location.service', () => ({ LocationService: class {
  async getLocationById() { return { id: 46, name: 'Harbour Kitchen', managerId: 371, notificationEmail: 'manager@example.test' }; }
  async getLocationRequirementsWithDefaults() { return {}; }
} }));
vi.mock('../domains/applications/tier-validation', () => ({ tierValidationService: { validateTierRequirements: () => ({ valid: true, missingRequirements: [] }) } }));
vi.mock('../services/notification.service', () => ({ notificationService: { notifyChefApplicationApproved: state.notify, createForManager: state.notify } }));
vi.mock('../email', () => ({
  sendEmail: state.email,
  generateKitchenApplicationSubmittedChefEmail: (data: any) => ({ kind: 'coordination-chef', ...data }),
  generateKitchenApplicationApprovedEmail: (data: any) => ({ kind: 'access-chef', ...data }),
  generateKitchenApplicationClearedManagerEmail: (data: any) => ({ kind: 'coordination-manager', ...data }),
  generateKitchenAccessConfirmedManagerEmail: (data: any) => ({ kind: 'access-manager', ...data }),
}));
import { kitchenApplicationsRouter } from './firebase/kitchen-applications';

beforeEach(() => {
  vi.clearAllMocks();
  state.before = { id: 57, chefId: 22, locationId: 46, fullName: 'Jamie Chef', email: 'chef@example.test', status: 'approved', current_tier: 2, tier2_completed_at: '2026-10-09', chat_conversation_id: 'chat-57' };
  state.after = { ...state.before };
});
async function review(role: 'admin' | 'manager', final = false) {
  const route = (kitchenApplicationsRouter as any).stack.find((entry: any) => entry.route?.path === (role === 'admin' ? '/firebase/admin/kitchen-applications/:id/status' : '/manager/kitchen-applications/:id/status') && entry.route?.methods.patch).route;
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await route.stack.at(-1).handle({ params: { id: '57' }, body: { status: 'approved', ...(final ? { current_tier: 3 } : {}) }, neonUser: { id: 371, role } }, response);
  expect(response.status).not.toHaveBeenCalledWith(500);
  expect(response.json).toHaveBeenCalledWith(role === 'admin' ? state.after : expect.objectContaining({ success: true }));
}

it.each(['admin', 'manager'] as const)('does not confirm or grant access when %s review leaves documents pending', async role => {
  await review(role);
  expect(state.email).not.toHaveBeenCalled();
  expect(state.access).not.toHaveBeenCalled();
});
it.each(['admin', 'manager'] as const)('confirms access for final %s approval with the exact application reference', async role => {
  state.after = { ...state.before, current_tier: 3 };
  await review(role, true);
  expect(state.email).toHaveBeenCalledWith(expect.objectContaining({ kind: 'access-chef', applicationId: 57, conversationId: 'chat-57' }), expect.anything());
  expect(state.access).toHaveBeenCalledWith(expect.objectContaining({ chefId: 22, locationId: 46 }));
  if (role === 'admin') expect(state.email).toHaveBeenCalledWith(expect.objectContaining({ kind: 'access-manager', applicationId: 57 }), expect.anything());
});
it.each(['admin', 'manager'] as const)('does not resend confirmation for an unchanged %s approval', async role => {
  state.before.current_tier = 3; state.after = { ...state.before };
  await review(role);
  expect(state.email).not.toHaveBeenCalled();
});
it('opens coordination and sends the next-action emails after request approval', async () => {
  state.before.status = 'inReview'; state.before.current_tier = 1;
  state.after = { ...state.before, status: 'approved' };
  await review('admin');
  expect(state.email).toHaveBeenCalledWith(expect.objectContaining({ kind: 'coordination-chef', locationId: 46, applicationId: 57, conversationId: 'chat-57' }), expect.anything());
  expect(state.email).toHaveBeenCalledWith(expect.objectContaining({ kind: 'coordination-manager', applicationId: 57, conversationId: 'chat-57' }), expect.anything());
  expect(state.access).not.toHaveBeenCalled();
});
