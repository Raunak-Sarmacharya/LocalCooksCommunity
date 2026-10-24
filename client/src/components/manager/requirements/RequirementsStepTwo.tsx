/**
 * Kitchen Documents — the manager-owned half of the chef application.
 *
 * Deliberately header-free past the card titles: the page hosting this already
 * names the surface, so a step heading, a compliance callout, a heading per
 * field group and a heading above the custom-field list were four levels of
 * copy all saying the same thing. One card, one row per requirement.
 */

import { Switch } from "@/components/ui/switch";
import { mt } from "@/i18n/manager";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SettingsRow } from "@/components/manager/settings/SettingsRow";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Upload, Calendar } from "@/components/ui/manager-icons";
import { CustomFieldBuilder } from "./CustomFieldBuilder";
import { SegmentedControl } from "@/components/manager/revenue/components/SegmentedControl";
import { LocationRequirements, CustomField, STEP2_BUILT_IN_FIELDS, KITCHEN_EXPERIENCE_FIELD } from "./types";

interface RequirementsStepTwoProps {
  requirements: Partial<LocationRequirements>;
  onRequirementsChange: (updates: Partial<LocationRequirements>) => void;
}

/** Groups exist for the config shape; the rows themselves read as one list. */
const FIELD_ROWS = STEP2_BUILT_IN_FIELDS.flatMap((group) => group.fields);
const SAFETY_KEY = 'requireFoodHandlerCert';
const ESTABLISHMENT_KEY = 'tier2_food_establishment_cert_required';
const isComplianceField = (key: keyof LocationRequirements) => key === SAFETY_KEY || key === ESTABLISHMENT_KEY;
/** The three dated documents: each is Not needed, Track it (date and reminders, never pauses booking) or Required. */
const TRACKED_KEY: Partial<Record<keyof LocationRequirements, keyof LocationRequirements>> = {
  requireFoodHandlerCert: 'food_handler_cert_tracked',
  tier2_food_establishment_cert_required: 'food_establishment_cert_tracked',
  tier2_insurance_document_required: 'insurance_tracked',
};
type DocumentMode = 'none' | 'track' | 'required';
const COMPLIANCE_HELP = {
  [SAFETY_KEY]: {
    text: 'Newfoundland and Labrador requires current food safety training to be present at covered licensed food premises. We ask customers for their certificate and expiry date to help kitchens check coverage.',
    url: 'https://www.gov.nl.ca/hcs/publichealth/envhealth/foodsafetytraining/',
    link: 'NL food safety training rules',
  },
  [ESTABLISHMENT_KEY]: {
    text: 'A Food Establishment Licence applies to the licensed person and premises. Ask the customer for their licence for this kitchen when their operation requires one.',
    url: 'https://www.gov.nl.ca/gs/licences/env-health/food/premises/',
    link: 'NL Food Establishment Licence',
  },
};

export function RequirementsStepTwo({
  requirements,
  onRequirementsChange,
}: RequirementsStepTwoProps) {
  const [pendingDisable, setPendingDisable] = useState<keyof LocationRequirements | null>(null);
  
  const modeOf = (key: keyof LocationRequirements): DocumentMode =>
    requirements[key] === true ? 'required' : requirements[TRACKED_KEY[key]!] === true ? 'track' : 'none';
  const setMode = (key: keyof LocationRequirements, mode: DocumentMode) => {
    if (mode === 'none' && isComplianceField(key)) { setPendingDisable(key); return; }
    applyMode(key, mode);
  };
  function applyMode(key: keyof LocationRequirements, mode: DocumentMode) {
    const updates: Partial<LocationRequirements> = { [key]: mode === 'required', [TRACKED_KEY[key]!]: mode === 'track' };
    // The certificate's date is collected whenever the certificate is asked for.
    if (key === SAFETY_KEY) updates.requireFoodHandlerExpiry = mode !== 'none';
    onRequirementsChange(updates);
  }

  const handleCustomFieldsChange = (fields: CustomField[]) => {
    onRequirementsChange({ tier2_custom_fields: fields });
  };

  const tier2CustomFields = (requirements.tier2_custom_fields as CustomField[]) || [];
  // The kitchen's own dated documents (owner, Oct 24): a file upload with an expiry date, Track it or Required.
  const ownDocuments = tier2CustomFields.filter((field) => field.expires);
  const [documentEditor, setDocumentEditor] = useState<{ id: string | null; label: string; description: string; mode: 'track' | 'required' } | null>(null);
  const [documentError, setDocumentError] = useState(false);
  const [pendingDocumentDelete, setPendingDocumentDelete] = useState<CustomField | null>(null);
  // The item stays set while the dialog animates closed, so its name doesn't blank out.
  const [pendingDocumentDeleteOpen, setPendingDocumentDeleteOpen] = useState(false);
  const saveDocument = () => {
    if (!documentEditor) return;
    if (!documentEditor.label.trim()) { setDocumentError(true); return; }
    const document: CustomField = {
      id: documentEditor.id ?? `custom_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      label: documentEditor.label.trim(), type: 'file', tier: 2, expires: true,
      mode: documentEditor.mode, required: documentEditor.mode === 'required',
      ...(documentEditor.description.trim() ? { description: documentEditor.description.trim() } : {}),
    };
    handleCustomFieldsChange(documentEditor.id
      ? tier2CustomFields.map((field) => (field.id === documentEditor.id ? document : field))
      : [...tier2CustomFields, document]);
    setDocumentEditor(null);
  };
  const setDocumentMode = (document: CustomField, mode: 'track' | 'required') =>
    handleCustomFieldsChange(tier2CustomFields.map((field) => (field.id === document.id ? { ...field, mode, required: mode === 'required' } : field)));
  const modeOptions = [{ value: 'none' as const, label: mt("docModeNone") }, { value: 'track' as const, label: mt("docModeTrack") }, { value: 'required' as const, label: mt("docModeRequired") }];
  const ownModeOptions = modeOptions.filter((option): option is { value: 'track' | 'required'; label: string } => option.value !== 'none');

  return (
    <div className="space-y-6">
      {/* Built-in requirements */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-lg">{mt("step2Documents")}</CardTitle>
          <CardDescription>{mt("documentModesHelp")}</CardDescription>
        </CardHeader>

        <CardContent className="divide-y divide-border p-0">
          {FIELD_ROWS.filter((field) => TRACKED_KEY[field.key]).map((field) => {
            const controlId = `requirement-${String(field.key)}`;
            const complianceHelp = isComplianceField(field.key) ? COMPLIANCE_HELP[field.key as typeof SAFETY_KEY | typeof ESTABLISHMENT_KEY] : null;
            // "Recommended" is guidance, not state — it belongs on the hint line
            // rather than in a second badge competing with the toggle.
            const hint = field.recommended
              ? `${field.description ?? ""}${field.description ? " · " : ""}${mt("recommended")}`
              : field.description;

            const mode = modeOf(field.key);
              return (
                <SettingsRow key={field.key} id={controlId} label={field.label} hint={hint}
                  badge={complianceHelp && <Badge variant="secondary" className="text-[10px] font-medium">Compliance</Badge>}
                  help={complianceHelp && <span>{complianceHelp.text} <a href={complianceHelp.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">{complianceHelp.link}</a></span>}>
                  <SegmentedControl<DocumentMode> label={field.label} value={mode} onChange={(next) => setMode(field.key, next)} options={modeOptions} />
                </SettingsRow>
              );
          })}
          {ownDocuments.map((document) => (
            <SettingsRow key={document.id} label={document.label} hint={document.description || mt("qbOwnDocumentHint")}>
              <div className="flex items-center gap-1">
                <SegmentedControl<'track' | 'required'> label={document.label} value={document.required ? 'required' : 'track'}
                  onChange={(next) => setDocumentMode(document, next)} options={ownModeOptions} />
                <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground" aria-label={mt("qbEdit", { label: document.label })}
                  onClick={() => { setDocumentError(false); setDocumentEditor({ id: document.id, label: document.label, description: document.description ?? '', mode: document.required ? 'required' : 'track' }); }}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" aria-label={mt("qbDelete", { label: document.label })}
                  onClick={() => { setPendingDocumentDelete(document); setPendingDocumentDeleteOpen(true); }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </SettingsRow>
          ))}
          <div className="px-4 py-3">
            <Button type="button" variant="outline" size="sm" className="gap-1.5"
              onClick={() => { setDocumentError(false); setDocumentEditor({ id: null, label: '', description: '', mode: 'track' }); }}>
              <Plus className="h-4 w-4" />{mt("qbAddDocument")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={documentEditor !== null} onOpenChange={(open) => { if (!open) setDocumentEditor(null); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{documentEditor?.id ? mt("qbEditDocumentTitle") : mt("qbAddDocumentTitle")}</DialogTitle>
            <DialogDescription>{mt("qbDocumentLead")}</DialogDescription>
          </DialogHeader>
          {documentEditor && (
            <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="doc-label">{mt("qbDocumentName")}</Label>
                  <Input id="doc-label" value={documentEditor.label} placeholder={mt("qbDocumentNamePlaceholder")} aria-invalid={documentError}
                    onChange={(e) => { setDocumentError(false); setDocumentEditor({ ...documentEditor, label: e.target.value }); }} />
                  {documentError && <p className="text-xs text-destructive">{mt("qbErrorDocumentName")}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="doc-help">{mt("qbHelpText")} <span className="font-normal text-muted-foreground">{mt("qbOptionalTag")}</span></Label>
                  <Textarea id="doc-help" value={documentEditor.description} maxLength={500} placeholder={mt("qbDocumentHelpPlaceholder")} className="min-h-[64px]"
                    onChange={(e) => setDocumentEditor({ ...documentEditor, description: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>{mt("qbDocumentMode")}</Label>
                  <SegmentedControl<'track' | 'required'> label={mt("qbDocumentMode")} value={documentEditor.mode}
                    onChange={(mode) => setDocumentEditor({ ...documentEditor, mode })} options={ownModeOptions} />
                  <p className="text-xs text-muted-foreground">{documentEditor.mode === 'required' ? mt("qbDocumentRequiredHint") : mt("qbDocumentTrackHint")}</p>
                </div>
              </div>
              <div className="rounded-xl bg-muted/50 p-4 sm:self-start" aria-hidden="true">
                <p className="mb-3 text-xs font-medium text-muted-foreground">{mt("qbPreviewTitle")}</p>
                <div className="space-y-2 rounded-lg border bg-card p-4">
                  <p className="text-sm font-medium">{documentEditor.label.trim() || mt("qbPreviewUntitledDocument")}
                    {documentEditor.mode === 'required' ? <span className="ml-0.5 text-destructive">*</span> : <span className="ml-1 font-normal text-muted-foreground">{mt("qbOptionalTag")}</span>}</p>
                  {documentEditor.description.trim() && <p className="-mt-1 text-xs leading-5 text-muted-foreground">{documentEditor.description}</p>}
                  <div className="flex items-center gap-3 rounded-xl border border-dashed bg-background px-4 py-3 text-sm text-muted-foreground"><Upload className="h-4 w-4" />{mt("qbPreviewUpload")}</div>
                  <p className="pt-1 text-xs font-medium">{mt("qbPreviewExpiry")}</p>
                  <div className="flex h-10 w-48 items-center gap-2 rounded-md border bg-background px-3 text-sm text-muted-foreground"><Calendar className="h-4 w-4" />{mt("qbPreviewPickDate")}</div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDocumentEditor(null)}>{mt("cancel")}</Button>
            <Button type="button" onClick={saveDocument}>{documentEditor?.id ? mt("qbSave") : mt("qbAddDocument")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pendingDocumentDeleteOpen} onOpenChange={setPendingDocumentDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{mt("qbDeleteDocumentTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{mt("qbDeleteDocumentBody", { label: pendingDocumentDelete?.label ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{mt("qbKeep")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (pendingDocumentDelete) handleCustomFieldsChange(tier2CustomFields.filter((field) => field.id !== pendingDocumentDelete.id)); setPendingDocumentDeleteOpen(false); }}>
              {mt("qbDeleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingDisable !== null} onOpenChange={(open) => { if (!open) setPendingDisable(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this kitchen requirement?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDisable && COMPLIANCE_HELP[pendingDisable as typeof SAFETY_KEY | typeof ESTABLISHMENT_KEY]?.text}
              {' '}We strongly recommend keeping this document in the customer application.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingDisable && <a href={COMPLIANCE_HELP[pendingDisable as typeof SAFETY_KEY | typeof ESTABLISHMENT_KEY].url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">Read the Newfoundland and Labrador government website</a>}
          <AlertDialogFooter>
            <AlertDialogCancel>Keep requirement</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (pendingDisable) handleConfirmedDisable(pendingDisable); }}>Turn off</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Custom questions */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-lg">{mt("qbQuestionsTitle")}</CardTitle>
          <CardDescription>{mt("qbQuestionsLead")}</CardDescription>
        </CardHeader>

        <CardContent className="p-0">
          <div className="border-b">
            <SettingsRow id="requirement-kitchen-experience" label={KITCHEN_EXPERIENCE_FIELD.label} hint={mt("qbKitchenExperienceHint")}>
              <div className="flex items-center gap-3">
                <span className={cn("text-xs font-medium", requirements.tier2_kitchen_experience_required ? "text-foreground" : "text-muted-foreground")}>
                  {requirements.tier2_kitchen_experience_required ? mt("qbAskedRequired") : mt("qbNotAsked")}
                </span>
                <Switch id="requirement-kitchen-experience" checked={requirements.tier2_kitchen_experience_required === true}
                  onCheckedChange={(checked) => onRequirementsChange({ tier2_kitchen_experience_required: checked })} />
              </div>
            </SettingsRow>
          </div>
          <CustomFieldBuilder
            fields={tier2CustomFields}
            tier={2}
            onFieldsChange={handleCustomFieldsChange}
          />
        </CardContent>
      </Card>
    </div>
  );

  function handleConfirmedDisable(key: keyof LocationRequirements) {
    applyMode(key, 'none');
    setPendingDisable(null);
  }
}

export default RequirementsStepTwo;
