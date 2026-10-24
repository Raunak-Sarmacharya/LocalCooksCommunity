/**
 * The kitchen's (or admin's) own questions for customers.
 *
 * Renders the list only — the card that hosts it owns the section title. Rebuilt Oct 24 (owner) on the pattern
 * Food Corridor, Typeform and Google Forms share: plain answer-type names, help text under a question, a live
 * preview of what the customer sees, reorder, and a confirmed delete. Dated documents (`expires`) are listed with
 * the documents instead, so this list leaves them alone.
 */

import { useState } from "react";
import { mt } from "@/i18n/manager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, X, Pencil, Trash2, ChevronUp, ChevronDown, Calendar, Upload, PlaylistPlus } from "@/components/ui/manager-icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CustomField, QUESTION_KINDS, QuestionKind, questionKind, COMMON_REQUIREMENT_FIELDS } from "./types";

interface CustomFieldBuilderProps {
  fields: CustomField[];
  tier: 1 | 2;
  onFieldsChange: (fields: CustomField[]) => void;
  className?: string;
}

const newId = () => `custom_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
const kindLabel = (kind: QuestionKind) => mt(QUESTION_KINDS.find((k) => k.value === kind)!.labelKey);

/** The question as the customer will see it on their form. */
export function QuestionPreview({ field, kind }: { field: Partial<CustomField>; kind: QuestionKind }) {
  const label = field.label?.trim() || mt("qbPreviewUntitled");
  const options = field.options?.length ? field.options : [mt("qbPreviewOption")];
  return (
    <div className="space-y-2" aria-hidden="true">
      {kind !== "agreement" && (
        <p className="text-sm font-medium text-foreground">
          {label}
          {field.required ? <span className="ml-0.5 text-destructive">*</span> : <span className="ml-1 font-normal text-muted-foreground">{mt("qbOptionalTag")}</span>}
        </p>
      )}
      {field.description?.trim() && kind !== "agreement" && <p className="-mt-1 text-xs leading-5 text-muted-foreground">{field.description}</p>}
      {kind === "text" && <Input tabIndex={-1} readOnly placeholder={field.placeholder} className="h-10 bg-background" />}
      {kind === "textarea" && <Textarea tabIndex={-1} readOnly placeholder={field.placeholder} className="min-h-[72px] resize-none bg-background" />}
      {kind === "number" && <Input tabIndex={-1} readOnly placeholder={field.placeholder || [field.min, field.max].filter((n) => typeof n === "number").join("–")} className="h-10 w-40 bg-background" />}
      {kind === "date" && (
        <div className="flex h-10 w-48 items-center gap-2 rounded-md border bg-background px-3 text-sm text-muted-foreground">
          <Calendar className="h-4 w-4" />{mt("qbPreviewPickDate")}
        </div>
      )}
      {kind === "select" && (
        <div className="flex h-10 items-center justify-between rounded-md border bg-background px-3 text-sm text-muted-foreground">
          {field.placeholder || mt("qbPreviewChoose")}<ChevronDown className="h-4 w-4" />
        </div>
      )}
      {kind === "checkbox" && (
        <div className="space-y-2">
          {options.map((option, index) => (
            <div key={index} className="flex items-center gap-2 text-sm"><Checkbox tabIndex={-1} disabled />{option}</div>
          ))}
        </div>
      )}
      {kind === "agreement" && (
        <div className="space-y-1">
          <div className="flex items-start gap-2 text-sm">
            <Checkbox tabIndex={-1} disabled className="mt-0.5" />
            <span>{field.placeholder?.trim() || mt("qbPreviewAgreement", { label })}{field.required && <span className="ml-0.5 text-destructive">*</span>}</span>
          </div>
          {field.description?.trim() && <p className="pl-6 text-xs leading-5 text-muted-foreground">{field.description}</p>}
        </div>
      )}
      {kind === "file" && (
        <div className="flex items-center gap-3 rounded-xl border border-dashed bg-background px-4 py-3 text-sm text-muted-foreground">
          <Upload className="h-4 w-4" />{mt("qbPreviewUpload")}
        </div>
      )}
    </div>
  );
}

export function CustomFieldBuilder({ fields: allFields, tier, onFieldsChange, className = "" }: CustomFieldBuilderProps) {
  // Dated documents belong to the documents list; this list edits the rest and keeps them as they are.
  const documents = allFields.filter((f) => f.expires);
  const fields = allFields.filter((f) => !f.expires);
  const setFields = (next: CustomField[]) => onFieldsChange([...documents, ...next]);

  const [editing, setEditing] = useState<{ id: string | null; kind: QuestionKind; data: Partial<CustomField> } | null>(null);
  const [newOption, setNewOption] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<CustomField | null>(null);
  // The item stays set while the dialog animates closed, so its name doesn't blank out.
  const [pendingDeleteOpen, setPendingDeleteOpen] = useState(false);

  const open = (field?: CustomField) => {
    setEditing(field ? { id: field.id, kind: questionKind(field), data: { ...field } } : { id: null, kind: "text", data: { required: false, tier } });
    setNewOption("");
    setErrors({});
  };
  const update = (data: Partial<CustomField>) => {
    setEditing((prev) => prev && { ...prev, data: { ...prev.data, ...data } });
    setErrors({});
  };

  const save = () => {
    if (!editing) return;
    const { kind, data } = editing;
    const next: Record<string, string> = {};
    if (!data.label?.trim()) next.label = mt("qbErrorQuestion");
    if ((kind === "select" || kind === "checkbox") && !data.options?.length) next.options = mt("qbErrorOptions");
    if (kind === "agreement" && !data.placeholder?.trim()) next.placeholder = mt("qbErrorStatement");
    if (kind === "number" && typeof data.min === "number" && typeof data.max === "number" && data.min > data.max) next.max = mt("qbErrorRange");
    setErrors(next);
    if (Object.keys(next).length) return;

    const field: CustomField = {
      id: editing.id ?? newId(),
      label: data.label!.trim(),
      // An agreement is a single checkbox with no options, which the form and server already treat as "tick to confirm".
      type: kind === "agreement" ? "checkbox" : kind === "file" && data.type === "cloudflare_upload" ? "cloudflare_upload" : kind,
      required: data.required ?? false,
      tier,
      ...(data.description?.trim() ? { description: data.description.trim() } : {}),
      ...(["text", "textarea", "number", "select", "agreement", "file"].includes(kind) && data.placeholder?.trim() ? { placeholder: data.placeholder.trim() } : {}),
      ...(kind === "select" || kind === "checkbox" ? { options: data.options } : {}),
      ...(kind === "number" && typeof data.min === "number" ? { min: data.min } : {}),
      ...(kind === "number" && typeof data.max === "number" ? { max: data.max } : {}),
      ...(kind === "date" && data.futureOnly ? { futureOnly: true } : {}),
    };
    setFields(editing.id ? fields.map((f) => (f.id === editing.id ? field : f)) : [...fields, field]);
    setEditing(null);
  };

  const move = (index: number, by: -1 | 1) => {
    const next = [...fields];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    setFields(next);
  };

  const addCommonField = (preset: (typeof COMMON_REQUIREMENT_FIELDS)[number]) =>
    setFields([...fields, { id: newId(), label: mt(preset.key), type: preset.type, required: preset.required ?? false, tier }]);
  // Already-asked requests drop out of the picker, so it never offers a duplicate.
  const takenLabels = new Set(fields.map((f) => f.label.trim().toLowerCase()));
  const availableCommonFields = COMMON_REQUIREMENT_FIELDS.filter((preset) => !takenLabels.has(mt(preset.key).trim().toLowerCase()));

  const addOption = () => {
    const option = newOption.trim();
    if (!option || !editing) return;
    update({ options: [...(editing.data.options || []), option] });
    setNewOption("");
  };
  const numberOrUndefined = (value: string) => (value.trim() === "" || isNaN(Number(value)) ? undefined : Number(value));

  const kind = editing?.kind;
  const data = editing?.data ?? {};
  const errorText = (key: string) => errors[key] ? <p className="text-xs text-destructive">{errors[key]}</p> : null;

  return (
    <div className={`space-y-3 p-4 sm:p-5 ${className}`}>
      {fields.length > 0 ? (
        <ol className="divide-y rounded-xl border">
          {fields.map((field, index) => (
            <li key={field.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium text-foreground">{field.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {kindLabel(questionKind(field))} · {field.required ? mt("qbRequired") : mt("qbOptional")}
                </p>
                {field.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{field.description}</p>}
              </div>
              <div className="flex shrink-0 items-center">
                <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground" disabled={index === 0} onClick={() => move(index, -1)} aria-label={mt("qbMoveUp", { label: field.label })}>
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground" disabled={index === fields.length - 1} onClick={() => move(index, 1)} aria-label={mt("qbMoveDown", { label: field.label })}>
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground" onClick={() => open(field)} aria-label={mt("qbEdit", { label: field.label })}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={() => { setPendingDelete(field); setPendingDeleteOpen(true); }} aria-label={mt("qbDelete", { label: field.label })}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="rounded-xl border border-dashed px-4 py-6 text-center">
          <p className="text-sm font-medium text-foreground">{mt("qbEmptyTitle")}</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">{mt("qbEmptyBody")}</p>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button type="button" onClick={() => open()} variant="outline" size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />{mt("qbAddQuestion")}
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="gap-1.5">
              <PlaylistPlus className="h-4 w-4" />{mt("qbChooseCommon")}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] p-1.5">
            <p className="px-1.5 pb-1 pt-0.5 text-[11px] font-medium text-muted-foreground">{mt("qbCommonHint")}</p>
            {availableCommonFields.length === 0 ? (
              <p className="px-1.5 py-2 text-xs text-muted-foreground">{mt("allCommonRequirementFieldsAdded")}</p>
            ) : availableCommonFields.map((preset) => (
              <button key={preset.key} type="button" onClick={() => addCommonField(preset)}
                className="!min-h-0 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted">
                <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{mt(preset.key)}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{kindLabel(questionKind({ type: preset.type }))}</span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>

      <Dialog open={editing !== null} onOpenChange={(isOpen) => !isOpen && setEditing(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? mt("qbEditTitle") : mt("qbAddTitle")}</DialogTitle>
            <DialogDescription>{mt("qbDialogLead")}</DialogDescription>
          </DialogHeader>

          {editing && kind && (
            <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="qb-label">{kind === "agreement" ? mt("qbAgreementName") : mt("qbQuestion")}</Label>
                  <Input id="qb-label" value={data.label || ""} onChange={(e) => update({ label: e.target.value })}
                    placeholder={kind === "agreement" ? mt("qbAgreementNamePlaceholder") : mt("qbQuestionPlaceholder")} aria-invalid={!!errors.label} />
                  {errorText("label")}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="qb-kind">{mt("qbAnswerType")}</Label>
                  <Select value={kind} onValueChange={(value: QuestionKind) => setEditing({ ...editing, kind: value, data: { ...data, options: value === "select" || value === "checkbox" ? data.options ?? [] : undefined } })}>
                    <SelectTrigger id="qb-kind"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {QUESTION_KINDS.map((k) => (
                        <SelectItem key={k.value} value={k.value}>{mt(k.labelKey)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{mt(QUESTION_KINDS.find((k) => k.value === kind)!.hintKey)}</p>
                </div>

                {kind === "agreement" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="qb-statement">{mt("qbStatement")}</Label>
                    <Textarea id="qb-statement" value={data.placeholder || ""} onChange={(e) => update({ placeholder: e.target.value })}
                      placeholder={mt("qbStatementPlaceholder")} className="min-h-[64px]" aria-invalid={!!errors.placeholder} />
                    {errorText("placeholder")}
                  </div>
                )}

                {(kind === "select" || kind === "checkbox") && (
                  <div className="space-y-1.5">
                    <Label htmlFor="qb-option">{mt("qbChoices")}</Label>
                    {!!data.options?.length && (
                      <ul className="space-y-1">
                        {data.options.map((option, index) => (
                          <li key={index} className="flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1 text-sm">
                            <span className="min-w-0 flex-1 truncate">{option}</span>
                            <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground" aria-label={mt("qbRemoveChoice", { option })}
                              onClick={() => update({ options: data.options!.filter((_, i) => i !== index) })}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex gap-2">
                      <Input id="qb-option" value={newOption} onChange={(e) => setNewOption(e.target.value)} placeholder={mt("qbChoicePlaceholder")}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOption(); } }} />
                      <Button type="button" variant="outline" size="sm" className="h-10" disabled={!newOption.trim()} onClick={addOption}>{mt("qbAddChoice")}</Button>
                    </div>
                    {errorText("options")}
                  </div>
                )}

                {kind === "number" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="qb-min">{mt("qbMin")}</Label>
                      <Input id="qb-min" type="number" inputMode="decimal" value={data.min ?? ""} onChange={(e) => update({ min: numberOrUndefined(e.target.value) })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="qb-max">{mt("qbMax")}</Label>
                      <Input id="qb-max" type="number" inputMode="decimal" value={data.max ?? ""} onChange={(e) => update({ max: numberOrUndefined(e.target.value) })} aria-invalid={!!errors.max} />
                    </div>
                    <div className="col-span-2">{errorText("max")}</div>
                  </div>
                )}

                {kind === "date" && (
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor="qb-future" className="font-normal">{mt("qbFutureOnly")}</Label>
                    <Switch id="qb-future" checked={!!data.futureOnly} onCheckedChange={(checked) => update({ futureOnly: checked })} />
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="qb-help">{mt("qbHelpText")} <span className="font-normal text-muted-foreground">{mt("qbOptionalTag")}</span></Label>
                  <Textarea id="qb-help" value={data.description || ""} onChange={(e) => update({ description: e.target.value })}
                    placeholder={mt("qbHelpTextPlaceholder")} className="min-h-[64px]" maxLength={500} />
                </div>

                {(kind === "text" || kind === "textarea" || kind === "number") && (
                  <div className="space-y-1.5">
                    <Label htmlFor="qb-placeholder">{mt("qbExample")} <span className="font-normal text-muted-foreground">{mt("qbOptionalTag")}</span></Label>
                    <Input id="qb-placeholder" value={data.placeholder || ""} onChange={(e) => update({ placeholder: e.target.value })} placeholder={mt("qbExamplePlaceholder")} />
                  </div>
                )}

                <div className="flex items-center justify-between gap-4 border-t pt-4">
                  <div>
                    <Label htmlFor="qb-required">{mt("qbRequiredToggle")}</Label>
                    <p className="text-xs text-muted-foreground">{kind === "agreement" ? mt("qbRequiredAgreementHint") : mt("qbRequiredHint")}</p>
                  </div>
                  <Switch id="qb-required" checked={!!data.required} onCheckedChange={(checked) => update({ required: checked })} />
                </div>
              </div>

              <div className="rounded-xl bg-muted/50 p-4 sm:self-start">
                <p className="mb-3 text-xs font-medium text-muted-foreground">{mt("qbPreviewTitle")}</p>
                <div className="rounded-lg border bg-card p-4"><QuestionPreview field={data} kind={kind} /></div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>{mt("cancel")}</Button>
            <Button type="button" onClick={save}>{editing?.id ? mt("qbSave") : mt("qbAdd")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pendingDeleteOpen} onOpenChange={setPendingDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{mt("qbDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{mt("qbDeleteBody", { label: pendingDelete?.label ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{mt("qbKeep")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (pendingDelete) setFields(fields.filter((f) => f.id !== pendingDelete.id)); setPendingDeleteOpen(false); }}>
              {mt("qbDeleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default CustomFieldBuilder;
