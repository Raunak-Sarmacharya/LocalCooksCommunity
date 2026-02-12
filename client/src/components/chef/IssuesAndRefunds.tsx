/**
 * Issues & Refunds Component
 * 
 * Combined chef interface for viewing:
 * - Damage claims filed against them
 * - Overstay penalties requiring payment
 */

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, FileText, Clock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { auth } from "@/lib/firebase";

// Import existing components
import { PendingDamageClaims } from "./PendingDamageClaims";
import { OverstayPenaltiesTable } from "./OverstayPenaltiesTable";

interface PendingPenalty {
  overstayId: number;
  isResolved?: boolean;
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

export function IssuesAndRefunds() {
  const [activeTab, setActiveTab] = useState<string>("damage-claims");

  // Fetch damage claims count for badge
  const { data: damageClaimsData } = useQuery({
    queryKey: ['/api/chef/damage-claims'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/chef/damage-claims');
      return response.json();
    },
    refetchInterval: 30000,
  });

  // Fetch overstay penalties count for badge
  const { data: penaltiesData } = useQuery<PendingPenalty[]>({
    queryKey: ['/api/chef/overstay-penalties'],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/chef/overstay-penalties', {
        headers,
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch penalties');
      return response.json();
    },
    refetchInterval: 30000,
  });

  // Count pending items for badges
  const pendingDamageClaims = damageClaimsData?.claims?.filter(
    (c: { status: string }) => c.status === 'submitted'
  )?.length || 0;
  
  const pendingPenalties = penaltiesData?.filter(
    (p: PendingPenalty) => !p.isResolved
  )?.length || 0;

  const totalDamageClaims = damageClaimsData?.claims?.length || 0;
  const totalPenalties = penaltiesData?.length || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
          <AlertTriangle className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Resolution Center</h1>
          <p className="text-sm text-muted-foreground">
            View damage claims and overstay penalties
          </p>
        </div>
      </div>

      {/* Tabs for switching between damage claims and overstay penalties */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 rounded-xl bg-muted p-1 mb-6">
          <TabsTrigger 
            value="damage-claims" 
            className="flex items-center gap-2 rounded-lg data-[state=active]:bg-white"
          >
            <FileText className="h-4 w-4" />
            <span>Damage Claims</span>
            {pendingDamageClaims > 0 && (
              <Badge variant="destructive" className="ml-1">
                {pendingDamageClaims}
              </Badge>
            )}
            {pendingDamageClaims === 0 && totalDamageClaims > 0 && (
              <Badge variant="secondary" className="ml-1">
                {totalDamageClaims}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger 
            value="overstay-penalties" 
            className="flex items-center gap-2 rounded-lg data-[state=active]:bg-white"
          >
            <Clock className="h-4 w-4" />
            <span>Overstay Penalties</span>
            {pendingPenalties > 0 && (
              <Badge variant="destructive" className="ml-1">
                {pendingPenalties}
              </Badge>
            )}
            {pendingPenalties === 0 && totalPenalties > 0 && (
              <Badge variant="secondary" className="ml-1">
                {totalPenalties}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="damage-claims" className="mt-0">
          <PendingDamageClaims />
        </TabsContent>

        <TabsContent value="overstay-penalties" className="mt-0">
          <OverstayPenaltiesTable />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default IssuesAndRefunds;
