/**
 * Hook to check if chef has unpaid overstay penalties
 * Used to block booking/checkout operations
 */

import { useQuery } from "@tanstack/react-query";
import { auth } from "@/lib/firebase";
import { toast } from "sonner";

interface UnpaidPenalty {
  overstayId: number;
  storageName: string;
  kitchenName: string;
  daysOverdue: number;
  status: string;
  penaltyAmountCents: number;
  requiresImmediatePayment: boolean;
}

interface PenaltyCheckResult {
  hasUnpaidPenalties: boolean;
  totalCount: number;
  totalOwedCents: number;
  items: UnpaidPenalty[];
  canPayNow: boolean;
  payNowItems: Array<{
    overstayId: number;
    storageName: string;
    penaltyAmount: string;
  }>;
}

async function getAuthHeaders(): Promise<HeadersInit> {
  try {
    const currentUser = auth.currentUser;
    if (currentUser) {
      const token = await currentUser.getIdToken();
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      };
    }
  } catch (error) {
    console.error('Error getting Firebase token:', error);
  }
  return {
    'Content-Type': 'application/json',
  };
}

export function useUnpaidPenaltiesCheck(enabled = true) {
  return useQuery<PenaltyCheckResult | null>({
    queryKey: ['chef-unpaid-penalties-check'],
    queryFn: async () => {
      // Use the existing endpoint but handle the 403 error specially
      const headers = await getAuthHeaders();
      const response = await fetch('/api/chef/overstay-penalties', {
        headers,
        credentials: 'include',
      });
      
      // If we get a 403 with penalty data, the chef has unpaid penalties
      if (response.status === 403) {
        const data = await response.json();
        if (data.code === 'UNPAID_OVERSTAY_PENALTIES') {
          return {
            hasUnpaidPenalties: true,
            totalCount: data.penalties?.totalCount || 0,
            totalOwedCents: data.penalties?.totalOwedCents || 0,
            items: data.penalties?.items || [],
            canPayNow: data.penalties?.canPayNow || false,
            payNowItems: data.penalties?.payNowItems || [],
          };
        }
        throw new Error(data.error || 'Access denied');
      }
      
      if (!response.ok) {
        throw new Error('Failed to check penalty status');
      }
      
      // No penalties - return null
      return null;
    },
    enabled,
    staleTime: 60000, // Cache for 1 minute
    retry: false,
  });
}

export function useBlockIfPenalties() {
  const { data: penaltyData, isLoading } = useUnpaidPenaltiesCheck();
  
  const checkAndBlock = (): boolean => {
    if (isLoading) {
      toast.info('Checking account status...');
      return true; // Block while loading
    }
    
    if (penaltyData?.hasUnpaidPenalties) {
      const totalOwed = (penaltyData.totalOwedCents / 100).toFixed(2);
      toast.error(
        `You have ${penaltyData.totalCount} unpaid penalty(ies) totaling $${totalOwed}. Please resolve these before making new bookings.`,
        {
          duration: 5000,
          action: {
            label: 'View Penalties',
            onClick: () => {
              window.location.href = '/dashboard?tab=penalties';
            },
          },
        }
      );
      return true; // Block
    }
    
    return false; // Don't block
  };
  
  return { checkAndBlock, penaltyData, isLoading };
}
