import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFirebaseAuth } from "./use-auth";

export function useUserSync() {
  const { user } = useFirebaseAuth();
  const queryClient = useQueryClient();

  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!user?.uid) {
        throw new Error('No user to sync');
      }

      const response = await fetch('/api/sync-current-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
        }),
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Sync failed');
      }

      return response.json();
    },
    onSuccess: async (data) => {
      console.log('User sync successful:', data);
      
      // Clear all cached data to force fresh fetch
      queryClient.clear();
      
      // Invalidate specific queries
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['/api/applications/my-applications'] }),
        queryClient.invalidateQueries({ queryKey: ['/api/user'] }),
      ]);
      
      // Force immediate refetch
      setTimeout(() => {
        queryClient.refetchQueries({ queryKey: ['/api/applications/my-applications'] });
      }, 500);
    },
    onError: (error) => {
      console.error('User sync failed:', error);
    }
  });

  return {
    syncUser: syncMutation.mutate,
    isSyncing: syncMutation.isPending,
    syncError: syncMutation.error,
    syncSuccess: syncMutation.isSuccess,
    syncData: syncMutation.data,
  };
} 