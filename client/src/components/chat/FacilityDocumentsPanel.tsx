import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Paperclip, Loader2, Eye, Send, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { auth } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';

interface FacilityDocument {
  id: string;
  name: string;
  url: string;
  type: 'floor_plans' | 'ventilation_specs';
  description?: string;
}

interface FacilityDocumentsPanelProps {
  locationId: number;
  onAttachDocument: (document: FacilityDocument) => void;
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

export default function FacilityDocumentsPanel({ locationId, onAttachDocument }: FacilityDocumentsPanelProps) {
  const { toast } = useToast();
  const [isExpanded, setIsExpanded] = useState(false);

  // Fetch facility documents for this location
  const { data: facilityDocuments = [], isLoading, error } = useQuery({
    queryKey: [`/api/manager/locations/${locationId}/requirements`],
    queryFn: async () => {
      try {
        const headers = await getAuthHeaders();
        const response = await fetch(`/api/manager/locations/${locationId}/requirements`, {
          credentials: 'include',
          headers,
        });
        if (!response.ok) throw new Error('Failed to fetch facility documents');
        const data = await response.json();

        // Ensure data is an object
        if (!data || typeof data !== 'object') {
          console.warn('Unexpected API response format:', data);
          return [];
        }

        // Transform the data into our document format
        const documents: FacilityDocument[] = [];

        if (data.floor_plans_url) {
          documents.push({
            id: 'floor_plans',
            name: 'Floor Plans',
            url: data.floor_plans_url,
            type: 'floor_plans',
            description: 'Kitchen layout and floor plans',
          });
        }

        if (data.ventilation_specs_url) {
          documents.push({
            id: 'ventilation_specs',
            name: 'Ventilation Specifications',
            url: data.ventilation_specs_url,
            type: 'ventilation_specs',
            description: data.ventilation_specs || 'Ventilation system specifications and details',
          });
        }

        return documents;
      } catch (error) {
        console.error('Error fetching facility documents:', error);
        return [];
      }
    },
    enabled: !!locationId,
  });

  const handleViewDocument = (document: FacilityDocument) => {
    window.open(document.url, '_blank');
  };

  const handleAttachDocument = (document: FacilityDocument) => {
    onAttachDocument(document);
    toast({
      title: "Document attached",
      description: `${document.name} has been attached to your message.`,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
        <span className="ml-2 text-sm text-gray-500">Loading facility documents...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-4">
        <p className="text-sm text-red-600">Failed to load facility documents</p>
      </div>
    );
  }

  if (!Array.isArray(facilityDocuments) || facilityDocuments.length === 0) {
    return (
      <div className="text-center py-4">
        <p className="text-sm text-gray-500">No facility documents available</p>
        <p className="text-xs text-gray-400 mt-1">
          Upload floor plans and ventilation specs in your location settings
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between w-full text-left hover:bg-gray-50 rounded-md px-2 py-1 -mx-2 transition-colors"
      >
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-gray-600" />
          <span className="text-sm font-medium text-gray-900">Facility Documents</span>
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            {facilityDocuments.length}
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-gray-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-gray-400" />
        )}
      </button>

      {isExpanded && (
        <div className="space-y-2 mt-3">
          {facilityDocuments.map((document) => (
            <Card key={document.id} className="border border-gray-200 hover:border-blue-300 transition-colors">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Paperclip className="h-3 w-3 text-gray-400" />
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {document.name}
                      </span>
                    </div>
                    {document.description && (
                      <p className="text-xs text-gray-500 truncate">
                        {document.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleViewDocument(document)}
                      className="h-7 px-2 text-xs"
                    >
                      <Eye className="h-3 w-3 mr-1" />
                      View
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleAttachDocument(document)}
                      className="h-7 px-2 text-xs bg-blue-50 hover:bg-blue-100 text-blue-700"
                    >
                      <Send className="h-3 w-3 mr-1" />
                      Attach
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}