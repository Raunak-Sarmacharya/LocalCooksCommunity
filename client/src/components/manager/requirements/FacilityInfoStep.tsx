/**
 * Facility Information Step
 * Information automatically shared with approved chefs
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
} from 'lucide-react';
import { useFileUpload } from '@/hooks/useFileUpload';
import { useToast } from '@/hooks/use-toast';
import { usePresignedDocumentUrl } from '@/hooks/use-presigned-document-url';
import { LocationRequirements } from './types';

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

interface FacilityInfoStepProps {
  requirements: Partial<LocationRequirements>;
  onRequirementsChange: (updates: Partial<LocationRequirements>) => void;
  onUnsavedChange: () => void;
}

export function FacilityInfoStep({
  requirements,
  onRequirementsChange,
  onUnsavedChange,
}: FacilityInfoStepProps) {
  const { toast } = useToast();
  const [floorPlansFile, setFloorPlansFile] = useState<File | null>(null);
  const [ventilationFile, setVentilationFile] = useState<File | null>(null);

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

  const handleFloorPlansUpload = async () => {
    if (!floorPlansFile) return;
    try {
      const result = await uploadFile(floorPlansFile);
      if (result) {
        onRequirementsChange({ floor_plans_url: result.url });
        setFloorPlansFile(null);
        onUnsavedChange();
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
        onRequirementsChange({ ventilation_specs_url: result.url });
        setVentilationFile(null);
        onUnsavedChange();
      }
    } catch (error) {
      // Error handled in hook
    }
  };

  const handleRemoveFloorPlans = () => {
    onRequirementsChange({ floor_plans_url: '' });
    onUnsavedChange();
  };

  const handleRemoveVentilationDoc = () => {
    onRequirementsChange({ ventilation_specs_url: '' });
    onUnsavedChange();
  };

  const handleVentilationSpecsChange = (value: string) => {
    onRequirementsChange({ ventilation_specs: value });
    onUnsavedChange();
  };

  return (
    <div className="space-y-6">
      {/* Step Explanation Card */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-violet-50 via-purple-50 to-violet-50 dark:from-violet-950/40 dark:via-purple-950/30 dark:to-violet-950/40 border border-violet-200/60 dark:border-violet-800/40 p-5">
        <div className="absolute top-0 right-0 w-32 h-32 bg-violet-200/30 dark:bg-violet-700/20 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-purple-200/30 dark:bg-purple-700/20 rounded-full translate-y-1/2 -translate-x-1/2" />
        
        <div className="relative">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-violet-600 dark:bg-violet-500 flex items-center justify-center text-white shadow-lg shadow-violet-500/30">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Facility Information
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                This information is automatically shared with chefs after they're approved. 
                It helps them prepare for using your kitchen space efficiently.
              </p>
            </div>
          </div>
          
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant="info">
              <Info className="h-3 w-3 mr-1" />
              Shared automatically with approved chefs
            </Badge>
          </div>
        </div>
      </div>

      {/* Floor Plans Section */}
      <div className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-slate-200/80 dark:border-slate-700/80 bg-slate-50/50 dark:bg-slate-800/50">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-slate-500" />
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Floor Plans
            </h4>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Upload your kitchen layout to help chefs navigate the space
          </p>
        </div>
        
        <div className="p-5 space-y-4">
          {/* Current Floor Plans */}
          {requirements.floor_plans_url && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-800/40">
              <div className="h-10 w-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                  Floor Plans Uploaded
                </p>
                <AuthenticatedDocumentLink
                  url={requirements.floor_plans_url}
                  className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline truncate block"
                >
                  View Document
                </AuthenticatedDocumentLink>
              </div>
              <Button
                onClick={handleRemoveFloorPlans}
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
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
              <div className="flex items-center justify-between p-4 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50/50 dark:bg-slate-800/30 hover:border-slate-300 dark:hover:border-slate-600 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                    <FolderOpen className="h-5 w-5 text-slate-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      {floorPlansFile ? floorPlansFile.name : 'Choose floor plans file'}
                    </p>
                    <p className="text-xs text-slate-500">
                      PDF, JPG, PNG, or WebP (max 4.5MB)
                    </p>
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
        </div>
      </div>

      {/* Ventilation Specifications Section */}
      <div className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-slate-200/80 dark:border-slate-700/80 bg-slate-50/50 dark:bg-slate-800/50">
          <div className="flex items-center gap-2">
            <Wind className="h-4 w-4 text-slate-500" />
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Ventilation Specifications
            </h4>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Document your ventilation system for compliance and chef awareness
          </p>
        </div>
        
        <div className="p-5 space-y-5">
          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="ventilation_specs" className="text-sm font-medium">
              Ventilation Description
            </Label>
            <Textarea
              id="ventilation_specs"
              value={requirements.ventilation_specs || ''}
              onChange={(e) => handleVentilationSpecsChange(e.target.value)}
              placeholder="Describe your kitchen's ventilation system (CFM, type, exhaust locations, etc.)"
              rows={4}
              className="resize-none"
            />
            <p className="text-xs text-slate-500">
              Include details about CFM capacity, hood type, and exhaust locations
            </p>
          </div>

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200 dark:border-slate-700" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white dark:bg-slate-900 px-3 text-slate-400 dark:text-slate-500">
                And/Or
              </span>
            </div>
          </div>

          {/* Current Ventilation Document */}
          {requirements.ventilation_specs_url && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-800/40">
              <div className="h-10 w-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                  Ventilation Document Uploaded
                </p>
                <AuthenticatedDocumentLink
                  url={requirements.ventilation_specs_url}
                  className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline truncate block"
                >
                  View Document
                </AuthenticatedDocumentLink>
              </div>
              <Button
                onClick={handleRemoveVentilationDoc}
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Upload Ventilation Document */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Upload Documentation (Optional)</Label>
            <div className="relative">
              <input
                id="ventilation_file"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                onChange={(e) => setVentilationFile(e.target.files?.[0] || null)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="flex items-center justify-between p-4 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50/50 dark:bg-slate-800/30 hover:border-slate-300 dark:hover:border-slate-600 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                    <FolderOpen className="h-5 w-5 text-slate-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      {ventilationFile ? ventilationFile.name : 'Choose document'}
                    </p>
                    <p className="text-xs text-slate-500">
                      PDF, JPG, PNG, or WebP (max 4.5MB)
                    </p>
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
                    Upload Ventilation Document
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default FacilityInfoStep;
