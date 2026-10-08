import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ user: null as any, job: null as any, docs: {} as Record<string, any>, failPath: '', databaseFailure: false }));
const mocks = vi.hoisted(() => ({ authDelete: vi.fn(), databaseDelete: vi.fn(), recursiveDelete: vi.fn() }));
vi.mock('../../db', () => ({ db: { execute: async (query: any) => {
  const text = new PgDialect().sqlToQuery(query).sql;
  if (text.startsWith('DELETE')) { state.job = null; return { rows: [] }; }
  return { rows: state.job ? [state.job] : [] };
} } }));
vi.mock('./user.service', () => ({ userService: {
  getUser: async () => state.user,
  deleteUser: async () => {
    mocks.databaseDelete();
    if (state.databaseFailure) throw Error('Database constraint failure');
    state.job = { ...state.user, locationIds: [10], cleanupPending: true }; state.user = null;
  },
} }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ deleteUser: mocks.authDelete }) }));
vi.mock('../../firebase-setup', () => ({ initializeFirebaseAdmin: () => ({}) }));
vi.mock('../../chat-service', () => ({ getAdminDb: async () => ({
  collection: (name: string) => ({
    doc: (id: string) => ({ id, path: `${name}/${id}` }),
    where: (field: string, _op: string, value: any) => ({ get: async () => ({ docs:
      Object.entries(state.docs).filter(([key,data]) => key.split('/').length === 2 && key.startsWith(name+'/') && data[field] === value)
        .map(([key,data]) => ({ id: key.split('/')[1], ref: { id:key.split('/')[1], path:key }, data: () => data })),
    }) }),
  }),
  recursiveDelete: async (ref: any) => {
    mocks.recursiveDelete(ref.path);
    if (ref.path === state.failPath) throw Error('Firestore temporarily unavailable');
    for (const key of Object.keys(state.docs)) if (key === ref.path || key.startsWith(ref.path+'/')) delete state.docs[key];
  },
}) }));
import { completeUserDeletion } from './user-deletion-integrations.service';

beforeEach(() => {
  vi.clearAllMocks(); mocks.authDelete.mockResolvedValue(undefined);
  state.user = {id:1,username:'fixture@invalid',role:'manager',firebaseUid:'uid-1'};
  state.job=null; state.failPath=''; state.databaseFailure=false;
  state.docs={
    'conversations/owned':{chefId:3,managerId:1,locationId:10},
    'conversations/owned/messages/a':{text:'removed'},
    'conversations/location':{chefId:4,managerId:2,locationId:10},
    'chatRelationships/owned':{chefId:3,locationId:10,conversationId:'owned'},
    'chatRelationships/orphan':{chefId:4,locationId:10,conversationId:'missing'},
    'chatAttachments/owned':{conversationId:'owned',uploaderId:3},
    'chatAttachments/orphan':{conversationId:'missing',uploaderId:4},
    'users/uid-1':{displayName:'Removed'}, 'users/uid-1/private/a':{data:'removed'},
    'conversations/other':{chefId:7,managerId:2,locationId:20},
  };
});

describe('completeUserDeletion', () => {
  it('removes Firebase, Firestore messages, profiles, mappings and attachment receipts for owned locations', async () => {
    await completeUserDeletion(1,'manager');
    expect(mocks.authDelete).toHaveBeenCalledWith('uid-1');
    expect(state.docs).toEqual({'conversations/other':{chefId:7,managerId:2,locationId:20}});
    expect(state.job).toBeNull();
  });
  it('retains retry context after failure and tolerates already-deleted Firebase identities', async () => {
    state.failPath='conversations/owned';
    await expect(completeUserDeletion(1)).rejects.toThrow('cleanup is pending');
    expect(state.user).toBeNull(); expect(state.job.locationIds).toEqual([10]);
    state.failPath=''; mocks.authDelete.mockRejectedValueOnce({code:'auth/user-not-found'});
    await completeUserDeletion(1,'manager');
    expect(state.job).toBeNull(); expect(mocks.databaseDelete).toHaveBeenCalledTimes(1);
    expect(state.docs).toEqual({'conversations/other':{chefId:7,managerId:2,locationId:20}});
  });
  it('does not touch external systems when database cleanup fails', async () => {
    state.databaseFailure=true;
    await expect(completeUserDeletion(1)).rejects.toThrow('Database constraint');
    expect(mocks.authDelete).not.toHaveBeenCalled(); expect(mocks.recursiveDelete).not.toHaveBeenCalled();
    expect(state.user.id).toBe(1);
  });
  it('enforces the manager role on both first attempts and pending retries', async () => {
    state.user.role='chef';
    await expect(completeUserDeletion(1,'manager')).rejects.toMatchObject({status:400});
    state.job={...state.user,locationIds:[]}; state.user=null;
    await expect(completeUserDeletion(1,'manager')).rejects.toMatchObject({status:400});
    expect(mocks.authDelete).not.toHaveBeenCalled();
  });
});
