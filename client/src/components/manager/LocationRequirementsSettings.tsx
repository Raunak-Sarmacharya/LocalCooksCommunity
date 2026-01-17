import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, Loader2, Plus, Trash2, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { auth } from '@/lib/firebase';

interface LocationRequirementsSettingsProps {
  locationId: number;
}

interface CustomField {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'select' | 'checkbox' | 'date';
  required: boolean;
  placeholder?: string;
  options?: string[];
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
  requireFoodEstablishmentCert: boolean;
  requireFoodEstablishmentExpiry: boolean;
  requireUsageFrequency: boolean;
  requireSessionDuration: boolean;
  requireTermsAgree: boolean;
  requireAccuracyAgree: boolean;
  customFields?: CustomField[];
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
      { key: 'requireExperience', label: 'Years of Experience' },
      { key: 'requireBusinessDescription', label: 'Business Description' },
    ]
  },
  {
    title: 'Certifications',
    fields: [
      { key: 'requireFoodHandlerCert', label: 'Food Handler Certificate' },
      { key: 'requireFoodHandlerExpiry', label: 'Food Handler Expiry Date' },
      { key: 'requireFoodEstablishmentCert', label: 'Food Establishment License' },
      { key: 'requireFoodEstablishmentExpiry', label: 'Food Establishment Expiry' },
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

export default function LocationRequirementsSettings({ locationId }: LocationRequirementsSettingsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [requirements, setRequirements] = useState<Partial<LocationRequirements>>({});
  const [showAddField, setShowAddField] = useState(false);
  const [editingField, setEditingField] = useState<CustomField | null>(null);
  const [newField, setNewField] = useState<Partial<CustomField>>({
    type: 'text',
    required: false,
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
        throw new Error(error.error || 'Failed to save requirements');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/manager/locations/${locationId}/requirements`] });
      toast({ title: 'Success', description: 'Application requirements updated successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const handleToggle = (field: string, value: boolean) => {
    setRequirements(prev => ({ ...prev, [field]: value }));
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

    const field: CustomField = {
      id: `custom_${Date.now()}`,
      label: newField.label!,
      type: newField.type!,
      required: newField.required ?? false,
      placeholder: newField.placeholder,
      options: (newField.type === 'select' || newField.type === 'checkbox') ? newField.options : undefined,
    };

    setRequirements(prev => ({
      ...prev,
      customFields: [...(prev.customFields || []), field],
    }));

    setNewField({ type: 'text', required: false });
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

    const updatedField: CustomField = {
      id: editingField.id,
      label: newField.label!,
      type: newField.type!,
      required: newField.required ?? false,
      placeholder: newField.placeholder,
      options: (newField.type === 'select' || newField.type === 'checkbox') ? newField.options : undefined,
    };

    setRequirements(prev => ({
      ...prev,
      customFields: (prev.customFields || []).map(f => f.id === editingField.id ? updatedField : f),
    }));

    setEditingField(null);
    setNewField({ type: 'text', required: false });
    setShowAddField(false);
  };

  const handleDeleteField = (fieldId: string) => {
    setRequirements(prev => ({
      ...prev,
      customFields: (prev.customFields || []).filter(f => f.id !== fieldId),
    }));
  };

  const handleCancelEdit = () => {
    setEditingField(null);
    setNewField({ type: 'text', required: false });
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
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-1">Application Requirements</h3>
        <p className="text-sm text-gray-600">
          Configure which fields are required for chefs applying to this kitchen. Toggle fields to make them optional.
        </p>
      </div>

      {FIELD_GROUPS.map((group) => (
        <Card key={group.title} className="border border-gray-200">
          <CardContent className="p-6">
            <h4 className="font-medium text-gray-900 mb-4">{group.title}</h4>
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
          </CardContent>
        </Card>
      ))}

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
          {requirements.customFields && requirements.customFields.length > 0 && (
            <div className="space-y-3 mb-4">
              {requirements.customFields.map((field) => (
                <div
                  key={field.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-gray-900">{field.label}</span>
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

              <div className="grid grid-cols-2 gap-4">
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
          className="bg-[#208D80] hover:bg-[#1A7470]"
        >
          {saveMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Save Requirements
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
