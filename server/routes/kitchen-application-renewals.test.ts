import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  application: {} as any,
  pending: [] as any[],
  submit: vi.fn(), decide: vi.fn(), readRenewals: vi.fn(), updateDocuments: vi.fn(), upload: vi.fn(),
}));
vi.mock('../db', () => ({ pool: {}, db: {} }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), requireManager: vi.fn(), requireAdmin: vi.fn() }));
vi.mock('../fileUpload', () => ({ upload: { any: () => vi.fn(), fields: () => vi.fn() }, uploadToBlob: state.upload }));
vi.mock('../chat-service', () => ({ getAdminDb: vi.fn(), initializeConversation: vi.fn(), initializeSharedConversation: vi.fn(), sendSystemNotification: vi.fn(), notifyTierTransition: vi.fn() }));
vi.mock('../domains/applications/chef-application.service', () => ({ chefApplicationService: {
  getApplicationById: async () => state.application,
  getChefApplications: async () => [state.application],
  updateApplicationDocuments: state.updateDocuments,
} }));
vi.mock('../domains/locations/location.service', () => ({ LocationService: class {
  async getLocationById() { return { id: 46, name: 'Harbour Kitchen', managerId: 371, timezone: 'America/St_Johns' }; }
  async getLocationRequirementsWithDefaults() { return {}; }
} }));
vi.mock('../services/document-renewals', () => ({
  readDocumentRenewals: state.readRenewals, decideDocumentRenewal: state.decide, submitDocumentRenewal: state.submit,
  attachDocumentRenewals: async (applications: any[]) => applications.map(application => ({ ...application, documentRenewals: [] })),
}));
vi.mock('../services/notification.service', () => ({ notificationService: {} }));
vi.mock('../email', () => ({ sendEmail: vi.fn() }));
import { kitchenApplicationsRouter } from './firebase/kitchen-applications';
import { DomainError } from '../shared/errors/domain-error';

const find = (path: string) => (kitchenApplicationsRouter as any).stack.find((entry: any) => entry.route?.path === path && entry.route?.methods.patch).route;
const respond = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });
const review = async (path: string, body: object, role: 'manager' | 'admin') => {
  const res = respond();
  await find(path).stack.at(-1).handle({ params: { id: '57' }, body, neonUser: { id: 371, role } }, res);
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
  state.application = { id: 57, chefId: 22, locationId: 46, status: 'approved', current_tier: 3, tier2_completed_at: '2026-10-09', chat_conversation_id: null,
    foodSafetyLicenseUrl: '/current.pdf', foodSafetyLicenseStatus: 'approved', foodSafetyLicenseExpiry: '2099-01-01' };
  state.readRenewals.mockResolvedValue([{ key: 'foodSafetyLicense', status: 'pending', applicationId: 57 }]);
  state.decide.mockResolvedValue({ decision: 'approved' });
  state.updateDocuments.mockResolvedValue(state.application);
  state.upload.mockResolvedValue('/renewed.pdf');
});

describe.each([['manager', '/manager/kitchen-applications/:id/verify-documents'], ['admin', '/firebase/admin/kitchen-applications/:id/verify-documents']] as const)('%s reviewing a pending renewal', (role, path) => {
  it('approves the renewal instead of re-reviewing the current document', async () => {
    const res = await review(path, { foodSafetyLicenseStatus: 'approved' }, role);
    expect(state.decide).toHaveBeenCalledWith(expect.objectContaining({ applicationId: 57, key: 'foodSafetyLicense', decision: 'approved', reviewer: role === 'admin' ? 'local_cooks' : 'manager' }));
    expect(state.updateDocuments).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, renewed: ['foodSafetyLicense'] }));
  });

  it('passes the rejection reason through and returns the service\'s status when the reason is missing', async () => {
    await review(path, { foodSafetyLicenseStatus: 'rejected', rejectionReason: 'Too blurry' }, role);
    expect(state.decide).toHaveBeenCalledWith(expect.objectContaining({ decision: 'rejected', reason: 'Too blurry' }));
    state.decide.mockRejectedValueOnce(new DomainError('REASON_REQUIRED', 'Please tell the chef why.', 400));
    const res = await review(path, { foodSafetyLicenseStatus: 'rejected' }, role);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Please tell the chef why.' });
  });

  it('reviews the current document as before when no renewal is waiting', async () => {
    state.readRenewals.mockResolvedValue([]);
    const res = await review(path, { foodSafetyLicenseStatus: 'approved' }, role);
    expect(state.decide).not.toHaveBeenCalled();
    expect(state.updateDocuments).toHaveBeenCalledWith(expect.objectContaining({ id: 57, foodSafetyLicenseStatus: 'approved' }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

describe('chef uploading a replacement document', () => {
  const upload = async () => {
    const res = respond();
    await find('/firebase/chef/kitchen-applications/:id/documents').stack.at(-1).handle({
      params: { id: '57' }, body: { foodSafetyLicenseExpiry: '2099-06-01' }, neonUser: { id: 22 },
      files: [{ fieldname: 'foodSafetyLicenseFile', originalname: 'cert.pdf' }],
    }, res);
    return res;
  };

  it('puts an early renewal in its own slot and leaves the approved document untouched', async () => {
    state.submit.mockResolvedValue(true);
    const res = await upload();
    expect(state.submit).toHaveBeenCalledWith({ applicationId: 57, key: 'foodSafetyLicense', url: '/renewed.pdf', expiry: '2099-06-01' });
    expect(state.updateDocuments).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, renewalsQueued: ['foodSafetyLicense'], message: expect.stringContaining('stays valid until it expires') }));
  });

  it('falls back to the single document slot until migration 0074 is applied', async () => {
    state.submit.mockResolvedValue(false);
    await upload();
    expect(state.updateDocuments).toHaveBeenCalledWith(expect.objectContaining({ id: 57, foodSafetyLicenseUrl: '/renewed.pdf', foodSafetyLicenseStatus: 'pending' }));
  });

  it('overwrites the slot (no renewal) when no approved document is on file yet', async () => {
    state.application.foodSafetyLicenseStatus = 'pending';
    await upload();
    expect(state.submit).not.toHaveBeenCalled();
    expect(state.updateDocuments).toHaveBeenCalledWith(expect.objectContaining({ foodSafetyLicenseStatus: 'pending' }));
  });
});
