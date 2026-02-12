import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import {
  Calendar,
  Check,
  CheckCircle,
  Clock,
  ExternalLink,
  FileText,
  RefreshCw,
  X,
  XCircle,
} from "lucide-react";

export function KitchenLicenseApprovalSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<Record<number, string>>({});
  const [expandedLicense, setExpandedLicense] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("pending");

  const { data: licenses = [], isLoading, refetch } = useQuery({
    queryKey: ['/api/admin/locations/licenses', filterStatus],
    queryFn: async () => {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Firebase user not available");
      }
      const token = await currentFirebaseUser.getIdToken();
      const statusParam = filterStatus === 'all' ? '' : `status=${filterStatus}`;
      const response = await fetch(`/api/admin/locations/licenses?${statusParam}`, {
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error('Failed to fetch licenses');
      }
      return response.json();
    },
    refetchInterval: 30000,
  });

  const approveLicenseMutation = useMutation({
    mutationFn: async ({ locationId, status, feedbackText }: { locationId: number; status: 'approved' | 'rejected'; feedbackText?: string }) => {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Firebase user not available");
      }
      const token = await currentFirebaseUser.getIdToken();
      const response = await fetch(`/api/admin/locations/${locationId}/kitchen-license`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status,
          feedback: feedbackText || null,
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to update license status' }));
        throw new Error(error.error || 'Failed to update license status');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/locations/licenses'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/locations/pending-licenses-count'] });
      refetch();
      toast({
        title: "License Status Updated",
        description: "The license status has been updated successfully.",
      });
      setFeedback({});
      setExpandedLicense(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update license status",
        variant: "destructive",
      });
    },
  });

  const handleApprove = (locationId: number) => {
    const feedbackText = feedback[locationId]?.trim();
    approveLicenseMutation.mutate({ locationId, status: 'approved', feedbackText });
  };

  const handleReject = (locationId: number) => {
    const feedbackText = feedback[locationId]?.trim();
    if (!feedbackText) {
      toast({
        title: "Feedback Required",
        description: "Please provide feedback when rejecting a license.",
        variant: "destructive",
      });
      return;
    }
    approveLicenseMutation.mutate({ locationId, status: 'rejected', feedbackText });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="warning">Pending Review</Badge>;
      case 'approved':
        return <Badge variant="success">Approved</Badge>;
      case 'rejected':
        return <Badge variant="outline" className="text-destructive border-destructive/30">Rejected</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle>Kitchen Licenses</CardTitle>
              <CardDescription>Manage and review kitchen license documents</CardDescription>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Tabs value={filterStatus} onValueChange={setFilterStatus} className="w-full sm:w-auto">
                <TabsList>
                  <TabsTrigger value="pending">Pending</TabsTrigger>
                  <TabsTrigger value="approved">Approved</TabsTrigger>
                  <TabsTrigger value="rejected">Rejected</TabsTrigger>
                  <TabsTrigger value="all">All</TabsTrigger>
                </TabsList>
              </Tabs>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isLoading}
                className="ml-auto sm:ml-0"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-12">
              <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Loading licenses...</p>
            </div>
          ) : licenses.length === 0 ? (
            <div className="text-center py-12 border rounded-lg border-dashed">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Licenses Found</h3>
              <p className="text-muted-foreground">
                No kitchen licenses found with status &ldquo;{filterStatus}&rdquo;.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {licenses.map((license: any) => (
                <Card
                  key={license.id}
                  className={`${
                    license.kitchenLicenseStatus === 'pending'
                      ? 'border-yellow-200'
                      : license.kitchenLicenseStatus === 'rejected'
                        ? 'border-red-200'
                        : ''
                  }`}
                >
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-3">
                          <div
                            className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                              license.kitchenLicenseStatus === 'pending'
                                ? 'bg-yellow-100 text-yellow-600'
                                : license.kitchenLicenseStatus === 'approved'
                                  ? 'bg-green-100 text-green-600'
                                  : license.kitchenLicenseStatus === 'rejected'
                                    ? 'bg-red-100 text-red-600'
                                    : 'bg-muted text-muted-foreground'
                            }`}
                          >
                            <FileText className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="font-semibold text-lg">{license.name}</h4>
                              {getStatusBadge(license.kitchenLicenseStatus)}
                            </div>
                            <p className="text-sm text-muted-foreground">{license.address}</p>
                            {license.managerUsername && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Manager: {license.managerUsername}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* License Document Details */}
                        <div className="mb-4 space-y-2">
                          <div className="flex flex-wrap gap-3">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={async () => {
                                if (!license.kitchenLicenseUrl) {
                                  toast({
                                    title: "No License",
                                    description: "No license document has been uploaded for this location.",
                                    variant: "destructive",
                                  });
                                  return;
                                }

                                try {
                                  const token = await auth.currentUser?.getIdToken();
                                  let viewUrl = license.kitchenLicenseUrl;
                                  
                                  if (viewUrl.includes('/api/files/documents/')) {
                                     if (viewUrl.includes('?')) {
                                       viewUrl += `&token=${token}`;
                                     } else {
                                       viewUrl += `?token=${token}`;
                                     }
                                  } 
                                  else if (viewUrl.includes('r2.cloudflarestorage.com') || viewUrl.includes('files.localcooks.ca')) {
                                    const response = await fetch(`/api/files/r2-presigned?url=${encodeURIComponent(viewUrl)}`, {
                                      method: 'GET',
                                      headers: { 'Authorization': `Bearer ${token}` },
                                      credentials: 'include',
                                    });
                                    if (response.ok) {
                                      const data = await response.json();
                                      viewUrl = data.url;
                                    }
                                  }
                                  
                                  window.open(viewUrl, '_blank');
                                } catch (error) {
                                  console.error("Error opening license:", error);
                                  toast({
                                    title: "Error",
                                    description: "Failed to open license document. Please try again.",
                                    variant: "destructive"
                                  });
                                }
                              }}
                              className="inline-flex items-center gap-2"
                            >
                              <ExternalLink className="h-4 w-4" />
                              View License
                            </Button>

                            <Button
                              variant="outline"
                              size="sm"
                              onClick={async () => {
                                if (!license.kitchenTermsUrl) {
                                  toast({
                                    title: "No Terms Document",
                                    description: "No kitchen terms & policies document has been uploaded for this location.",
                                    variant: "destructive",
                                  });
                                  return;
                                }

                                try {
                                  const token = await auth.currentUser?.getIdToken();
                                  let viewUrl = license.kitchenTermsUrl;
                                  
                                  if (viewUrl.includes('/api/files/documents/')) {
                                     if (viewUrl.includes('?')) {
                                       viewUrl += `&token=${token}`;
                                     } else {
                                       viewUrl += `?token=${token}`;
                                     }
                                  } 
                                  else if (viewUrl.includes('r2.cloudflarestorage.com') || viewUrl.includes('files.localcooks.ca')) {
                                    const response = await fetch(`/api/files/r2-presigned?url=${encodeURIComponent(viewUrl)}`, {
                                      method: 'GET',
                                      headers: { 'Authorization': `Bearer ${token}` },
                                      credentials: 'include',
                                    });
                                    if (response.ok) {
                                      const data = await response.json();
                                      viewUrl = data.url;
                                    }
                                  }
                                  
                                  window.open(viewUrl, '_blank');
                                } catch (error) {
                                  console.error("Error opening terms:", error);
                                  toast({
                                    title: "Error",
                                    description: "Failed to open terms document. Please try again.",
                                    variant: "destructive"
                                  });
                                }
                              }}
                              className={`inline-flex items-center gap-2 ${license.kitchenTermsUrl ? '' : 'opacity-50'}`}
                              disabled={!license.kitchenTermsUrl}
                            >
                              <FileText className="h-4 w-4" />
                              {license.kitchenTermsUrl ? 'View Terms' : 'No Terms'}
                            </Button>

                            {license.kitchenLicenseExpiry && (
                              <div className="flex items-center gap-2 text-sm px-3 py-1.5 bg-muted rounded-md border">
                                <Calendar className="h-4 w-4 text-muted-foreground" />
                                <span className="text-muted-foreground">Expires:</span>
                                <span className={new Date(license.kitchenLicenseExpiry) < new Date() ? "text-destructive font-semibold" : "font-medium"}>
                                  {new Date(license.kitchenLicenseExpiry).toLocaleDateString()}
                                  {new Date(license.kitchenLicenseExpiry) < new Date() && " (Expired)"}
                                </span>
                              </div>
                            )}

                            {license.kitchenTermsUploadedAt && (
                              <div className="flex items-center gap-2 text-sm px-3 py-1.5 bg-blue-50 rounded-md border border-blue-200">
                                <Clock className="h-4 w-4 text-blue-500" />
                                <span className="text-blue-600">Terms:</span>
                                <span className="font-medium text-blue-700">{new Date(license.kitchenTermsUploadedAt).toLocaleDateString()}</span>
                              </div>
                            )}
                          </div>

                          {license.kitchenLicenseStatus === 'approved' && license.kitchenLicenseApprovedAt && (
                            <div className="mt-2 text-sm text-green-700 bg-green-50 px-3 py-2 rounded-md border border-green-100 inline-block">
                              <CheckCircle className="h-3 w-3 inline mr-1 mb-0.5" />
                              Approved on {new Date(license.kitchenLicenseApprovedAt).toLocaleDateString()}
                            </div>
                          )}

                          {license.kitchenLicenseStatus === 'rejected' && (
                            <div className="mt-2 text-sm text-red-700 bg-red-50 px-3 py-2 rounded-md border border-red-100">
                              <p className="font-semibold flex items-center gap-1">
                                <XCircle className="h-3 w-3" />
                                Rejection Reason:
                              </p>
                              <p className="mt-1">{license.kitchenLicenseFeedback || "No feedback provided."}</p>
                            </div>
                          )}
                        </div>

                        {/* Expandable Action/Feedback Section */}
                        {(license.kitchenLicenseStatus === 'pending' || expandedLicense === license.id) && (
                          <>
                            {expandedLicense === license.id && (
                              <div className="mt-4 p-4 bg-muted rounded-lg border">
                                <label className="block text-sm font-medium mb-2">
                                  Feedback {license.kitchenLicenseStatus !== 'rejected' && '(Optional for approval, Required for rejection)'}
                                </label>
                                <Textarea
                                  value={feedback[license.id] || ''}
                                  onChange={(e) => setFeedback({ ...feedback, [license.id]: e.target.value })}
                                  placeholder="Add feedback or notes about this license..."
                                  rows={3}
                                />
                              </div>
                            )}

                            <div className="flex flex-wrap gap-3 mt-4">
                              {!expandedLicense && license.kitchenLicenseStatus === 'pending' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setExpandedLicense(license.id)}
                                >
                                  Add Feedback
                                </Button>
                              )}

                              {expandedLicense === license.id && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setExpandedLicense(null)}
                                >
                                  Cancel
                                </Button>
                              )}

                              {license.kitchenLicenseStatus !== 'approved' && (
                                <Button
                                  size="sm"
                                  onClick={() => handleApprove(license.id)}
                                  disabled={approveLicenseMutation.isPending}
                                  className="bg-green-600 hover:bg-green-700 text-white"
                                >
                                  <Check className="h-4 w-4 mr-2" />
                                  {approveLicenseMutation.isPending && expandedLicense === license.id ? 'Approving...' : 'Approve'}
                                </Button>
                              )}

                              {license.kitchenLicenseStatus !== 'rejected' && (
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => {
                                    if (!expandedLicense) {
                                      setExpandedLicense(license.id);
                                      toast({
                                        title: "Feedback Required",
                                        description: "Please add feedback before rejecting.",
                                      });
                                    } else {
                                      handleReject(license.id);
                                    }
                                  }}
                                  disabled={approveLicenseMutation.isPending}
                                >
                                  <X className="h-4 w-4 mr-2" />
                                  {approveLicenseMutation.isPending && expandedLicense === license.id ? 'Rejecting...' : 'Reject'}
                                </Button>
                              )}
                            </div>
                          </>
                        )}

                        {/* Allow Admin to edit result even if already processed */}
                        {license.kitchenLicenseStatus !== 'pending' && expandedLicense !== license.id && (
                          <div className="mt-4">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setExpandedLicense(license.id)}
                              className="text-muted-foreground"
                            >
                              Change Status / Edit Feedback
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
