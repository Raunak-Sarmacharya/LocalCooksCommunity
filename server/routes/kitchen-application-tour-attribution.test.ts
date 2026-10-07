import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ create: vi.fn(), existing: vi.fn(), location: vi.fn(), notify: vi.fn(), email: vi.fn(), upload: vi.fn() }));
vi.mock('../db', () => ({ pool: {}, db: { select: () => {
  const chain: any = { from: () => chain, where: () => chain, limit: () => chain,
    then: (resolve: any) => Promise.resolve([]).then(resolve) }; return chain;
} } }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), requireManager: vi.fn(), requireAdmin: vi.fn() }));
vi.mock('../fileUpload', () => ({ upload: { any: () => vi.fn(), fields: () => vi.fn() }, uploadToBlob: state.upload }));
vi.mock('../phone-utils', () => ({ getChefPhone: async () => '+17095550123' }));
vi.mock('../domains/applications/chef-application.service', () => ({ chefApplicationService: { createApplication: state.create, getChefApplication: state.existing } }));
vi.mock('../domains/locations/location.service', () => ({ LocationService: class {
  getLocationById = state.location;
  async getLocationRequirementsWithDefaults() { return {}; }
} }));
vi.mock('../services/notification.service', () => ({ notificationService: { createForChef: state.notify, createForManager: state.notify } }));
vi.mock('../email', () => ({ sendEmail: state.email, generateKitchenApplicationReceivedChefEmail: () => ({}), getDashboardUrl: () => '' }));
import { kitchenApplicationsRouter } from './firebase/kitchen-applications';
import { DomainError } from '../shared/errors/domain-error';

async function submit(body: Record<string, unknown> = {}, files: any[] = []) {
  const route = (kitchenApplicationsRouter as any).stack.find((entry: any) => entry.route?.path === '/firebase/chef/kitchen-applications' && entry.route?.methods.post).route;
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await route.stack.at(-1).handle({ body: { locationId: '5', fullName: 'Fixture Chef', foodSafetyLicense: 'no', ...body },
    files, neonUser: { id: 3, role: 'chef' }, firebaseUser: { email_verified: true, email: 'fixture@example.test' } }, response);
  return response;
}

beforeEach(() => {
  vi.clearAllMocks(); state.location.mockResolvedValue({ id: 5, name: 'Fixture kitchen' }); state.existing.mockResolvedValue(undefined);
  state.create.mockResolvedValue({ id: 8, chefId: 3, locationId: 5, createdAt: new Date(), updatedAt: new Date(), sourceTourId: 20 });
});

describe('tour attribution at the normal kitchen application submission boundary', () => {
  it.each(['', '-1', '0', '20extra', '20.5', '2147483648', '9007199254740992', [], {}, true])('rejects malformed source %j before uploads or application side effects', async sourceTourId => {
    const response = await submit({ sourceTourId }, [{ fieldname: 'foodSafetyLicenseFile' }]);
    expect(response.status).toHaveBeenCalledWith(400); expect(state.upload).not.toHaveBeenCalled();
    expect(state.location).not.toHaveBeenCalled(); expect(state.create).not.toHaveBeenCalled(); expect(state.notify).not.toHaveBeenCalled(); expect(state.email).not.toHaveBeenCalled();
  });

  it('passes explicit source separately from editable answers through the normal validation flow', async () => {
    const businessDescription = JSON.stringify({ description: 'My edited cooking plans' });
    const response = await submit({ sourceTourId: '20', businessDescription });
    expect(response.status).toHaveBeenCalledWith(201);
    expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ chefId: 3, locationId: 5, businessDescription }), { sourceTourId: 20 });
    expect(state.create.mock.calls[0][0]).not.toHaveProperty('sourceTourId');
  });

  it('returns the source context guard failure without receipt, staff notification or email', async () => {
    state.create.mockRejectedValue(new DomainError('SOURCE_TOUR_NOT_FOUND', 'Tour not found for this kitchen application.', 404));
    const response = await submit({ sourceTourId: '20' });
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({ error: 'Tour not found for this kitchen application.', code: 'SOURCE_TOUR_NOT_FOUND' });
    expect(state.notify).not.toHaveBeenCalled(); expect(state.email).not.toHaveBeenCalled();
  });

  it('still requires the normal certification answer and Step 1 approval for Step 2', async () => {
    expect((await submit({ sourceTourId: '20', foodSafetyLicense: 'notSure' })).status).toHaveBeenCalledWith(400);
    expect((await submit({ sourceTourId: '20', current_tier: '2' })).status).toHaveBeenCalledWith(403);
    expect(state.create).not.toHaveBeenCalled(); expect(state.notify).not.toHaveBeenCalled(); expect(state.email).not.toHaveBeenCalled();
  });
});
