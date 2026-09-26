import { logger } from "@/lib/logger";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Paperclip, Loader2, Eye, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"

interface FacilityDocument {
  id: string;
  name: string;
  url: string;
  description?: string;
}

interface FacilityDocumentsPanelProps {
  locationId: number;
  applicationId?: number;
  onAttachDocuments: (documents: FacilityDocument[]) => void;
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const currentFirebaseUser = auth.currentUser;
  if (!currentFirebaseUser) {
    throw new Error('Firebase user not available');
  }
  const token = await currentFirebaseUser.getIdToken();
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export default function FacilityDocumentsPanel({ locationId, applicationId, onAttachDocuments }: FacilityDocumentsPanelProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);

  /**
   * The location the chef's application actually belongs to.
   *
   * The conversation carries its own `locationId`, but that copy can be stale
   * or dangling — one thread pointed at a location that no longer existed, so
   * both queries below 403'd and the panel rendered "Failed to load documents"
   * for a chef whose application sat on a perfectly valid location. Resolving
   * from the application is also what keeps the kitchen's facility documents
   * visible for a chef at any tier, not just an approved one.
   */
  const {
    data: applicationLocation,
    isLoading: isLocationLoading,
  } = useQuery<{ locationId: number } | null>({
    queryKey: [`/api/manager/kitchen-applications/${applicationId}/location`],
    enabled: !!applicationId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const response = await fetch(`/api/manager/kitchen-applications/${applicationId}/location`, {
        credentials: 'include',
        headers: await getAuthHeaders(),
      });
      // null (not an error) so the conversation's location is still used as a
      // fallback rather than blanking the panel.
      if (!response.ok) return null;
      return response.json();
    },
  });

  const resolvedLocationId = applicationLocation?.locationId ?? locationId;
  // Hold both queries until the resolution settles, otherwise they briefly fire
  // against the conversation's stale id and flash a failure.
  const locationReady = !applicationId || applicationLocation !== undefined;

  // Fetch facility documents for this location
  const facilityQuery = useQuery<FacilityDocument[]>({
    queryKey: [`/api/manager/locations/${resolvedLocationId}/requirements`],
    queryFn: async () => {
        const headers = await getAuthHeaders();
        const response = await fetch(`/api/manager/locations/${resolvedLocationId}/requirements`, {
          credentials: 'include',
          headers,
        });
        if (!response.ok) throw new Error('Failed to fetch facility documents');
        const data = await response.json();

        if (!data || typeof data !== 'object') return [];

        const documents: FacilityDocument[] = [];
        if (data.floor_plans_url) {
          documents.push({
            id: 'floor_plans',
            name: 'Floor Plans',
            url: data.floor_plans_url,
            description: 'Kitchen layout and floor plans',
          });
        }
        if (data.ventilation_specs_url) {
          documents.push({
            id: 'ventilation_specs',
            name: 'Ventilation Specifications',
            url: data.ventilation_specs_url,
            description: data.ventilation_specs || 'Ventilation system specifications and details',
          });
        }
        if (data.kitchen_terms_url) {
          documents.push({
            id: 'kitchen_terms',
            name: 'Kitchen Terms & Policies',
            url: data.kitchen_terms_url,
            description: 'Kitchen rules, policies, and terms of use',
          });
        }
        if (data.kitchen_license_url) {
          documents.push({
            id: 'kitchen_license',
            name: 'Kitchen License',
            url: data.kitchen_license_url,
            description: 'Official kitchen operating license',
          });
        }
        return documents;
    },
    enabled: locationReady && !!resolvedLocationId,
    refetchInterval: 60_000,
  });

  const applicationQuery = useQuery<FacilityDocument[]>({
    queryKey: ['/api/manager/kitchen-applications/location', resolvedLocationId, applicationId, 'chat-documents'],
    enabled: locationReady && !!resolvedLocationId && !!applicationId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const response = await fetch(`/api/manager/kitchen-applications/location/${resolvedLocationId}`, {
        credentials: 'include',
        headers: await getAuthHeaders(),
      });
      if (!response.ok) throw new Error('Failed to fetch application documents');
      const applications = await response.json();
      const application = Array.isArray(applications)
        ? applications.find((item: { id: number }) => item.id === applicationId)
        : null;
      // This endpoint only returns applications that are already approved or
      // past tier 1, so a chef still waiting on approval is absent *by design*.
      // That is a normal state, not a failure: throwing here replaced the whole
      // panel — including the kitchen's own facility documents — with
      // "Failed to load documents" for every not-yet-approved chef.
      if (!application) return [];
      const documents: FacilityDocument[] = [];
      if (application.foodSafetyLicenseUrl) documents.push({
        id: 'application-food-safety', name: 'Food Safety Certificate',
        url: application.foodSafetyLicenseUrl, description: 'Chef application',
      });
      if (application.foodEstablishmentCertUrl) documents.push({
        id: 'application-food-establishment', name: 'Food Establishment Licence',
        url: application.foodEstablishmentCertUrl, description: 'Chef application',
      });
      const tierFiles = application.tier_data?.tierFiles || {};
      for (const [field, url] of Object.entries(tierFiles)) {
        if (typeof url !== 'string' || !url) continue;
        documents.push({
          id: `application-${field}`,
          name: field === 'tier2_insurance_document' ? 'Insurance document' : field.replace(/^tier\d+_/, '').replaceAll('_', ' '),
          url,
          description: 'Chef application',
        });
      }
      return documents;
    },
  });

  const documents = [...(applicationQuery.data || []), ...(facilityQuery.data || [])];
  const isLoading = isLocationLoading || facilityQuery.isLoading || applicationQuery.isLoading;
  const error = facilityQuery.error || applicationQuery.error;

  const handleViewDocument = async (document: FacilityDocument) => {
    try {
      // Get presigned URL for authenticated access
      const currentUser = auth.currentUser;
      if (!currentUser) {
        toast({
          title: 'Authentication Required',
          description: 'Please log in to view documents.',
          variant: 'destructive',
        });
        return;
      }

      const token = await currentUser.getIdToken();
      const response = await fetch(`/api/files/r2-presigned?url=${encodeURIComponent(document.url)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        window.open(data.url, '_blank');
      } else {
        // Fallback to original URL if presigned URL fails
        window.open(document.url, '_blank');
      }
    } catch (error) {
      logger.error('Error getting presigned URL:', error);
      // Fallback to original URL
      window.open(document.url, '_blank');
    }
  };

  const toggleSelection = (docId: string) => {
    setSelectedDocIds(prev =>
      prev.includes(docId)
        ? prev.filter(id => id !== docId)
        : [...prev, docId]
    );
  };

  const handleAttachSelected = () => {
      const selectedDocs = documents.filter(doc => selectedDocIds.includes(doc.id));
      if (selectedDocs.length > 0) {
          onAttachDocuments(selectedDocs);
          setSelectedDocIds([]);
          toast({
              title: "Documents attached",
              description: `${selectedDocs.length} document(s) attached to message.`,
          });
          setIsOpen(false);
      }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading documents...</span>
      </div>
    );
  }

  // Only the facility query failing is a real outage. The application query
  // legitimately comes back empty for a chef who isn't approved yet, so it must
  // never blank the panel.
  if (facilityQuery.error && documents.length === 0) {
    return <div className="text-center py-4 text-sm text-destructive">Failed to load documents</div>;
  }

  if (!Array.isArray(documents) || documents.length === 0) {
    return (
      <div className="text-center py-4 px-2">
         <p className="text-sm text-muted-foreground">No documents uploaded for this application or kitchen.</p>
      </div>
    );
  }

  const selectedCount = selectedDocIds.length;

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="w-full space-y-2 px-1"
    >
      <div className="flex items-center justify-between space-x-4 px-1 py-1">
        <div className="flex items-center gap-2">
            <div className="bg-primary/10 p-1.5 rounded-md">
                <FileText className="h-4 w-4 text-primary" />
            </div>
            <h4 className="text-sm font-semibold">
                Documents
            </h4>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full border">
                {documents.length}
            </span>
        </div>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-9 p-0 hover:bg-muted">
            <ChevronsUpDown className="h-4 w-4" />
            <span className="sr-only">Toggle</span>
          </Button>
        </CollapsibleTrigger>
      </div>
      
      <CollapsibleContent className="space-y-2">
        {error && <p className="px-2 text-xs text-destructive">Some documents could not be loaded.</p>}
        <div className="rounded-md border px-2 py-2 mt-2 bg-background/50">
            {documents.map((document) => {
             const isSelected = selectedDocIds.includes(document.id);
             return (
              <div 
                key={document.id} 
                className={`
                    relative flex items-start gap-3 p-3 rounded-lg border transition-all cursor-pointer mb-2 last:mb-0
                    ${isSelected ? 'border-primary bg-primary/5' : 'border-border/50 hover:border-border hover:bg-muted/50'}
                `}
                onClick={() => toggleSelection(document.id)}
              >
                <div className={`mt-0.5 h-4 w-4 rounded border flex items-center justify-center transition-colors ${isSelected ? 'bg-primary border-primary' : 'border-muted-foreground'}`}>
                    {isSelected && <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                </div>
                
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium leading-none">{document.name}</span>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 -mt-1 -mr-2 text-muted-foreground hover:text-foreground"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleViewDocument(document);
                            }}
                        >
                            <Eye className="h-4 w-4" />
                        </Button>
                    </div>
                    {document.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                            {document.description}
                        </p>
                    )}
                </div>
              </div>
            );
          })}
          
          <Separator className="my-2" />
          
          <div className="flex justify-end pt-2 pb-4">
              <Button 
                size="sm" 
                onClick={handleAttachSelected}
                disabled={selectedCount === 0}
                className="w-full sm:w-auto"
              >
                 <Paperclip className="h-3.5 w-3.5 mr-2" />
                 Attach {selectedCount > 0 ? `(${selectedCount})` : ''}
              </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
