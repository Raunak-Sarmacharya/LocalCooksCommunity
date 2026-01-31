/**
 * Custom Field Builder Component
 * Enterprise-grade reusable component for creating and editing custom application fields
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Plus,
  X,
  Pencil,
  Trash2,
  GripVertical,
  Type,
  AlignLeft,
  Hash,
  ChevronDown,
  CheckSquare,
  Calendar,
  Upload,
  Cloud,
  AlertCircle,
} from 'lucide-react';
import { CustomField, CUSTOM_FIELD_TYPES } from './types';

interface CustomFieldBuilderProps {
  fields: CustomField[];
  tier: 1 | 2;
  onFieldsChange: (fields: CustomField[]) => void;
  className?: string;
}

const FIELD_TYPE_ICONS: Record<CustomField['type'], React.ReactNode> = {
  text: <Type className="h-4 w-4" />,
  textarea: <AlignLeft className="h-4 w-4" />,
  number: <Hash className="h-4 w-4" />,
  select: <ChevronDown className="h-4 w-4" />,
  checkbox: <CheckSquare className="h-4 w-4" />,
  date: <Calendar className="h-4 w-4" />,
  file: <Upload className="h-4 w-4" />,
  cloudflare_upload: <Cloud className="h-4 w-4" />,
};

interface FieldEditorState {
  isOpen: boolean;
  editingField: CustomField | null;
  formData: Partial<CustomField>;
}

export function CustomFieldBuilder({
  fields,
  tier,
  onFieldsChange,
  className = '',
}: CustomFieldBuilderProps) {
  const [editor, setEditor] = useState<FieldEditorState>({
    isOpen: false,
    editingField: null,
    formData: { type: 'text', required: false, tier, options: [] },
  });
  const [newOption, setNewOption] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const openAddDialog = () => {
    setEditor({
      isOpen: true,
      editingField: null,
      formData: { type: 'text', required: false, tier, options: [] },
    });
    setErrors({});
  };

  const openEditDialog = (field: CustomField) => {
    setEditor({
      isOpen: true,
      editingField: field,
      formData: { ...field },
    });
    setErrors({});
  };

  const closeDialog = () => {
    setEditor({
      isOpen: false,
      editingField: null,
      formData: { type: 'text', required: false, tier, options: [] },
    });
    setNewOption('');
    setErrors({});
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!editor.formData.label?.trim()) {
      newErrors.label = 'Field label is required';
    }

    if (!editor.formData.type) {
      newErrors.type = 'Please select a field type';
    }

    if (
      (editor.formData.type === 'select' || editor.formData.type === 'checkbox') &&
      (!editor.formData.options || editor.formData.options.length === 0)
    ) {
      newErrors.options = `Please add at least one option for ${editor.formData.type === 'select' ? 'dropdown' : 'checkbox'} fields`;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!validateForm()) return;

    const fieldData: CustomField = {
      id: editor.editingField?.id || `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      label: editor.formData.label!.trim(),
      type: editor.formData.type!,
      required: editor.formData.required ?? false,
      placeholder: editor.formData.placeholder?.trim() || undefined,
      options:
        editor.formData.type === 'select' || editor.formData.type === 'checkbox'
          ? editor.formData.options
          : undefined,
      tier,
    };

    if (editor.editingField) {
      onFieldsChange(fields.map((f) => (f.id === editor.editingField!.id ? fieldData : f)));
    } else {
      onFieldsChange([...fields, fieldData]);
    }

    closeDialog();
  };

  const handleDelete = (fieldId: string) => {
    onFieldsChange(fields.filter((f) => f.id !== fieldId));
  };

  const addOption = () => {
    if (!newOption.trim()) return;
    setEditor((prev) => ({
      ...prev,
      formData: {
        ...prev.formData,
        options: [...(prev.formData.options || []), newOption.trim()],
      },
    }));
    setNewOption('');
    if (errors.options) {
      setErrors((prev) => ({ ...prev, options: '' }));
    }
  };

  const removeOption = (index: number) => {
    setEditor((prev) => ({
      ...prev,
      formData: {
        ...prev.formData,
        options: prev.formData.options?.filter((_, i) => i !== index) || [],
      },
    }));
  };

  const updateFormData = (updates: Partial<CustomField>) => {
    setEditor((prev) => ({
      ...prev,
      formData: { ...prev.formData, ...updates },
    }));
    // Clear related errors
    Object.keys(updates).forEach((key) => {
      if (errors[key]) {
        setErrors((prev) => ({ ...prev, [key]: '' }));
      }
    });
  };

  const tierLabel = tier === 1 ? 'Step 1' : 'Step 2';

  return (
    <div className={className}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Custom Fields
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Add your own questions specific to your kitchen
          </p>
        </div>
        <Button
          onClick={openAddDialog}
          size="sm"
          className="bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white shadow-sm"
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Add Field
        </Button>
      </div>

      {/* Existing Fields List */}
      {fields.length > 0 ? (
        <div className="space-y-2">
          {fields.map((field) => (
            <div
              key={field.id}
              className={`
                group flex items-center gap-3 p-3 rounded-lg border transition-all
                ${tier === 1 
                  ? 'bg-blue-50/50 border-blue-200/60 dark:bg-blue-950/20 dark:border-blue-800/40 hover:border-blue-300 dark:hover:border-blue-700' 
                  : 'bg-emerald-50/50 border-emerald-200/60 dark:bg-emerald-950/20 dark:border-emerald-800/40 hover:border-emerald-300 dark:hover:border-emerald-700'}
              `}
            >
              <div className="text-slate-400 dark:text-slate-500 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity">
                <GripVertical className="h-4 w-4" />
              </div>

              <div className="flex items-center justify-center h-8 w-8 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                {FIELD_TYPE_ICONS[field.type]}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-slate-900 dark:text-slate-100 truncate">
                    {field.label}
                  </span>
                  {field.required && (
                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">
                      Required
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-slate-500 dark:text-slate-400 capitalize">
                    {field.type.replace('_', ' ')}
                  </span>
                  {field.options && field.options.length > 0 && (
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      ({field.options.length} options)
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  onClick={() => openEditDialog(field)}
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  onClick={() => handleDelete(field.id)}
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-8 px-4 rounded-lg border-2 border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30">
          <div className="h-10 w-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
            <Plus className="h-5 w-5 text-slate-400" />
          </div>
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
            No custom fields yet
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-500 mt-1 text-center max-w-xs">
            Add custom fields to collect specific information unique to your kitchen requirements
          </p>
        </div>
      )}

      {/* Add/Edit Field Dialog */}
      <Dialog open={editor.isOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editor.editingField ? 'Edit Custom Field' : 'Add Custom Field'}
              <Badge
                variant="outline"
                className={`text-xs ${
                  tier === 1
                    ? 'border-blue-200 text-blue-700 bg-blue-50'
                    : 'border-emerald-200 text-emerald-700 bg-emerald-50'
                }`}
              >
                {tierLabel}
              </Badge>
            </DialogTitle>
            <DialogDescription>
              {editor.editingField
                ? 'Update the field configuration below'
                : 'Configure a new field to collect custom information from applicants'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Field Label */}
            <div className="space-y-2">
              <Label htmlFor="field-label" className="text-sm font-medium">
                Field Label <span className="text-red-500">*</span>
              </Label>
              <Input
                id="field-label"
                value={editor.formData.label || ''}
                onChange={(e) => updateFormData({ label: e.target.value })}
                placeholder="e.g., Specialty Cuisine Types"
                className={errors.label ? 'border-red-500 focus-visible:ring-red-500' : ''}
              />
              {errors.label && (
                <p className="text-xs text-red-500 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {errors.label}
                </p>
              )}
            </div>

            {/* Field Type */}
            <div className="space-y-2">
              <Label htmlFor="field-type" className="text-sm font-medium">
                Field Type <span className="text-red-500">*</span>
              </Label>
              <Select
                value={editor.formData.type}
                onValueChange={(value: CustomField['type']) =>
                  updateFormData({
                    type: value,
                    options: value === 'select' || value === 'checkbox' ? [] : undefined,
                  })
                }
              >
                <SelectTrigger className={errors.type ? 'border-red-500' : ''}>
                  <SelectValue placeholder="Select field type" />
                </SelectTrigger>
                <SelectContent>
                  {CUSTOM_FIELD_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      <div className="flex items-center gap-2">
                        {FIELD_TYPE_ICONS[type.value as CustomField['type']]}
                        <div>
                          <span className="font-medium">{type.label}</span>
                          <span className="text-xs text-slate-500 ml-2">{type.description}</span>
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.type && (
                <p className="text-xs text-red-500 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {errors.type}
                </p>
              )}
            </div>

            {/* Placeholder */}
            <div className="space-y-2">
              <Label htmlFor="field-placeholder" className="text-sm font-medium">
                Placeholder Text <span className="text-slate-400">(optional)</span>
              </Label>
              <Input
                id="field-placeholder"
                value={editor.formData.placeholder || ''}
                onChange={(e) => updateFormData({ placeholder: e.target.value })}
                placeholder="e.g., Enter your specialty cuisines..."
              />
            </div>

            {/* Options for Select/Checkbox */}
            {(editor.formData.type === 'select' || editor.formData.type === 'checkbox') && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  {editor.formData.type === 'select' ? 'Dropdown Options' : 'Checkbox Options'}{' '}
                  <span className="text-red-500">*</span>
                </Label>
                <p className="text-xs text-slate-500">
                  {editor.formData.type === 'select'
                    ? 'Users will select one option from this list'
                    : 'Users can select multiple options'}
                </p>

                {/* Existing Options */}
                {editor.formData.options && editor.formData.options.length > 0 && (
                  <div className="space-y-1.5 my-2">
                    {editor.formData.options.map((option, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-800 rounded-md"
                      >
                        <span className="flex-1 text-sm truncate">{option}</span>
                        <Button
                          onClick={() => removeOption(index)}
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add New Option */}
                <div className="flex gap-2">
                  <Input
                    value={newOption}
                    onChange={(e) => setNewOption(e.target.value)}
                    placeholder="Type an option and press Add"
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addOption())}
                    className="flex-1"
                  />
                  <Button onClick={addOption} variant="outline" size="sm" disabled={!newOption.trim()}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add
                  </Button>
                </div>
                {errors.options && (
                  <p className="text-xs text-red-500 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.options}
                  </p>
                )}
              </div>
            )}

            {/* Required Toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
              <div>
                <Label className="text-sm font-medium">Required Field</Label>
                <p className="text-xs text-slate-500 mt-0.5">
                  Applicants must complete this field to submit
                </p>
              </div>
              <Switch
                checked={editor.formData.required ?? false}
                onCheckedChange={(checked) => updateFormData({ required: checked })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              className="bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700"
            >
              {editor.editingField ? 'Update Field' : 'Add Field'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default CustomFieldBuilder;
