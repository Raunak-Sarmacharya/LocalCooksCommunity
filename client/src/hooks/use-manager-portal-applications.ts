import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { auth } from "@/lib/firebase";

interface PortalApplicationForManager {
  id: number;
  userId: number;
  locationId: number;
  fullName: string;
  email: string;
  phone: string;
  company?: string | null;
  status: 'inReview' | 'approved' | 'rejected' | 'cancelled';
  feedback?: string | null;
  reviewedBy?: number | null;
  reviewedAt?: string | null;
  createdAt: string;
  location: {
    id: number;
    name: string;
    address: string;
  };
  user: {
    id: number;
    username: string;
  };
}

export function useManagerPortalApplications() {
  const queryClient = useQueryClient();

  // Helper to get Firebase token
  const getAuthHeaders = async (): Promise<HeadersInit> => {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    
    const currentFirebaseUser = auth.currentUser;
    if (currentFirebaseUser) {
      try {
        const token = await currentFirebaseUser.getIdToken();
        headers['Authorization'] = `Bearer ${token}`;
      } catch (error) {
        console.error('Error getting Firebase token:', error);
      }
    }
    
    return headers;
  };

  const applicationsQuery = useQuery<{ applications: PortalApplicationForManager[]; accessCount: number }, Error>({
    queryKey: ["/api/manager/portal-applications"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/manager/portal-applications", {
        credentials: "include",
        headers,
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch portal applications");
      }
      
      const data = await response.json();
      // Handle both old format (array) and new format (object with applications and accessCount)
      if (Array.isArray(data)) {
        return { applications: data, accessCount: data.filter((app: PortalApplicationForManager) => app.status === 'approved').length };
      }
      return data;
    },
    refetchInterval: 10000, // Poll every 10 seconds for new applications
  });

  const updateApplicationStatus = useMutation({
    mutationFn: async ({ 
      id, 
      status, 
      feedback 
    }: { 
      id: number; 
      status: 'approved' | 'rejected';
      feedback?: string;
    }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/portal-applications/${id}/status`, {
        method: "PUT",
        headers,
        credentials: "include",
        body: JSON.stringify({ status, feedback }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update application status");
      }
      
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/manager/portal-applications"] });
    },
  });

  return {
    applications: applicationsQuery.data?.applications ?? [],
    accessCount: applicationsQuery.data?.accessCount ?? 0,
    isLoading: applicationsQuery.isLoading,
    updateApplicationStatus,
    refetch: applicationsQuery.refetch,
  };
}

