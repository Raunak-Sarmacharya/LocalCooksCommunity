import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { auth } from '@/lib/firebase';
import { getAllConversations } from '@/services/chat-service';
import type { CustomerFilter, CustomerListResponse, CustomerNote, CustomerPageData, CustomerSort } from './customer-types';

export class CustomersRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const response = await fetch(path, {
    ...init, credentials: 'include', cache: 'no-store',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new CustomersRequestError(data?.error || response.statusText || 'Request failed', response.status);
  return data as T;
}

export type CustomerListParams = { location: string; status: CustomerFilter; q: string; sort: CustomerSort };

export const customersKey = ['/api/manager/customers'] as const;

export function useCustomerList(params: CustomerListParams) {
  return useInfiniteQuery({
    queryKey: [...customersKey, 'list', params],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams({ status: params.status, sort: params.sort });
      if (params.location !== 'all') query.set('locationId', params.location);
      if (params.q.trim()) query.set('q', params.q.trim());
      if (pageParam) query.set('cursor', pageParam);
      return request<CustomerListResponse>(`/api/manager/customers?${query}`);
    },
    getNextPageParam: last => last.nextCursor ?? undefined,
    staleTime: 30_000,
    retry: (count, error) => !(error instanceof CustomersRequestError && error.status < 500) && count < 2,
  });
}

/**
 * Unread counts come from the one conversations call the Overview already makes, merged by person × location,
 * so the list never reads chat per row. A failure just means no unread badges.
 */
export function useCustomerUnread(enabled = true) {
  return useQuery({
    queryKey: ['customers-unread-conversations'],
    queryFn: async () => {
      const unread = new Map<string, number>();
      for (const conversation of await getAllConversations(0, 'manager')) {
        const key = `${conversation.chefId}:${conversation.locationId}`;
        unread.set(key, (unread.get(key) ?? 0) + (conversation.unreadManagerCount || 0));
      }
      return unread;
    },
    enabled, staleTime: 60_000, retry: false,
  });
}

export function useCustomerPage(chefId: number, locationId: number | undefined, allPast: boolean) {
  return useQuery({
    queryKey: [...customersKey, 'page', chefId, locationId ?? null, allPast],
    queryFn: () => {
      const query = new URLSearchParams();
      if (locationId) query.set('locationId', String(locationId));
      if (allPast) query.set('past', 'all');
      return request<CustomerPageData>(`/api/manager/customers/${chefId}${query.size ? `?${query}` : ''}`);
    },
    staleTime: 15_000,
    retry: (count, error) => !(error instanceof CustomersRequestError && error.status < 500) && count < 2,
  });
}

/** Opens (creating when allowed) the existing person × location conversation; null when messaging is not open yet. */
export async function resolveConversationId(chefId: number, locationId: number): Promise<string | null> {
  try {
    const conversation = await request<{ conversationId?: string; id?: string }>(`/api/firebase/chat/locations/${locationId}/chefs/${chefId}/conversation`);
    return conversation.conversationId ?? conversation.id ?? null;
  } catch (error) {
    if (error instanceof CustomersRequestError && error.status === 404) return null;
    throw error;
  }
}

export function useCustomerNotes(chefId: number, locationId: number) {
  const queryClient = useQueryClient();
  const key = [...customersKey, 'notes', chefId, locationId];
  const base = `/api/manager/customers/${chefId}/notes`;
  const query = useQuery({ queryKey: key, queryFn: async () => (await request<{ notes: CustomerNote[] }>(`${base}?locationId=${locationId}`)).notes, staleTime: 15_000 });
  const store = (result: { notes: CustomerNote[] }) => { queryClient.setQueryData(key, result.notes); };
  const add = useMutation({ mutationFn: (body: string) => request<{ notes: CustomerNote[] }>(`${base}?locationId=${locationId}`, { method: 'POST', body: JSON.stringify({ body }) }), onSuccess: store });
  const edit = useMutation({ mutationFn: ({ id, body }: { id: number; body: string }) => request<{ notes: CustomerNote[] }>(`${base}/${id}?locationId=${locationId}`, { method: 'PATCH', body: JSON.stringify({ body }) }), onSuccess: store });
  const remove = useMutation({ mutationFn: (id: number) => request<{ notes: CustomerNote[] }>(`${base}/${id}?locationId=${locationId}`, { method: 'DELETE' }), onSuccess: store });
  return { query, add, edit, remove };
}

/** The existing atomic revoke: one request that ends access, writes the reason and queues the customer's notice. */
export function useRevokeCustomerAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ chefId, locationId, reason }: { chefId: number; locationId: number; reason: string }) =>
      request<{ success: boolean }>('/api/manager/chef-location-access', { method: 'DELETE', body: JSON.stringify({ chefId, locationId, reason }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: customersKey });
      void queryClient.invalidateQueries({ queryKey: ['/api/manager/kitchen-applications'] });
    },
  });
}
