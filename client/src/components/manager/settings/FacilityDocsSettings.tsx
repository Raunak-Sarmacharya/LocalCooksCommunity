/**
 * Facility Docs Settings Component
 * Standalone page for managing facility documents (floor plans, ventilation specs)
 * Uses the same data as the Application Requirements wizard's Facility Info step
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Building2,
  Upload,
  FileText,
  X,
  Loader2,
  FolderOpen,
  Wind,
  Info,
  CheckCircle2,
  Save,
} from 'lucide-react';
import { useFileUpload } from '@/hooks/useFileUpload';
import { useToast } from '@/hooks/use-toast';
import { auth } from '@/lib/firebase';

interface Location {
  id: number;
  name: string;
}

interface LocationRequirements {
  id?: number;
  floor_plans_url?: string;
  ventilation_specs?: string;
  ventilation_specs_url?: string;
}

interface FacilityDocsSettingsProps {
  location: Location;
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const currentFirebaseUser = auth.currentUser;
  if (!currentFirebaseUser) {
    throw new Error('Firebase user not available');
  }
  const token = await currentFirebaseUser.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export default function FacilityDocsSettings({ location }: FacilityDocsSettingsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [floorPlansFile, setFloorPlansFile] = useState<File | null>(null);
  const [ventilationFile, setVentilationFile] = useState<File | null>(null);
  const [ventilationSpecs, setVentilationSpecs] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const { uploadFile, isUploading, uploadProgress } = useFileUpload({
    maxSize: 4.5 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    onSuccess: (response) => {
      toast({
        title: 'File uploaded successfully',
        description: `${response.fileName} has been uploaded.`,
      });
    },
    onError: (error) => {
      toast({
        title: 'Upload failed',
        description: error,
        variant: 'destructive',
      });
    },
  });

  // Fetch current requirements (same endpoint as Application Requirements wizard)
  const { data: requirements, isLoading } = useQuery<LocationRequirements>({
    queryKey: [`/api/manager/locations/${location.id}/requirements`],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/locations/${location.id}/requirements`, {
        credentials: 'include',
        headers,
      });
      if (!response.ok) throw new Error('Failed to fetch requirements');
      return response.json();
    },
    enabled: !!location.id,
  });

  // Initialize state from fetched data
  useEffect(() => {
    if (requirements) {
      setVentilationSpecs(requirements.ventilation_specs || '');
      setHasUnsavedChanges(false);
    }
  }, [requirements]);

  // Save mutation (same endpoint as Application Requirements wizard)
  const saveMutation = useMutation({
    mutationFn: async (updates: Partial<LocationRequirements>) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/locations/${location.id}/requirements`, {
        method: 'PUT',
        headers,
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || error.error || 'Failed to save');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/manager/locations/${location.id}/requirements`] });
      setHasUnsavedChanges(false);
      toast({
        title: 'Saved',
        description: 'Facility documents updated successfully.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Save Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleFloorPlansUpload = async () => {
    if (!floorPlansFile) return;
    try {
      const result = await uploadFile(floorPlansFile);
      if (result) {
        saveMutation.mutate({ floor_plans_url: result.url });
        setFloorPlansFile(null);
      }
    } catch (error) {
      // Error handled in hook
    }
  };

  const handleVentilationUpload = async () => {
    if (!ventilationFile) return;
    try {
      const result = await uploadFile(ventilationFile);
      if (result) {
        saveMutation.mutate({ ventilation_specs_url: result.url });
        setVentilationFile(null);
      }
    } catch (error) {
      // Error handled in hook
    }
  };

  const handleRemoveFloorPlans = () => {
    saveMutation.mutate({ floor_plans_url: '' });
  };

  const handleRemoveVentilationDoc = () => {
    saveMutation.mutate({ ventilation_specs_url: '' });
  };

  const handleSaveVentilationSpecs = () => {
    saveMutation.mutate({ ventilation_specs: ventilationSpecs });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading facility documents...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Facility Documents</h2>
        <p className="text-muted-foreground">
          Manage floor plans and ventilation specifications for {location.name}. These documents are automatically shared with approved chefs.
        </p>
      </div>

      {/* Info Banner */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-violet-50 via-purple-50 to-violet-50 border border-violet-200/60 p-5">
        <div className="absolute top-0 right-0 w-32 h-32 bg-violet-200/30 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-purple-200/30 rounded-full translate-y-1/2 -translate-x-1/2" />
        
        <div className="relative flex items-start gap-3">
          <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-violet-600 flex items-center justify-center text-white shadow-lg shadow-violet-500/30">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-slate-900">
              Shared with Approved Chefs
            </h3>
            <p className="text-sm text-slate-600 mt-1">
              These documents help chefs prepare for using your kitchen space. They're automatically accessible after a chef is approved.
            </p>
            <Badge variant="secondary" className="mt-3 bg-violet-100 text-violet-700 border-0">
              <Info className="h-3 w-3 mr-1" />
              Same data as Application Requirements → Facility Info
            </Badge>
          </div>
        </div>
      </div>

      {/* Floor Plans */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-slate-500" />
            <div>
              <CardTitle className="text-lg">Floor Plans</CardTitle>
              <CardDescription>Upload your kitchen layout to help chefs navigate the space</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current Floor Plans */}
          {requirements?.floor_plans_url && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-emerald-50 border border-emerald-200">
              <div className="h-10 w-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-emerald-800">Floor Plans Uploaded</p>
                <a
                  href={requirements.floor_plans_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-emerald-600 hover:underline truncate block"
                >
                  View Document
                </a>
              </div>
              <Button
                onClick={handleRemoveFloorPlans}
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-700 hover:bg-red-50"
                disabled={saveMutation.isPending}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Upload Floor Plans */}
          <div className="space-y-3">
            <div className="relative">
              <input
                id="floor_plans_file"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                onChange={(e) => setFloorPlansFile(e.target.files?.[0] || null)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="flex items-center justify-between p-4 border-2 border-dashed border-slate-200 rounded-lg bg-slate-50/50 hover:border-slate-300 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center">
                    <FolderOpen className="h-5 w-5 text-slate-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-700">
                      {floorPlansFile ? floorPlansFile.name : 'Choose floor plans file'}
                    </p>
                    <p className="text-xs text-slate-500">PDF, JPG, PNG, or WebP (max 4.5MB)</p>
                  </div>
                </div>
                {floorPlansFile && (
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      setFloorPlansFile(null);
                    }}
                    variant="ghost"
                    size="sm"
                    className="relative z-20 text-red-500 hover:text-red-700"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            {floorPlansFile && (
              <Button
                onClick={handleFloorPlansUpload}
                disabled={isUploading}
                className="w-full"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Uploading... {uploadProgress}%
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    Upload Floor Plans
                  </>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Ventilation Specifications */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Wind className="h-5 w-5 text-slate-500" />
            <div>
              <CardTitle className="text-lg">Ventilation Specifications</CardTitle>
              <CardDescription>Document your ventilation system for compliance and chef awareness</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="ventilation_specs">Ventilation Description</Label>
            <Textarea
              id="ventilation_specs"
              value={ventilationSpecs}
              onChange={(e) => {
                setVentilationSpecs(e.target.value);
                setHasUnsavedChanges(true);
              }}
              placeholder="Describe your kitchen's ventilation system (CFM, type, exhaust locations, etc.)"
              rows={4}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Include details about CFM capacity, hood type, and exhaust locations
            </p>
          </div>

          {hasUnsavedChanges && (
            <Button onClick={handleSaveVentilationSpecs} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Description
                </>
              )}
            </Button>
          )}

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-3 text-slate-400">And/Or Upload Document</span>
            </div>
          </div>

          {/* Current Ventilation Document */}
          {requirements?.ventilation_specs_url && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-emerald-50 border border-emerald-200">
              <div className="h-10 w-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-emerald-800">Ventilation Document Uploaded</p>
                <a
                  href={requirements.ventilation_specs_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-emerald-600 hover:underline truncate block"
                >
                  View Document
                </a>
              </div>
              <Button
                onClick={handleRemoveVentilationDoc}
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-700 hover:bg-red-50"
                disabled={saveMutation.isPending}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Upload Ventilation Document */}
          <div className="space-y-3">
            <Label>Upload Documentation (Optional)</Label>
            <div className="relative">
              <input
                id="ventilation_file"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                onChange={(e) => setVentilationFile(e.target.files?.[0] || null)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="flex items-center justify-between p-4 border-2 border-dashed border-slate-200 rounded-lg bg-slate-50/50 hover:border-slate-300 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center">
                    <FolderOpen className="h-5 w-5 text-slate-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-700">
                      {ventilationFile ? ventilationFile.name : 'Choose document'}
                    </p>
                    <p className="text-xs text-slate-500">PDF, JPG, PNG, or WebP (max 4.5MB)</p>
                  </div>
                </div>
                {ventilationFile && (
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      setVentilationFile(null);
                    }}
                    variant="ghost"
                    size="sm"
                    className="relative z-20 text-red-500 hover:text-red-700"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            {ventilationFile && (
              <Button
                onClick={handleVentilationUpload}
                disabled={isUploading}
                className="w-full"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Uploading... {uploadProgress}%
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    Upload Document
                  </>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
