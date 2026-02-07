/**
 * Hook to check if chef has outstanding dues (overstay penalties + damage claims)
 * Used to block booking/checkout operations
 * 
 * Derives from useOutstandingDues to share the same query cache entry.
 * Keeps the same exported API so all existing consumers work without changes.
 */

import { toast } from "sonner";
import { useOutstandingDues } from "@/hooks/use-outstanding-dues";

interface PenaltyCheckResult {
  hasUnpaidPenalties: boolean;
  totalCount: number;
  totalOwedCents: number;
}

export function useUnpaidPenaltiesCheck(enabled = true) {
  const query = useOutstandingDues(enabled);

  // Derive simplified result from the shared query
  const data: PenaltyCheckResult | null = query.data?.hasOutstandingDues
    ? {
        hasUnpaidPenalties: true,
        totalCount: query.data.totalCount,
        totalOwedCents: query.data.totalOwedCents,
      }
    : null;

  return { ...query, data };
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
        `You have ${penaltyData.totalCount} unpaid charge(s) totaling $${totalOwed}. Please settle your outstanding balance before making new bookings.`,
        {
          duration: 5000,
          action: {
            label: 'View Details',
            onClick: () => {
              window.location.href = '/dashboard?view=overview';
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
