import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DocumentVerification } from "@shared/schema";
import { 
  CheckCircle, 
  Clock, 
  XCircle, 
  FileText, 
  AlertCircle,
  BadgeCheck,
  ExternalLink
} from "lucide-react";
import { motion } from "framer-motion";

interface DocumentStatusProps {
  showUploadPrompt?: boolean;
  onUploadClick?: () => void;
}

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'approved':
      return <CheckCircle className="h-4 w-4 text-green-600" />;
    case 'rejected':
      return <XCircle className="h-4 w-4 text-red-600" />;
    case 'pending':
    default:
      return <Clock className="h-4 w-4 text-yellow-600" />;
  }
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'approved':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'rejected':
      return 'bg-red-100 text-red-800 border-red-200';
    case 'pending':
    default:
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
  }
};

const formatStatus = (status: string) => {
  switch (status) {
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    case 'pending':
    default:
      return 'Under Review';
  }
};

export default function DocumentStatus({ showUploadPrompt = true, onUploadClick }: DocumentStatusProps) {
  const { user } = useAuth();

  const { data: verification, isLoading, error } = useQuery<DocumentVerification>({
    queryKey: ["/api/document-verification/my-status"],
    queryFn: async ({ queryKey }) => {
      const headers: Record<string, string> = {};
      if (user?.id) {
        headers['X-User-ID'] = user.id.toString();
      }

      const response = await apiRequest("GET", queryKey[0] as string, undefined, headers);
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("NO_DOCUMENTS");
        }
        throw new Error("Failed to fetch verification status");
      }
      return response.json();
    },
    enabled: !!user,
    retry: (failureCount, error) => {
      // Don't retry if no documents found
      if (error.message === "NO_DOCUMENTS") {
        return false;
      }
      return failureCount < 3;
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error?.message === "NO_DOCUMENTS") {
    if (!showUploadPrompt) return null;
    
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Alert>
          <FileText className="h-4 w-4" />
          <AlertDescription>
            <div className="flex items-center justify-between">
              <span>Upload your documents to get verified and unlock all features.</span>
              {onUploadClick && (
                <button
                  onClick={onUploadClick}
                  className="ml-4 text-primary underline hover:no-underline"
                >
                  Upload Documents
                </button>
              )}
            </div>
          </AlertDescription>
        </Alert>
      </motion.div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Failed to load verification status. Please try again later.
        </AlertDescription>
      </Alert>
    );
  }

  if (!verification) return null;

  const isFullyVerified = verification.foodSafetyLicenseStatus === 'approved' && 
                         (verification.foodEstablishmentCertStatus === 'approved' || 
                          !verification.foodEstablishmentCertUrl);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Document Verification Status
            {isFullyVerified && (
              <Badge className="bg-green-100 text-green-800 border-green-200">
                <BadgeCheck className="h-3 w-3 mr-1" />
                Verified
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Track the verification status of your uploaded documents.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isFullyVerified && (
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                🎉 Congratulations! You are now verified and can access all platform features.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-4">
            {/* Food Safety License Status */}
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex items-center gap-3">
                {getStatusIcon(verification.foodSafetyLicenseStatus || 'pending')}
                <div>
                  <h4 className="font-medium">Food Safety License</h4>
                  <p className="text-sm text-muted-foreground">Required for verification</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge 
                  variant="outline" 
                  className={getStatusColor(verification.foodSafetyLicenseStatus || 'pending')}
                >
                  {formatStatus(verification.foodSafetyLicenseStatus || 'pending')}
                </Badge>
                {verification.foodSafetyLicenseUrl && (
                  <a
                    href={verification.foodSafetyLicenseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:text-primary/80"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            </div>

            {/* Food Establishment Certificate Status */}
            {verification.foodEstablishmentCertUrl && (
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-3">
                  {getStatusIcon(verification.foodEstablishmentCertStatus || 'pending')}
                  <div>
                    <h4 className="font-medium">Food Establishment Certificate</h4>
                    <p className="text-sm text-muted-foreground">Optional but recommended</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge 
                    variant="outline" 
                    className={getStatusColor(verification.foodEstablishmentCertStatus || 'pending')}
                  >
                    {formatStatus(verification.foodEstablishmentCertStatus || 'pending')}
                  </Badge>
                  <a
                    href={verification.foodEstablishmentCertUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:text-primary/80"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              </div>
            )}
          </div>

          {verification.adminFeedback && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>Admin Feedback:</strong> {verification.adminFeedback}
              </AlertDescription>
            </Alert>
          )}

          {verification.reviewedAt && (
            <p className="text-sm text-muted-foreground">
              Last reviewed: {new Date(verification.reviewedAt).toLocaleDateString()}
            </p>
          )}

          {!isFullyVerified && (
            <Alert>
              <Clock className="h-4 w-4" />
              <AlertDescription>
                Your documents are being reviewed. We'll notify you once the verification is complete.
                This usually takes 2-3 business days.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
} 