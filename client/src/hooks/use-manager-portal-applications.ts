import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

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

  const applicationsQuery = useQuery<PortalApplicationForManager[], Error>({
    queryKey: ["/api/manager/portal-applications"],
    queryFn: async () => {
      const response = await fetch("/api/manager/portal-applications", {
        credentials: "include",
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch portal applications");
      }
      
      return await response.json();
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
      const response = await fetch(`/api/manager/portal-applications/${id}/status`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
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
    applications: applicationsQuery.data ?? [],
    isLoading: applicationsQuery.isLoading,
    updateApplicationStatus,
    refetch: applicationsQuery.refetch,
  };
}

