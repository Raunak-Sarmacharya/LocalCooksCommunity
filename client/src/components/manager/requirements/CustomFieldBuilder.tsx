/**
 * Custom Field Builder Component
 * Enterprise-grade reusable component for creating and editing custom application fields
 *
 * Renders the list only — the card that hosts it owns the section title, so the
 * builder keeps just the "Add field" action next to it.
 */

import { useState } from "react";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, X, Pencil, Trash2, Type, AlignLeft, Hash, ChevronDown, CheckSquare, Calendar, Upload, Cloud, AlertCircle, PlaylistPlus } from "@/components/ui/manager-icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CustomField, CUSTOM_FIELD_TYPES, COMMON_REQUIREMENT_FIELDS } from "./types";
import { FormLegend } from "@/components/ui/form-legend";

interface CustomFieldBuilderProps {
  fields: CustomField[];
  tier: 1 | 2;
  onFieldsChange: (fields: CustomField[]) => void;
  className?: string;
}

const FIELD_TYPE_ICONS: Record<CustomField['type'], React.ReactNode> = {
  text: <Type className="h-3.5 w-3.5" />,
  textarea: <AlignLeft className="h-3.5 w-3.5" />,
  number: <Hash className="h-3.5 w-3.5" />,
  select: <ChevronDown className="h-3.5 w-3.5" />,
  checkbox: <CheckSquare className="h-3.5 w-3.5" />,
  date: <Calendar className="h-3.5 w-3.5" />,
  file: <Upload className="h-3.5 w-3.5" />,
  cloudflare_upload: <Cloud className="h-3.5 w-3.5" />,
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
      newErrors.label = tt('fieldLabelRequired');
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

  /**
   * One-tap addition of a common request. The resolved label is stored on the
   * field, so it behaves exactly like one the manager typed themselves.
   */
  const addCommonField = (preset: (typeof COMMON_REQUIREMENT_FIELDS)[number]) => {
    const label = mt(preset.key);
    onFieldsChange([
      ...fields,
      {
        id: `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        label,
        type: preset.type,
        required: preset.required ?? false,
        tier,
      },
    ]);
  };

  // Already-asked requests drop out of the picker, so it never offers a duplicate.
  const takenLabels = new Set(fields.map((f) => f.label.trim().toLowerCase()));
  const availableCommonFields = COMMON_REQUIREMENT_FIELDS.filter(
    (preset) => !takenLabels.has(mt(preset.key).trim().toLowerCase()),
  );

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

  return (
    <div className={className}>
      {/* Actions — the hosting card already carries the section title. */}
      <div className="flex flex-wrap items-center justify-end gap-2 px-4 pt-4">
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="gap-1.5">
              <PlaylistPlus className="h-4 w-4" />
              {mt("chooseFromCommon")}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-1.5">
            <div className="min-w-[260px] space-y-1">
              <p className="px-1.5 pb-1 pt-0.5 text-[11px] font-medium text-muted-foreground">
                {mt("commonRequirementFieldsHint")}
              </p>
              {availableCommonFields.length === 0 ? (
                <p className="px-1.5 py-2 text-xs text-muted-foreground">
                  {mt("allCommonRequirementFieldsAdded")}
                </p>
              ) : (
                availableCommonFields.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => addCommonField(preset)}
                    className="!min-h-0 flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-xs transition-colors hover:border-border hover:bg-muted"
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{mt(preset.key)}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {CUSTOM_FIELD_TYPES.find((t) => t.value === preset.type)?.label}
                    </span>
                  </button>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        <Button onClick={openAddDialog} variant="outline" size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          {mt("addField")}
        </Button>
      </div>

      {/* Existing Fields List */}
      {fields.length > 0 ? (
        <div className="divide-y divide-border">
          {fields.map((field) => (
            <div key={field.id} className="group flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {field.label}
                  </span>
                  {field.required && (
                    <span className="text-xs text-muted-foreground">{mt("required")}</span>
                  )}
                </div>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs capitalize text-muted-foreground">
                  {FIELD_TYPE_ICONS[field.type]}
                  {field.type.replace('_', ' ')}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <Button
                  onClick={() => openEditDialog(field)}
                  variant="ghost"
                  size="sm"
                  aria-label={mt("edit")}
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  onClick={() => handleDelete(field.id)}
                  variant="ghost"
                  size="sm"
                  aria-label={mt("delete")}
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="m-4 rounded-xl border border-dashed border-border px-6 py-8 text-center">
          <p className="text-sm font-medium text-foreground">{mt("noCustomFieldsYet")}</p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
            {mt("addCustomFieldsToCollectSpecificInformationUniqueToYourKitch")}
          </p>
        </div>
      )}

      {/* Add/Edit Field Dialog */}
      <Dialog open={editor.isOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editor.editingField ? 'Edit Custom Field' : 'Add Custom Field'}
            </DialogTitle>
            <DialogDescription>
              {editor.editingField
                ? 'Update the field configuration below'
                : 'Configure a new field to collect custom information from applicants'}
            </DialogDescription>
          </DialogHeader>

          <FormLegend />

          <div className="space-y-4 py-4">
            {/* Field Label */}
            <div className="space-y-2">
              <Label htmlFor="field-label" className="text-sm font-medium">{mt("fieldLabel")}<span className="text-destructive">*</span>
              </Label>
              <Input
                id="field-label"
                value={editor.formData.label || ''}
                onChange={(e) => updateFormData({ label: e.target.value })}
                placeholder={mt("eGSpecialtyCuisineTypes")}
                className={errors.label ? 'border-destructive focus-visible:ring-destructive' : ''}
              />
              {errors.label && (
                <p className="flex items-center gap-1 text-xs text-destructive">
                  <AlertCircle className="h-3 w-3" />
                  {errors.label}
                </p>
              )}
            </div>

            {/* Field Type */}
            <div className="space-y-2">
              <Label htmlFor="field-type" className="text-sm font-medium">{mt("fieldType")}<span className="text-destructive">*</span>
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
                <SelectTrigger className={errors.type ? 'border-destructive' : ''}>
                  <SelectValue placeholder={mt("selectFieldType")} />
                </SelectTrigger>
                <SelectContent>
                  {CUSTOM_FIELD_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      <div className="flex items-center gap-2">
                        {FIELD_TYPE_ICONS[type.value as CustomField['type']]}
                        <div>
                          <span className="font-medium">{type.label}</span>
                          <span className="ml-2 text-xs text-muted-foreground">{type.description}</span>
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.type && (
                <p className="flex items-center gap-1 text-xs text-destructive">
                  <AlertCircle className="h-3 w-3" />
                  {errors.type}
                </p>
              )}
            </div>

            {/* Placeholder */}
            <div className="space-y-2">
              <Label htmlFor="field-placeholder" className="text-sm font-medium">{mt("placeholderText")}<span className="text-muted-foreground">{mt("optionalLabel")}</span>
              </Label>
              <Input
                id="field-placeholder"
                value={editor.formData.placeholder || ''}
                onChange={(e) => updateFormData({ placeholder: e.target.value })}
                placeholder={mt("eGEnterYourSpecialtyCuisines")}
              />
            </div>

            {/* Options for Select/Checkbox */}
            {(editor.formData.type === 'select' || editor.formData.type === 'checkbox') && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  {editor.formData.type === 'select' ? 'Dropdown Options' : 'Checkbox Options'}{' '}
                  <span className="text-destructive">*</span>
                </Label>
                <p className="text-xs text-muted-foreground">
                  {editor.formData.type === 'select'
                    ? 'Users will select one option from this list'
                    : 'Users can select multiple options'}
                </p>

                {/* Existing Options */}
                {editor.formData.options && editor.formData.options.length > 0 && (
                  <div className="my-2 space-y-1.5">
                    {editor.formData.options.map((option, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-2 rounded-md bg-muted px-2 py-1.5"
                      >
                        <span className="flex-1 truncate text-sm">{option}</span>
                        <Button
                          onClick={() => removeOption(index)}
                          variant="ghost"
                          size="sm"
                          aria-label={mt("delete")}
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
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
                    placeholder={mt("typeAnOptionAndPressAdd")}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addOption())}
                    className="flex-1"
                  />
                  <Button onClick={addOption} variant="outline" size="sm" disabled={!newOption.trim()} className="gap-1">
                    <Plus className="h-4 w-4" />
                    Add
                  </Button>
                </div>
                {errors.options && (
                  <p className="flex items-center gap-1 text-xs text-destructive">
                    <AlertCircle className="h-3 w-3" />
                    {errors.options}
                  </p>
                )}
              </div>
            )}

            {/* Required Toggle */}
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 p-3">
              <div>
                <Label className="text-sm font-medium">{mt("requiredField")}</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">{mt("applicantsMustCompleteThisFieldToSubmit")}</p>
              </div>
              <Switch
                checked={editor.formData.required ?? false}
                onCheckedChange={(checked) => updateFormData({ required: checked })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>{mt("cancel")}</Button>
            <Button onClick={handleSave}>
              {editor.editingField ? 'Update Field' : 'Add Field'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default CustomFieldBuilder;
