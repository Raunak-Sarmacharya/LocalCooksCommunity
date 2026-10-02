vi.mock("./use-manager-dashboard", () => ({useManagerDashboard: () => ({bookings: []})}));
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ failed: false, payments: { hasAccount: true } as {hasAccount?:boolean;requirements?:{currentlyDue?:string[];pastDue?:string[];pendingVerification?:string[]}} }));
vi.mock("@/hooks/use-auth", () => ({ useFirebaseAuth: () => ({ user: { uid: "manager" } }) }));
vi.mock("@/lib/api", () => ({ apiGet: vi.fn() }));
vi.mock("@/services/chat-service", () => ({ getAllConversations: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    data: queryKey[0] === "/api/firebase/user/me" ? { id: 353 } : queryKey[0] === "manager-conversations" ? [
      { locationId: 33, unreadManagerCount: 2 }, { locationId: 34, unreadManagerCount: 5 },
      { locationId: 33, unreadManagerCount: 10, archivedManagerAt: new Date() },
      { locationId: 33, unreadManagerCount: 10, unavailable: true },
    ] : state.payments, isLoading: false, isError: false,
  }),
  useQueries: () => [
    { data: [{ id: 1, locationId: 33 }, { id: 2, locationId: 34 }] },
    { data: [] }, { data: { pendingCheckouts: [] } }, { data: { claims: [] }, isError: state.failed },
    { data: { overstays: [] } }, { data: { bookings: [{ id: 3, kitchenId: 10 }, { id: 4, kitchenId: 11 }] } },
  ],
}));
import { useManagerOverviewActivity } from "./use-manager-overview-activity";
describe("overview activity scope", () => {
  it("scopes operations and unread messages to the selected facility", () => {
    const { result } = renderHook(() => useManagerOverviewActivity(33, [10]));
    expect(result.current.storageBookings.map((row) => row.id)).toEqual([1]);
    expect(result.current.visits.map((row) => row.id)).toEqual([3]);
    expect(result.current.unreadMessages).toBe(2);
  });
  it("keeps all facilities in the account view and reports partial failures", () => {
    state.failed = true;
    const { result } = renderHook(() => useManagerOverviewActivity());
    expect(result.current.storageBookings).toHaveLength(2);
    expect(result.current.unreadMessages).toBe(7);
    expect(result.current.isError).toBe(true);
    state.failed = false;
  });
});

it("does not turn payout verification into manager work",()=>{state.payments={hasAccount:true,requirements:{pendingVerification:["identity"]}};const {result}=renderHook(()=>useManagerOverviewActivity());expect(result.current.paymentsNeedAttention).toBe(false);expect(result.current.paymentsInProgress).toBe(true);state.payments={hasAccount:true};});
it("distinguishes payout setup from required information",()=>{state.payments={hasAccount:false};let hook=renderHook(()=>useManagerOverviewActivity());expect(hook.result.current.paymentsAction).toBe("overviewPaymentsSetup");expect(hook.result.current.paymentsNeedAttention).toBe(true);hook.unmount();state.payments={hasAccount:true,requirements:{currentlyDue:["bank_account"]}};hook=renderHook(()=>useManagerOverviewActivity());expect(hook.result.current.paymentsAction).toBe("overviewPaymentsUpdate");expect(hook.result.current.paymentsNeedAttention).toBe(true);hook.unmount();state.payments={};hook=renderHook(()=>useManagerOverviewActivity());expect(hook.result.current.paymentsNeedAttention).toBe(false);state.payments={hasAccount:true};});
