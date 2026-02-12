import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  CheckCircle,
  Clock,
  FileText,
  Shield,
  ArrowRight,
} from "lucide-react";
import DocumentUpload from "@/components/document-verification/DocumentUpload";

interface DocumentVerificationData {
  foodSafetyLicenseUrl?: string | null;
  foodEstablishmentCertUrl?: string | null;
  foodSafetyLicenseStatus?: string | null;
  foodEstablishmentCertStatus?: string | null;
}

interface DocumentVerificationViewProps {
  documentVerification: DocumentVerificationData | null | undefined;
  onBack: () => void;
}

export default function DocumentVerificationView({
  documentVerification,
  onBack,
}: DocumentVerificationViewProps) {
  // Check if documents are actually uploaded and pending review
  const hasUploadedDocuments = documentVerification?.foodSafetyLicenseUrl || documentVerification?.foodEstablishmentCertUrl;
  const documentsArePending = hasUploadedDocuments && documentVerification?.foodSafetyLicenseStatus === 'pending';

  return (
    <div className="space-y-6">
      {/* Header with Back Button */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon"
            onClick={onBack}
            className="rounded-xl"
          >
            <ArrowRight className="h-5 w-5 rotate-180" />
          </Button>
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-sm">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-foreground">Document Verification</h2>
            <p className="text-muted-foreground mt-1">Upload and manage your chef certificates</p>
          </div>
        </div>
      </div>

      {/* Document Verification Status Overview */}
      <Card className="border-0 shadow-lg overflow-hidden">
        <div className="h-1.5 w-full bg-gradient-to-r from-primary via-amber-500 to-green-500" />
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" />
                Verification Status
              </CardTitle>
              <CardDescription>Track your document verification progress</CardDescription>
            </div>
            {documentVerification && (
              <Badge 
                variant={
                  documentVerification.foodSafetyLicenseStatus === 'approved' ? 'default' :
                  documentVerification.foodSafetyLicenseStatus === 'pending' ? 'secondary' :
                  'destructive'
                }
                className="text-xs"
              >
                {documentVerification.foodSafetyLicenseStatus === 'approved' ? 'Verified' :
                 documentVerification.foodSafetyLicenseStatus === 'pending' ? 'Under Review' :
                 documentVerification.foodSafetyLicenseStatus === 'rejected' ? 'Needs Attention' :
                 'Not Started'}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* Progress Steps */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex flex-col items-center gap-2 flex-1">
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold",
                documentVerification?.foodSafetyLicenseUrl ? "bg-green-500 text-white" : "bg-primary/10 text-primary"
              )}>
                {documentVerification?.foodSafetyLicenseUrl ? <CheckCircle className="h-5 w-5" /> : "1"}
              </div>
              <span className="text-xs text-center text-muted-foreground">Upload</span>
            </div>
            <div className="flex-1 h-0.5 bg-gradient-to-r from-green-500 to-amber-400 mx-2" />
            <div className="flex flex-col items-center gap-2 flex-1">
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold",
                documentVerification?.foodSafetyLicenseStatus === 'approved' ? "bg-green-500 text-white" :
                documentVerification?.foodSafetyLicenseStatus === 'pending' ? "bg-amber-100 border-2 border-amber-400 text-amber-600" :
                "bg-muted text-muted-foreground"
              )}>
                {documentVerification?.foodSafetyLicenseStatus === 'approved' ? <CheckCircle className="h-5 w-5" /> : "2"}
              </div>
              <span className="text-xs text-center text-muted-foreground">Review</span>
            </div>
            <div className={cn(
              "flex-1 h-0.5 mx-2",
              documentVerification?.foodSafetyLicenseStatus === 'approved' ? "bg-gradient-to-r from-amber-400 to-green-500" : "bg-border"
            )} />
            <div className="flex flex-col items-center gap-2 flex-1">
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold",
                documentVerification?.foodSafetyLicenseStatus === 'approved' ? "bg-green-500 text-white" : "bg-muted text-muted-foreground"
              )}>
                {documentVerification?.foodSafetyLicenseStatus === 'approved' ? <CheckCircle className="h-5 w-5" /> : "3"}
              </div>
              <span className="text-xs text-center text-muted-foreground">Verified</span>
            </div>
          </div>

          <p className="text-sm text-muted-foreground text-center">
            Verification typically takes 1-3 business days. You'll receive email notifications at each step.
          </p>
        </CardContent>
      </Card>

      {/* Documents Under Review Notice */}
      {documentsArePending && (
        <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 flex items-start gap-3">
          <Clock className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">Documents Under Review</p>
            <p className="text-sm text-amber-700 mt-1">
              We're currently reviewing your submitted documents. You'll receive an email notification once the review is complete.
              Until then, you have full access to your dashboard.
            </p>
            <p className="text-sm text-amber-600 mt-2">
              You can still update or replace your documents below if needed.
            </p>
          </div>
        </div>
      )}

      {/* Documents Not Uploaded Notice */}
      {!hasUploadedDocuments && (
        <div className="p-4 bg-blue-50 rounded-xl border border-blue-200 flex items-start gap-3">
          <FileText className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-blue-800">Documents Required</p>
            <p className="text-sm text-blue-700 mt-1">
              Please upload your Food Safety License to complete your verification. This is required before you can start selling on LocalCooks.
            </p>
          </div>
        </div>
      )}

      {/* Document Upload Component */}
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <CardTitle className="text-lg">Required Documents</CardTitle>
          <CardDescription>Upload your food safety certifications to complete verification</CardDescription>
        </CardHeader>
        <CardContent>
          <DocumentUpload forceShowForm={true} />
        </CardContent>
      </Card>
    </div>
  );
}
