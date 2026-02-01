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

  const shouldShowUpload = !location.kitchenLicenseUrl ||
    location.kitchenLicenseStatus === "rejected" ||
    location.kitchenLicenseStatus === "expired" ||
    (location.kitchenLicenseStatus === "approved" && isLicenseExpired);

  const handleLicenseUpload = async (file: File, expiryDate: string) => {
    if (!expiryDate || expiryDate.trim() === '') {
      toast({
        title: "Expiration Date Required",
        description: "Please provide an expiration date for the license.",
        variant: "destructive",
      });
      throw new Error("Expiration date is required");
    }

    const expiry = new Date(expiryDate);
    if (isNaN(expiry.getTime())) {
      toast({
        title: "Invalid Date",
        description: "Please provide a valid expiration date.",
        variant: "destructive",
      });
      throw new Error("Invalid expiration date");
    }

    setIsUploadingLicense(true);
    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Firebase user not available");
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
          kitchenLicenseStatus: 'pending',
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
        title: "License Uploaded",
        description: "Your license has been submitted for admin approval.",
      });

      setLicenseFile(null);
      setLicenseExpiryDate('');
      return licenseUrl;
    } catch (error: any) {
      console.error('License upload error:', error);
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload license",
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
      return <Badge variant="outline" className="bg-gray-50 text-gray-600">Not Uploaded</Badge>;
    }
    
    switch (status) {
      case 'approved':
        if (isLicenseExpired) {
          return <Badge variant="destructive" className="bg-red-100 text-red-700">Expired</Badge>;
        }
        if (isExpiryApproaching(location.kitchenLicenseExpiry)) {
          return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Expiring Soon</Badge>;
        }
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Approved</Badge>;
      case 'pending':
        return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Pending Review</Badge>;
      case 'rejected':
        return <Badge variant="destructive" className="bg-red-100 text-red-700">Rejected</Badge>;
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
      case 'rejected':
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <AlertCircle className="h-5 w-5 text-gray-400" />;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Kitchen License</h2>
        <p className="text-muted-foreground">
          Upload and manage your kitchen license document. A valid license is required for bookings.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {getStatusIcon()}
              <div>
                <CardTitle className="text-lg">License Status</CardTitle>
                <CardDescription>Current status of your kitchen license</CardDescription>
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
                >
                  View Document <ExternalLink className="h-3 w-3" />
                </AuthenticatedDocumentLink>
              </div>
              
              {location.kitchenLicenseExpiry && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Expiration Date:</span>
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
                    <strong>Rejection Reason:</strong> {location.kitchenLicenseFeedback}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Upload Section */}
          {shouldShowUpload && (
            <div className="space-y-4">
              <div className="border-t pt-4">
                <h4 className="font-medium text-slate-900 mb-3">
                  {location.kitchenLicenseUrl ? 'Upload New License' : 'Upload License'}
                </h4>
                
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="license-expiry">License Expiration Date</Label>
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
                        {licenseFile ? licenseFile.name : 'Click to upload license'}
                      </span>
                      <span className="text-xs text-gray-500">PDF, JPG or PNG (max 5MB)</span>
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
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Upload className="mr-2 h-4 w-4" />
                          Upload License
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Approved License - No action needed */}
          {location.kitchenLicenseStatus === 'approved' && !isLicenseExpired && !isExpiryApproaching(location.kitchenLicenseExpiry) && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span className="text-sm text-green-700">Your license is valid and approved. No action needed.</span>
            </div>
          )}

          {/* Pending Review */}
          {location.kitchenLicenseStatus === 'pending' && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <Clock className="h-4 w-4 text-amber-600" />
              <span className="text-sm text-amber-700">Your license is pending admin review. You'll be notified once it's approved.</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
