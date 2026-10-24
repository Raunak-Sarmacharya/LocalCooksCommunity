/**
 * The kitchen's controls under "Access and documents" (owner, Oct 23): whether this customer needs documents at all
 * (with the kitchen confirming responsibility when it waives them), and adding a document for them (a paper copy, a
 * walk-in), which counts as approved by the kitchen.
 */
import { useState } from 'react';
import { mt } from '@/i18n/manager';
import { useToast } from '@/hooks/use-toast';
import type { CustomerDocument } from './customer-types';
import { SegmentedControl } from '@/components/manager/revenue/components/SegmentedControl';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { DateField } from '@/components/ui/date-field';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useAddCustomerDocument, useDocumentWaiver } from './use-customers';
import { documentLabel } from './customer-format';

type DocKey = string;
const BUILT_IN = ['foodSafetyLicense', 'foodEstablishmentCert', 'insurance'];

export function CustomerDocumentActions({ applicationId, name, waivedAt, canChange, documents = [] }: { applicationId: number; name: string; waivedAt: string | null; canChange: boolean; documents?: CustomerDocument[] }) {
  // The built-in three, then each document this kitchen added; one without an expiry date needs no date here.
  const choices = [...BUILT_IN.map(value => ({ value, label: documentLabel(mt, value), hasExpiry: true })),
    ...documents.filter(doc => doc.key.startsWith('custom:')).map(doc => ({ value: doc.key, label: doc.label || documentLabel(mt, doc.key), hasExpiry: doc.hasExpiry !== false }))];
  const { toast } = useToast();
  const waiver = useDocumentWaiver();
  const add = useAddCustomerDocument();
  const [confirming, setConfirming] = useState<null | 'waive' | 'require'>(null);
  const [responsible, setResponsible] = useState(false);
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState<DocKey>('foodSafetyLicense');
  const [file, setFile] = useState<File | null>(null);
  const [expiry, setExpiry] = useState('');
  const needsExpiry = choices.find(choice => choice.value === key)?.hasExpiry !== false;

  const change = async (waived: boolean) => {
    try {
      await waiver.mutateAsync({ applicationId, waived });
      setConfirming(null);
    } catch (error) {
      toast({ title: mt('error'), description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    }
  };
  const save = async () => {
    if (!file || (needsExpiry && !expiry)) return;
    try {
      await add.mutateAsync({ applicationId, key, file, expiry });
      toast({ title: mt('cpAddDocumentDone') });
      setAdding(false); setFile(null); setExpiry('');
    } catch (error) {
      toast({ title: mt('error'), description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    }
  };

  return <div className="border-t border-[#f0eeec] pt-3" data-testid="customer-document-actions">
    {waivedAt && <div className="mb-3 rounded-lg bg-stone-50 px-3 py-2.5" data-testid="documents-waived">
      <p className="text-sm font-medium text-stone-900">{mt('cpDocsWaivedLine')}</p>
      <p className="mt-0.5 text-[13px] leading-[18px] text-stone-600">{mt('cpDocsWaivedHelp')}</p>
    </div>}
    {canChange && <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>{mt('cpAddDocument')}</Button>
      <Button type="button" variant="ghost" size="sm" className="text-stone-700" onClick={() => { setResponsible(false); setConfirming(waivedAt ? 'require' : 'waive'); }}>
        {waivedAt ? mt('cpRequireDocsAgain') : mt('cpWaiveDocs')}
      </Button>
    </div>}

    <AlertDialog open={confirming !== null} onOpenChange={open => { if (!open) setConfirming(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirming === 'require' ? mt('cpRequireDocsTitle', { name }) : mt('cpWaiveDocsTitle', { name })}</AlertDialogTitle>
          <AlertDialogDescription>{confirming === 'require' ? mt('cpRequireDocsBody') : mt('cpWaiveDocsBody')}</AlertDialogDescription>
        </AlertDialogHeader>
        {confirming === 'waive' && <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
          <Checkbox checked={responsible} onCheckedChange={checked => setResponsible(checked === true)} className="mt-0.5" aria-label={mt('waiverConfirm')} />
          <span>{mt('waiverConfirm')}</span>
        </label>}
        <AlertDialogFooter>
          <AlertDialogCancel>{mt('cancel')}</AlertDialogCancel>
          <Button disabled={waiver.isPending || (confirming === 'waive' && !responsible)} onClick={() => void change(confirming === 'waive')}>
            {confirming === 'require' ? mt('cpRequireDocsAgain') : mt('cpWaiveDocs')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <Dialog open={adding} onOpenChange={setAdding}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mt('cpAddDocumentTitle', { name })}</DialogTitle>
          <DialogDescription>{mt('cpAddDocumentHelp')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">{mt('cpAddDocumentType')}</Label>
            {choices.length > 3
              ? <select aria-label={mt('cpAddDocumentType')} value={key} onChange={event => setKey(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
                </select>
              : <SegmentedControl<DocKey> label={mt('cpAddDocumentType')} value={key} onChange={setKey} options={choices.map(({ value, label }) => ({ value, label }))} />}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-add-file" className="text-sm font-medium">{mt('cpAddDocumentFile')}</Label>
            <input id="cp-add-file" type="file" accept=".pdf,.jpg,.jpeg,.png" className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm"
              onChange={event => setFile(event.target.files?.[0] ?? null)} />
          </div>
          {needsExpiry && <div className="space-y-1.5">
            <Label htmlFor="cp-add-expiry" className="text-sm font-medium">{mt('cpAddDocumentExpiry')}</Label>
            <DateField id="cp-add-expiry" value={expiry} onChange={setExpiry} placeholder={mt('cpAddDocumentExpiry')} />
          </div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAdding(false)}>{mt('cancel')}</Button>
          <Button disabled={!file || (needsExpiry && !expiry) || add.isPending} onClick={() => void save()}>{mt('cpAddDocumentSave')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
