import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, Loader2, Plus, Trash2, X, Upload, FolderOpen, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFileUpload } from '@/hooks/useFileUpload';
import { auth } from '@/lib/firebase';

interface LocationRequirementsSettingsProps {
  locationId: number;
  locationName?: string; // Optional: location name to display in header
  onSaveSuccess?: () => void; // [NEW] Callback when requirements are saved
}

interface CustomField {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'select' | 'checkbox' | 'date' | 'file' | 'cloudflare_upload';
  required: boolean;
  placeholder?: string;
  options?: string[];
  tier: 1 | 2 | 3;
}

interface LocationRequirements {
  id: number;
  locationId: number;
  requireFirstName: boolean;
  requireLastName: boolean;
  requireEmail: boolean;
  requirePhone: boolean;
  requireBusinessName: boolean;
  requireBusinessType: boolean;
  requireExperience: boolean;
  requireBusinessDescription: boolean;
  requireFoodHandlerCert: boolean;
  requireFoodHandlerExpiry: boolean;
  requireUsageFrequency: boolean;
  requireSessionDuration: boolean;
  requireTermsAgree: boolean;
  requireAccuracyAgree: boolean;
  customFields?: CustomField[];
  // Tier 1 Requirements
  tier1_years_experience_required?: boolean;
  tier1_years_experience_minimum?: number;
  tier1_custom_fields?: CustomField[];
  // Tier 2 Requirements
  tier2_food_establishment_cert_required?: boolean;
  tier2_food_establishment_expiry_required?: boolean;
  tier2_insurance_document_required?: boolean;
  tier2_custom_fields?: CustomField[];
  // Facility Information
  floor_plans_url?: string;
  ventilation_specs?: string;
  ventilation_specs_url?: string;
}

const FIELD_GROUPS = [
  {
    title: 'Personal Information',
    fields: [
      { key: 'requireFirstName', label: 'First Name' },
      { key: 'requireLastName', label: 'Last Name' },
      { key: 'requireEmail', label: 'Email Address' },
      { key: 'requirePhone', label: 'Phone Number' },
    ]
  },
  {
    title: 'Business Information',
    fields: [
      { key: 'requireBusinessName', label: 'Business Name' },
      { key: 'requireBusinessType', label: 'Business Type' },
      { key: 'requireBusinessDescription', label: 'Business Description' },
    ]
  },
  {
    title: 'Certifications',
    fields: [
      { key: 'requireFoodHandlerCert', label: 'Food Handler Certificate' },
      { key: 'requireFoodHandlerExpiry', label: 'Food Handler Expiry Date' },
    ]
  },
  {
    title: 'Kitchen Usage',
    fields: [
      { key: 'requireUsageFrequency', label: 'Usage Frequency' },
      { key: 'requireSessionDuration', label: 'Session Duration' },
    ]
  },
  {
    title: 'Agreements',
    fields: [
      { key: 'requireTermsAgree', label: 'Terms Agreement' },
      { key: 'requireAccuracyAgree', label: 'Accuracy Certification' },
    ]
  },
];

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

export default function LocationRequirementsSettings({ locationId, locationName, onSaveSuccess }: LocationRequirementsSettingsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [requirements, setRequirements] = useState<Partial<LocationRequirements>>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showAddField, setShowAddField] = useState(false);
  const [editingField, setEditingField] = useState<CustomField | null>(null);
  const [newField, setNewField] = useState<Partial<CustomField>>({
    type: 'text',
    required: false,
    tier: 1,
  });

  // File upload states
  const [floorPlansFile, setFloorPlansFile] = useState<File | null>(null);
  const [ventilationFile, setVentilationFile] = useState<File | null>(null);

  // Initialize file upload hook
  const { uploadFile, isUploading, uploadProgress, error: uploadError } = useFileUpload({
    maxSize: 4.5 * 1024 * 1024, // 4.5MB (Vercel limit)
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    onSuccess: (response) => {
      toast({
        title: "File uploaded successfully",
        description: `${response.fileName} has been uploaded.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Upload failed",
        description: error,
        variant: "destructive",
      });
    }
  });

  // Fetch current requirements
  const { data, isLoading } = useQuery<LocationRequirements>({
    queryKey: [`/api/manager/locations/${locationId}/requirements`],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/locations/${locationId}/requirements`, {
        credentials: 'include',
        headers,
      });
      if (!response.ok) throw new Error('Failed to fetch requirements');
      return response.json();
    },
  });

  useEffect(() => {
    if (data) {
      setRequirements(data);
      setHasUnsavedChanges(false);
    }
  }, [data]);

  // Save requirements
  const saveMutation = useMutation({
    mutationFn: async (updates: Partial<LocationRequirements>) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/locations/${locationId}/requirements`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...headers },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (!response.ok) {
        const error = await response.json();
        const errorMessage = error.message || error.error || 'Failed to save requirements';
        // Include validation details if available
        if (error.details && Array.isArray(error.details)) {
          const details = error.details.map((d: any) => `${d.path?.join('.') || 'field'}: ${d.message}`).join(', ');
          throw new Error(`${errorMessage}. ${details}`);
        }
        throw new Error(errorMessage);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/manager/locations/${locationId}/requirements`] });
      queryClient.invalidateQueries({ queryKey: [`location-${locationId}`], exact: false });
      setHasUnsavedChanges(false);
      toast({ title: 'Success', description: 'Application requirements updated successfully' });
      // [NEW] Notify parent that save was successful
      if (onSaveSuccess) {
        onSaveSuccess();
      }
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const handleToggle = (field: string, value: any) => {
    setRequirements(prev => ({ ...prev, [field]: value }));
    setHasUnsavedChanges(true);
  };

  const handleFloorPlansUpload = async () => {
    if (!floorPlansFile) return;

    try {
      const result = await uploadFile(floorPlansFile);
      if (result) {
        setRequirements(prev => ({ ...prev, floor_plans_url: result.url }));
        setFloorPlansFile(null);
        setHasUnsavedChanges(true);
      }
    } catch (error) {
      // Error handling is done in the useFileUpload hook
    }
  };

  const handleVentilationUpload = async () => {
    if (!ventilationFile) return;

    try {
      const result = await uploadFile(ventilationFile);
      if (result) {
        setRequirements(prev => ({ ...prev, ventilation_specs_url: result.url }));
        setVentilationFile(null);
        setHasUnsavedChanges(true);
      }
    } catch (error) {
      // Error handling is done in the useFileUpload hook
    }
  };

  const handleSave = () => {
    saveMutation.mutate(requirements);
  };

  const handleAddField = () => {
    if (!newField.label || !newField.type) {
      toast({
        title: 'Error',
        description: 'Please provide a label and type for the field',
        variant: 'destructive',
      });
      return;
    }

    if ((newField.type === 'select' || newField.type === 'checkbox') && (!newField.options || newField.options.length === 0)) {
      toast({
        title: 'Error',
        description: `${newField.type === 'select' ? 'Select' : 'Checkbox'} fields must have at least one option`,
        variant: 'destructive',
      });
      return;
    }

    if (!newField.tier || ![1, 2, 3].includes(newField.tier)) {
      toast({
        title: 'Error',
        description: 'Please select a valid tier for the custom field',
        variant: 'destructive',
      });
      return;
    }

    const field: CustomField = {
      id: `custom_${Date.now()}`,
      label: newField.label!,
      type: newField.type!,
      required: newField.required ?? false,
      placeholder: newField.placeholder,
      options: (newField.type === 'select' || newField.type === 'checkbox') ? newField.options : undefined,
      tier: newField.tier!,
    };

    setRequirements(prev => {
      const tierKey = `tier${field.tier}_custom_fields` as keyof LocationRequirements;
      return {
        ...prev,
        [tierKey]: [...(prev[tierKey] as CustomField[] || []), field],
      };
    });
    setHasUnsavedChanges(true);

    setNewField({ type: 'text', required: false, tier: 1 });
    setShowAddField(false);
  };

  const handleEditField = (field: CustomField) => {
    setEditingField(field);
    setNewField(field);
    setShowAddField(true);
  };

  const handleUpdateField = () => {
    if (!newField.label || !newField.type || !editingField) {
      toast({
        title: 'Error',
        description: 'Please provide a label and type for the field',
        variant: 'destructive',
      });
      return;
    }

    if ((newField.type === 'select' || newField.type === 'checkbox') && (!newField.options || newField.options.length === 0)) {
      toast({
        title: 'Error',
        description: `${newField.type === 'select' ? 'Select' : 'Checkbox'} fields must have at least one option`,
        variant: 'destructive',
      });
      return;
    }

    if (!newField.tier || ![1, 2, 3].includes(newField.tier)) {
      toast({
        title: 'Error',
        description: 'Please select a valid tier for the custom field',
        variant: 'destructive',
      });
      return;
    }

    const updatedField: CustomField = {
      id: editingField.id,
      label: newField.label!,
      type: newField.type!,
      required: newField.required ?? false,
      placeholder: newField.placeholder,
      options: (newField.type === 'select' || newField.type === 'checkbox') ? newField.options : undefined,
      tier: newField.tier!,
    };

    setRequirements(prev => {
      const tierKey = `tier${updatedField.tier}_custom_fields` as keyof LocationRequirements;
      return {
        ...prev,
        [tierKey]: (prev[tierKey] as CustomField[] || []).map(f => f.id === editingField.id ? updatedField : f),
      };
    });
    setHasUnsavedChanges(true);

    setEditingField(null);
    setNewField({ type: 'text', required: false, tier: 1 });
    setShowAddField(false);
  };

  const handleDeleteField = (fieldId: string) => {
    setRequirements(prev => {
      const updated = { ...prev };
      // Remove from all tier arrays
      (updated.tier1_custom_fields as CustomField[]) = (prev.tier1_custom_fields as CustomField[] || []).filter(f => f.id !== fieldId);
      (updated.tier2_custom_fields as CustomField[]) = (prev.tier2_custom_fields as CustomField[] || []).filter(f => f.id !== fieldId);
      return updated;
    });
    setHasUnsavedChanges(true);
  };

  const handleCancelEdit = () => {
    setEditingField(null);
    setNewField({ type: 'text', required: false, tier: 1 });
    setShowAddField(false);
  };

  const handleAddOption = () => {
    const option = prompt('Enter option value:');
    if (option && option.trim()) {
      setNewField(prev => ({
        ...prev,
        options: [...(prev.options || []), option.trim()],
      }));
    }
  };

  const handleRemoveOption = (index: number) => {
    setNewField(prev => ({
      ...prev,
      options: (prev.options || []).filter((_, i) => i !== index),
    }));
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      {hasUnsavedChanges && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-amber-500 rounded-full"></div>
            <p className="text-sm font-medium text-amber-800">You have unsaved changes</p>
          </div>
          <p className="text-sm text-amber-700 mt-1">
            Don't forget to save your changes to make them visible to chefs and in chat.
          </p>
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-lg font-semibold text-gray-900">Application Requirements</h3>
          {locationName && (
            <span className="px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded-md">
              {locationName}
            </span>
          )}
        </div>
        <p className="text-sm text-gray-600">
          Configure which fields are required for chefs applying to this kitchen. Toggle fields to make them optional.
          {locationName && (
            <span className="block mt-1 text-xs text-gray-500">
              These settings apply only to <strong>{locationName}</strong>. Each location can have different requirements.
            </span>
          )}
        </p>
      </div>


      {/* Tier 1 Requirements Section */}
      <Card className="border border-gray-200">
        <CardContent className="p-6">
          <div className="mb-4">
            <h4 className="font-medium text-gray-900">Step 1 Requirements (Submit Application)</h4>
            <p className="text-sm text-gray-600 mt-1">
              Configure which fields are required for the initial application submission
            </p>
          </div>
          <div className="space-y-6">
            {/* Personal Information, Business Information, Certifications */}
            {FIELD_GROUPS.slice(0, 3).map((group) => (
              <div key={group.title} className="border-t border-gray-100 pt-4">
                <h5 className="text-sm font-medium text-gray-700 mb-3">{group.title}</h5>
                <div className="space-y-4">
                  {group.fields.map((field) => (
                    <div key={field.key} className="flex items-center justify-between">
                      <div>
                        <label className="text-sm font-medium text-gray-700">{field.label}</label>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {requirements[field.key as keyof LocationRequirements] ? 'Required' : 'Optional'}
                        </p>
                      </div>
                      <Switch
                        checked={Boolean(requirements[field.key as keyof LocationRequirements] ?? true)}
                        onCheckedChange={(checked) => handleToggle(field.key, checked)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Experience Requirements */}
            <div className="border-t border-gray-100 pt-4">
              <h5 className="text-sm font-medium text-gray-700 mb-3">Experience Requirements</h5>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-700">Years of Experience Required</label>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {requirements.tier1_years_experience_required ? 'Required' : 'Optional'}
                    </p>
                  </div>
                  <Switch
                    checked={Boolean(requirements.tier1_years_experience_required)}
                    onCheckedChange={(checked) => handleToggle('tier1_years_experience_required', checked)}
                  />
                </div>
                {requirements.tier1_years_experience_required && (
                  <div>
                    <Label htmlFor="tier1_years_minimum">Minimum Years of Experience</Label>
                    <Input
                      id="tier1_years_minimum"
                      type="number"
                      min="0"
                      value={requirements.tier1_years_experience_minimum || 0}
                      onChange={(e) => {
                        setRequirements(prev => ({ ...prev, tier1_years_experience_minimum: parseInt(e.target.value) || 0 }));
                        setHasUnsavedChanges(true);
                      }}
                      className="mt-1"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Kitchen Usage, Agreements */}
            {FIELD_GROUPS.slice(3).map((group) => (
              <div key={group.title} className="border-t border-gray-100 pt-4">
                <h5 className="text-sm font-medium text-gray-700 mb-3">{group.title}</h5>
                <div className="space-y-4">
                  {group.fields.map((field) => (
                    <div key={field.key} className="flex items-center justify-between">
                      <div>
                        <label className="text-sm font-medium text-gray-700">{field.label}</label>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {requirements[field.key as keyof LocationRequirements] ? 'Required' : 'Optional'}
                        </p>
                      </div>
                      <Switch
                        checked={Boolean(requirements[field.key as keyof LocationRequirements] ?? true)}
                        onCheckedChange={(checked) => handleToggle(field.key, checked)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Tier 2 Requirements Section */}
      <Card className="border border-gray-200">
        <CardContent className="p-6">
          <div className="mb-4">
            <h4 className="font-medium text-gray-900">Step 2 Requirements (Kitchen Coordination)</h4>
            <p className="text-sm text-gray-600 mt-1">
              Requirements for kitchen coordination and operational planning
            </p>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-gray-700">Food Establishment License Required</label>
                <p className="text-xs text-gray-500 mt-0.5">
                  {requirements.tier2_food_establishment_cert_required ? 'Required' : 'Optional'}
                </p>
              </div>
              <Switch
                checked={Boolean(requirements.tier2_food_establishment_cert_required)}
                onCheckedChange={(checked) => handleToggle('tier2_food_establishment_cert_required', checked)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-gray-700">Food Establishment Expiry Date Required</label>
                <p className="text-xs text-gray-500 mt-0.5">
                  {requirements.tier2_food_establishment_expiry_required ? 'Required' : 'Optional'}
                </p>
              </div>
              <Switch
                checked={Boolean(requirements.tier2_food_establishment_expiry_required)}
                onCheckedChange={(checked) => handleToggle('tier2_food_establishment_expiry_required', checked)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-gray-700">Insurance Document Required</label>
                <p className="text-xs text-gray-500 mt-0.5">
                  {requirements.tier2_insurance_document_required ? 'Required' : 'Optional'}
                </p>
              </div>
              <Switch
                checked={Boolean(requirements.tier2_insurance_document_required)}
                onCheckedChange={(checked) => handleToggle('tier2_insurance_document_required', checked)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Facility Information Section */}
      <Card className="border border-gray-200">
        <CardContent className="p-6">
          <div className="mb-4">
            <h4 className="font-medium text-gray-900">Facility Information</h4>
            <p className="text-sm text-gray-600 mt-1">
              Information automatically shared with chefs (floor plans, equipment, etc.)
            </p>
          </div>
          <div className="space-y-4">
            <div>
              <Label>Floor Plans</Label>
              <p className="text-xs text-gray-500 mt-1 mb-3">
                Upload your kitchen floor plans
              </p>
              {/* Current floor plans display */}
              {requirements.floor_plans_url && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="h-4 w-4 text-blue-600" />
                    <span className="text-sm font-medium text-blue-800">Current Floor Plans</span>
                  </div>
                  <a
                    href={requirements.floor_plans_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 underline text-sm hover:text-blue-800"
                  >
                    View Document
                  </a>
                  <Button
                    onClick={() => {
                      setRequirements(prev => ({ ...prev, floor_plans_url: '' }));
                      setHasUnsavedChanges(true);
                    }}
                    variant="ghost"
                    size="sm"
                    className="ml-2 text-red-600 hover:text-red-700"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {/* File upload section */}
              <div className="space-y-3">
                <div>
                  <Label htmlFor="floor_plans_file">Upload Floor Plans</Label>
                  <div className="relative mt-1">
                    <input
                      id="floor_plans_file"
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.webp"
                      onChange={(e) => setFloorPlansFile(e.target.files?.[0] || null)}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div className="flex items-center justify-between p-3 border border-gray-300 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
                      <div className="flex items-center gap-3">
                        <FolderOpen className="h-5 w-5 text-gray-500" />
                        <span className="text-sm text-gray-700">
                          {floorPlansFile ? floorPlansFile.name : "Choose floor plans file..."}
                        </span>
                      </div>
                      {floorPlansFile && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFloorPlansFile(null);
                          }}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Supports PDF, JPG, PNG, WebP (max 4.5MB)
                  </p>
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

            <div>
              <Label>Ventilation Specifications</Label>
              <p className="text-xs text-gray-500 mt-1 mb-3">
                Provide ventilation details via description or upload documentation
              </p>

              {/* Current ventilation specs file display */}
              {requirements.ventilation_specs_url && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="h-4 w-4 text-green-600" />
                    <span className="text-sm font-medium text-green-800">Current Ventilation Document</span>
                  </div>
                  <a
                    href={requirements.ventilation_specs_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-green-600 underline text-sm hover:text-green-800"
                  >
                    View Document
                  </a>
                  <Button
                    onClick={() => {
                      setRequirements(prev => ({ ...prev, ventilation_specs_url: '' }));
                      setHasUnsavedChanges(true);
                    }}
                    variant="ghost"
                    size="sm"
                    className="ml-2 text-red-600 hover:text-red-700"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {/* Description section */}
              <div className="space-y-3">
                <div>
                  <Label htmlFor="ventilation_specs">Description</Label>
                  <Textarea
                    id="ventilation_specs"
                    value={requirements.ventilation_specs || ''}
                    onChange={(e) => {
                      setRequirements(prev => ({ ...prev, ventilation_specs: e.target.value }));
                      setHasUnsavedChanges(true);
                    }}
                    className="mt-1"
                    placeholder="Describe your kitchen's ventilation system specifications..."
                    rows={4}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Provide details about your ventilation system (CFM, type, exhaust locations, etc.)
                  </p>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-white px-2 text-muted-foreground">And/Or</span>
                  </div>
                </div>

                {/* File upload section */}
                <div>
                  <Label htmlFor="ventilation_file">Upload Documentation (Optional)</Label>
                  <div className="relative mt-1">
                    <input
                      id="ventilation_file"
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.webp"
                      onChange={(e) => setVentilationFile(e.target.files?.[0] || null)}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div className="flex items-center justify-between p-3 border border-gray-300 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
                      <div className="flex items-center gap-3">
                        <FolderOpen className="h-5 w-5 text-gray-500" />
                        <span className="text-sm text-gray-700">
                          {ventilationFile ? ventilationFile.name : "Choose ventilation document..."}
                        </span>
                      </div>
                      {ventilationFile && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setVentilationFile(null);
                          }}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Supports PDF, JPG, PNG, WebP (max 4.5MB) - Optional documentation
                  </p>
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
        </CardContent>
      </Card>

      {/* Custom Fields Section */}
      <Card className="border border-gray-200">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h4 className="font-medium text-gray-900">Custom Fields</h4>
              <p className="text-sm text-gray-600 mt-1">
                Add custom fields to collect additional information from applicants
              </p>
            </div>
            {!showAddField && (
              <Button
                onClick={() => setShowAddField(true)}
                variant="outline"
                size="sm"
                className="bg-[#208D80] text-white hover:bg-[#1A7470] border-[#208D80]"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Field
              </Button>
            )}
          </div>

          {/* Existing Custom Fields */}
          {((requirements.tier1_custom_fields as CustomField[])?.length > 0 || (requirements.tier2_custom_fields as CustomField[])?.length > 0) && (
            <div className="space-y-4 mb-4">
              {/* Tier 1 Fields */}
              {(requirements.tier1_custom_fields as CustomField[])?.length > 0 && (
                <div>
                  <h5 className="text-sm font-medium text-gray-700 mb-2">Step 1 - Submit Application Fields</h5>
                  <div className="space-y-2">
                    {(requirements.tier1_custom_fields as CustomField[]).map((field) => (
                      <div
                        key={field.id}
                        className="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-200"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm text-gray-900">{field.label}</span>
                            <span className="text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded">Step 1</span>
                            <span className="text-xs text-gray-500">({field.type})</span>
                            {field.required && (
                              <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">Required</span>
                            )}
                          </div>
                          {field.placeholder && (
                            <p className="text-xs text-gray-500 mt-1">Placeholder: {field.placeholder}</p>
                          )}
                          {field.options && field.options.length > 0 && (
                            <p className="text-xs text-gray-500 mt-1">
                              {field.type === 'select' ? 'Options' : 'Checkable items'}: {field.options.join(', ')}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            onClick={() => handleEditField(field)}
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                          >
                            Edit
                          </Button>
                          <Button
                            onClick={() => handleDeleteField(field.id)}
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Tier 2 Fields */}
              {(requirements.tier2_custom_fields as CustomField[])?.length > 0 && (
                <div>
                  <h5 className="text-sm font-medium text-gray-700 mb-2">Step 2 - Kitchen Coordination Fields</h5>
                  <div className="space-y-2">
                    {(requirements.tier2_custom_fields as CustomField[]).map((field) => (
                      <div
                        key={field.id}
                        className="flex items-center justify-between p-3 bg-green-50 rounded-lg border border-green-200"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm text-gray-900">{field.label}</span>
                            <span className="text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded">Step 2</span>
                            <span className="text-xs text-gray-500">({field.type})</span>
                            {field.required && (
                              <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">Required</span>
                            )}
                          </div>
                          {field.placeholder && (
                            <p className="text-xs text-gray-500 mt-1">Placeholder: {field.placeholder}</p>
                          )}
                          {field.options && field.options.length > 0 && (
                            <p className="text-xs text-gray-500 mt-1">
                              {field.type === 'select' ? 'Options' : 'Checkable items'}: {field.options.join(', ')}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            onClick={() => handleEditField(field)}
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                          >
                            Edit
                          </Button>
                          <Button
                            onClick={() => handleDeleteField(field.id)}
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Add/Edit Field Form */}
          {showAddField && (
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-200 space-y-4">
              <div className="flex items-center justify-between">
                <h5 className="font-medium text-gray-900">
                  {editingField ? 'Edit Custom Field' : 'Add Custom Field'}
                </h5>
                <Button
                  onClick={handleCancelEdit}
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="field-label">Field Label *</Label>
                  <Input
                    id="field-label"
                    value={newField.label || ''}
                    onChange={(e) => setNewField(prev => ({ ...prev, label: e.target.value }))}
                    placeholder="e.g., Special Dietary Requirements"
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="field-type">Field Type *</Label>
                  <Select
                    value={newField.type}
                    onValueChange={(value: CustomField['type']) => setNewField(prev => ({ ...prev, type: value, options: (value === 'select' || value === 'checkbox') ? [] : undefined }))}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">Text</SelectItem>
                      <SelectItem value="textarea">Textarea</SelectItem>
                      <SelectItem value="number">Number</SelectItem>
                      <SelectItem value="select">Select (Dropdown)</SelectItem>
                      <SelectItem value="checkbox">Checkbox</SelectItem>
                      <SelectItem value="date">Date</SelectItem>
                      <SelectItem value="file">File Upload</SelectItem>
                      <SelectItem value="cloudflare_upload">Cloudflare Upload</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="field-tier">Step *</Label>
                  <Select
                    value={newField.tier?.toString()}
                    onValueChange={(value: string) => setNewField(prev => ({ ...prev, tier: parseInt(value) as 1 | 2 | 3 }))}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select Step" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Step 1 - Submit Application</SelectItem>
                      <SelectItem value="2">Step 2 - Kitchen Coordination</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="field-placeholder">Placeholder (Optional)</Label>
                <Input
                  id="field-placeholder"
                  value={newField.placeholder || ''}
                  onChange={(e) => setNewField(prev => ({ ...prev, placeholder: e.target.value }))}
                  placeholder="e.g., Enter your dietary requirements"
                  className="mt-1"
                />
              </div>

              {(newField.type === 'select' || newField.type === 'checkbox') && (
                <div>
                  <Label>
                    {newField.type === 'select' ? 'Dropdown Options' : 'Checkbox Options'} *
                  </Label>
                  <p className="text-xs text-gray-500 mt-1 mb-2">
                    {newField.type === 'select'
                      ? 'Add options that will appear in the dropdown menu'
                      : 'Add options that users can check (multiple selections allowed)'}
                  </p>
                  <div className="mt-2 space-y-2">
                    {newField.options && newField.options.map((option, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <Input value={option} readOnly className="flex-1" />
                        <Button
                          onClick={() => handleRemoveOption(index)}
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      onClick={handleAddOption}
                      variant="outline"
                      size="sm"
                      type="button"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add Option
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <Switch
                  checked={newField.required ?? false}
                  onCheckedChange={(checked) => setNewField(prev => ({ ...prev, required: checked }))}
                />
                <Label>Required Field</Label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button onClick={handleCancelEdit} variant="outline" size="sm">
                  Cancel
                </Button>
                <Button
                  onClick={editingField ? handleUpdateField : handleAddField}
                  size="sm"
                  className="bg-[#208D80] hover:bg-[#1A7470]"
                >
                  {editingField ? 'Update Field' : 'Add Field'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end pt-4">
        <Button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className={hasUnsavedChanges
            ? "bg-amber-600 hover:bg-amber-700 text-white shadow-lg"
            : "bg-[#208D80] hover:bg-[#1A7470]"
          }
        >
          {saveMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              {hasUnsavedChanges ? "Save Changes" : "Save Requirements"}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
