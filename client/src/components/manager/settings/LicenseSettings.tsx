import { logger } from "@/lib/logger";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
/**
 * License Settings Component
 * Manages kitchen license upload and status for a location
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileText, Upload, CheckCircle, Clock, XCircle, AlertCircle, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { auth } from '@/lib/firebase';
import { usePresignedDocumentUrl } from '@/hooks/use-presigned-document-url';

interface Location {
  id: number;
  name: string;
  kitchenLicenseUrl?: string;
  kitchenLicenseStatus?: string;
  kitchenLicenseExpiry?: string;
  kitchenLicenseFeedback?: string;
  kitchenLicenseUploadedAt?: string;
  kitchenLicensePendingUrl?: string;
  kitchenLicensePendingSubmittedAt?: string;
}

interface LicenseSettingsProps {
  location: Location;
  onRefresh: () => void;
}

function AuthenticatedDocumentLink({ url, className, children }: { url: string | null | undefined; className?: string; children: React.ReactNode }) {
  const { url: presignedUrl } = usePresignedDocumentUrl(url);
  
  if (!url) return null;
  
  return (
    <a 
      href={presignedUrl || url} 
      target="_blank" 
      rel="noopener noreferrer"
      className={className}
    >
      {children}
    </a>
  );
}

export default function LicenseSettings({ location, onRefresh }: LicenseSettingsProps) {
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [licenseExpiryDate, setLicenseExpiryDate] = useState<string>(location.kitchenLicenseExpiry || '');
  const [isUploadingLicense, setIsUploadingLicense] = useState(false);

  const getDocumentFilename = (url?: string): string => {
    if (!url) return 'No document';
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = pathname.split('/').pop() || 'kitchen-license';
      return decodeURIComponent(filename);
    } catch {
      const parts = url.split('/');
      return decodeURIComponent(parts[parts.length - 1] || 'kitchen-license');
    }
  };

  const getDaysUntilExpiry = (expiryDate?: string): number | null => {
    if (!expiryDate) return null;
    const expiry = new Date(expiryDate);
    const now = new Date();
    const diffTime = expiry.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const isExpiryApproaching = (expiryDate?: string): boolean => {
    const daysUntil = getDaysUntilExpiry(expiryDate);
    return daysUntil !== null && daysUntil > 0 && daysUntil <= 30;
  };

  const isLicenseExpired = location.kitchenLicenseExpiry
    ? new Date(location.kitchenLicenseExpiry) < new Date()
    : false;

  // Show upload for ALL statuses — managers can always submit or replace their license.
  // pending        → replace in-place (never been approved, no live license to protect)
  // approved       → goes through pending_update review gate
  // pending_update → replace the queued pending update
  // rejected/expired/none → fresh submission
  const shouldShowUpload = true;

  const handleLicenseUpload = async (file: File, expiryDate: string) => {
    if (!expiryDate || expiryDate.trim() === '') {
      toast({ title: mt("expirationDateRequired"),
        description: mt("pleaseProvideAnExpirationDateForTheLicense"),
        variant: "destructive",
      });
      throw new Error(tt("expirationDateRequired"));
    }

    const expiry = new Date(expiryDate);
    if (isNaN(expiry.getTime())) {
      toast({ title: mt("invalidDate"),
        description: mt("pleaseProvideAValidExpirationDate"),
        variant: "destructive",
      });
      throw new Error(tt("invalidExpirationDate"));
    }

    setIsUploadingLicense(true);
    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error(tt("firebaseUserNotAvailable"));
      }

      const token = await currentFirebaseUser.getIdToken();

      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/files/upload-file', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to upload license');
      }

      const result = await response.json();
      const licenseUrl = result.url;

      const updateResponse = await fetch(`/api/manager/locations/${location.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          kitchenLicenseUrl: licenseUrl,
          // Don't set kitchenLicenseStatus - server will set 'pending' for new or 'pending_update' for updates
          kitchenLicenseExpiry: expiryDate,
        }),
      });

      if (!updateResponse.ok) {
        const errorData = await updateResponse.json();
        throw new Error(errorData.error || 'Failed to update license');
      }

      queryClient.invalidateQueries({ queryKey: ['/api/manager/locations'] });
      queryClient.invalidateQueries({ queryKey: ['locationDetails', location.id] });
      onRefresh();

      toast({
        title: location.kitchenLicenseUrl ? mt("licenseUpdateSubmitted") : mt("licenseUploaded"),
        description: location.kitchenLicenseUrl 
          ? mt("licenseUpdatedSubmittedDesc") : mt("licenseSubmittedForApprovalDesc"),
      });

      setLicenseFile(null);
      setLicenseExpiryDate('');
      return licenseUrl;
    } catch (error: any) {
      logger.error('License upload error:', error);
      toast({ title: mt("uploadFailed"),
        description: error.message || tt("failedToUploadLicense"),
        variant: "destructive",
      });
      throw error;
    } finally {
      setIsUploadingLicense(false);
    }
  };

  const getStatusBadge = () => {
    const status = location.kitchenLicenseStatus;
    if (!status || !location.kitchenLicenseUrl) {
      return <Badge variant="outline" className="text-muted-foreground">{mt("notUploaded")}</Badge>;
    }
    
    switch (status) {
      case 'approved':
        if (isLicenseExpired) {
          return <Badge variant="outline" className="text-destructive border-destructive/30">{mt("expired")}</Badge>;
        }
        if (isExpiryApproaching(location.kitchenLicenseExpiry)) {
          return <Badge variant="warning">{mt("expiringSoon")}</Badge>;
        }
        return <Badge variant="success">{mt("approved")}</Badge>;
      case 'pending':
        return <Badge variant="warning">{mt("pendingReview")}</Badge>;
      case 'pending_update':
        return <Badge variant="warning" className="bg-amber-100 text-amber-700 border-amber-200">{mt("updatePending")}</Badge>;
      case 'rejected':
        return <Badge variant="outline" className="text-destructive border-destructive/30">{mt("rejected")}</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getStatusIcon = () => {
    const status = location.kitchenLicenseStatus;
    if (!status || !location.kitchenLicenseUrl) {
      return <AlertCircle className="h-5 w-5 text-gray-400" />;
    }
    
    switch (status) {
      case 'approved':
        if (isLicenseExpired) {
          return <XCircle className="h-5 w-5 text-red-500" />;
        }
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'pending':
        return <Clock className="h-5 w-5 text-amber-500" />;
      case 'pending_update':
        return <Clock className="h-5 w-5 text-amber-500" />;
      case 'rejected':
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <AlertCircle className="h-5 w-5 text-gray-400" />;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{mt("kitchenLicense")}</h2>
        <p className="text-muted-foreground">{mt("uploadAndManageYourKitchenLicenseDocumentAValidLicenseIsRequ")}</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {getStatusIcon()}
              <div>
                <CardTitle className="text-lg">{mt("licenseStatus")}</CardTitle>
                <CardDescription>{mt("currentStatusOfYourKitchenLicense")}</CardDescription>
              </div>
            </div>
            {getStatusBadge()}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Current License Info */}
          {location.kitchenLicenseUrl && (
            <div className="bg-slate-50 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-slate-500" />
                  <span className="text-sm font-medium">{getDocumentFilename(location.kitchenLicenseUrl)}</span>
                </div>
                <AuthenticatedDocumentLink
                  url={location.kitchenLicenseUrl}
                  className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                >{mt("viewDocument")}<ExternalLink className="h-3 w-3" />
                </AuthenticatedDocumentLink>
              </div>
              
              {location.kitchenLicenseExpiry && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">{mt("expirationDate")}</span>
                  <span className={isLicenseExpired ? 'text-red-600 font-medium' : isExpiryApproaching(location.kitchenLicenseExpiry) ? 'text-amber-600 font-medium' : 'text-slate-900'}>
                    {new Date(location.kitchenLicenseExpiry).toLocaleDateString()}
                    {isLicenseExpired && ' (Expired)'}
                    {!isLicenseExpired && isExpiryApproaching(location.kitchenLicenseExpiry) && ` (${getDaysUntilExpiry(location.kitchenLicenseExpiry)} days left)`}
                  </span>
                </div>
              )}

              {location.kitchenLicenseFeedback && location.kitchenLicenseStatus === 'rejected' && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-700">
                    <strong>{mt("rejectionReason")}</strong> {location.kitchenLicenseFeedback}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Pending Update Banner — shown when a new license is awaiting admin review */}
          {location.kitchenLicenseStatus === 'pending_update' && location.kitchenLicensePendingUrl && (
            <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <Clock className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-blue-800">{mt("licenseUpdateAwaitingAdminReview")}</p>
                <p className="text-xs text-blue-700 mt-0.5">{mt("aNewLicenseHasBeenSubmittedYourCurrentLicenseStaysActiveUnti")}</p>
                {location.kitchenLicensePendingSubmittedAt && (
                  <p className="text-xs text-blue-600 mt-1">
                    <span className="font-medium">{mt("submitted")}</span>{' '}
                    {new Date(location.kitchenLicensePendingSubmittedAt).toLocaleDateString()} at{' '}
                    {new Date(location.kitchenLicensePendingSubmittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Upload Section — always shown so managers can submit or replace at any time */}
          {shouldShowUpload && (
            <div className="space-y-4">
              <div className="border-t pt-4">
                {/* Contextual header and hint based on current status */}
                {location.kitchenLicenseStatus === 'pending_update' && (
                  <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-xs text-amber-800">
                      <span className="font-semibold">{mt("replacingYourQueuedUpdate")}</span>{' '}
                      Uploading a new document will replace the currently-pending update — the admin will review your latest submission.
                    </p>
                  </div>
                )}
                {location.kitchenLicenseStatus === 'pending' && location.kitchenLicenseUrl && (
                  <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-xs text-blue-800">
                      <span className="font-semibold">{mt("replaceYourPendingSubmission")}</span>{' '}
                      Since your license hasn't been approved yet, uploading a new document replaces it directly — the admin will review your updated submission.
                    </p>
                  </div>
                )}
                {location.kitchenLicenseStatus === 'approved' && !isLicenseExpired && (
                  <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-xs text-amber-800">
                      <span className="font-semibold">{mt("submittingANewLicense")}</span> will send it for admin review. Your current approved license stays active until the update is approved.
                    </p>
                  </div>
                )}

                <h4 className="font-medium text-slate-900 mb-3">
                  {location.kitchenLicenseStatus === 'pending' && location.kitchenLicenseUrl
                    ? 'Replace Pending Submission'
                    : location.kitchenLicenseStatus === 'pending_update'
                      ? 'Edit uploaded document'
                      : location.kitchenLicenseUrl
                        ? 'Submit Updated License'
                        : 'Upload License'}
                </h4>
                
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="license-expiry">{mt("licenseExpirationDate")}</Label>
                    <Input
                      id="license-expiry"
                      type="date"
                      value={licenseExpiryDate}
                      onChange={(e) => setLicenseExpiryDate(e.target.value)}
                      min={new Date().toISOString().split('T')[0]}
                      className="mt-1.5 max-w-xs"
                    />
                  </div>

                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 hover:border-gray-400 transition-colors">
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setLicenseFile(file);
                        }
                      }}
                      className="hidden"
                      id="license-upload"
                      disabled={isUploadingLicense}
                    />
                    <label
                      htmlFor="license-upload"
                      className={`flex flex-col items-center justify-center cursor-pointer ${isUploadingLicense ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <Upload className="h-8 w-8 text-gray-400 mb-2" />
                      <span className="text-sm font-medium text-gray-700 mb-1">
                        {licenseFile ? licenseFile.name : (
                          location.kitchenLicenseStatus === 'pending' && location.kitchenLicenseUrl
                            ? 'Click to replace pending submission'
                            : location.kitchenLicenseStatus === 'pending_update'
                              ? 'Click to replace queued update'
                              : location.kitchenLicenseUrl
                                ? 'Click to submit updated license'
                                : 'Click to upload license'
                        )}
                      </span>
                      <span className="text-xs text-gray-500">{mt("pDFJPGOrPNGMax5MB")}</span>
                    </label>
                  </div>

                  {licenseFile && (
                    <Button
                      onClick={() => handleLicenseUpload(licenseFile, licenseExpiryDate)}
                      disabled={isUploadingLicense || !licenseExpiryDate}
                      className="w-full"
                    >
                      {isUploadingLicense ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />{mt("uploading")}</>
                      ) : (
                        <>
                          <Upload className="mr-2 h-4 w-4" />
                          {location.kitchenLicenseStatus === 'pending' && location.kitchenLicenseUrl
                            ? 'Replace Pending Submission'
                            : location.kitchenLicenseStatus === 'pending_update'
                              ? 'Edit uploaded document'
                              : location.kitchenLicenseUrl
                                ? 'Submit Updated License'
                                : 'Upload License'}
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Approved License — info message */}
          {location.kitchenLicenseStatus === 'approved' && !isLicenseExpired && !isExpiryApproaching(location.kitchenLicenseExpiry) && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span className="text-sm text-green-700">{mt("yourLicenseIsValidAndApprovedBookingsAreActive")}</span>
            </div>
          )}

          {/* Pending Review */}
          {location.kitchenLicenseStatus === 'pending' && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <Clock className="h-4 w-4 text-amber-600" />
              <span className="text-sm text-amber-700">{mt("yourLicenseIsPendingAdminReviewYouLlBeNotifiedOnceItSApprove")}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
