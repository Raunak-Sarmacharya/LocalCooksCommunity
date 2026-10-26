/**
 * Add a customer (owner, Oct 24): the kitchen invites someone by email. They accept with that email (sign in or create
 * an account), skip Request to apply, and handle booking requirements the way the kitchen chose here. The email check
 * only reports this kitchen's own matches, never whether an address has a Local Cooks account.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { ChevronLeft } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { mt } from '@/i18n/manager';
import { auth } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { DateField } from '@/components/ui/date-field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { isKitchenDocument } from '@shared/location-booking-eligibility';
import { customerHref } from './customer-format';

type Choice = 'customer' | 'uploaded' | 'waived';
type Match = { match: 'customer' | 'request' | 'invited' | null; chefId?: number; applicationId?: number };
type LocationDocument = { key: string; label: string; hasExpiry: boolean; required: boolean };

const authHeaders = async (): Promise<Record<string, string>> => {
  const token = await auth.currentUser?.getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/** The documents this location asks for: the built-in ones it tracks or requires, then its own. */
function locationDocuments(requirements: any): LocationDocument[] {
  if (!requirements) return [];
  const builtIn = [
    { key: 'foodSafetyLicense', label: mt('arDocFoodSafety'), hasExpiry: true, required: !!requirements.requireFoodSafetyUpload, shown: requirements.requireFoodSafetyUpload || requirements.food_handler_cert_tracked },
    { key: 'foodEstablishmentCert', label: mt('arDocEstablishment'), hasExpiry: true, required: !!requirements.tier2_food_establishment_cert_required, shown: requirements.tier2_food_establishment_cert_required || requirements.food_establishment_cert_tracked },
    { key: 'insurance', label: mt('arDocInsurance'), hasExpiry: true, required: !!requirements.tier2_insurance_document_required, shown: requirements.tier2_insurance_document_required || requirements.insurance_tracked },
  ].filter(doc => doc.shown).map(({ shown: _shown, ...doc }): LocationDocument => doc);
  const own = (Array.isArray(requirements.tier2_custom_fields) ? requirements.tier2_custom_fields : []).filter(isKitchenDocument)
    .map((field: any) => ({ key: `custom:${field.id}`, label: field.label, hasExpiry: !!field.expires, required: !!field.required }));
  return [...builtIn, ...own];
}

export function AddCustomer({ locations, defaultLocationId, onDone }: { locations: { id: number; name: string }[]; defaultLocationId: number | null; onDone: (sentTo: string | null) => void }) {
  const queryClient = useQueryClient();
  // From a finished tour (owner, Oct 24): ?name=&email=&location= fill the form in.
  const prefill = useMemo(() => new URLSearchParams(window.location.search), []);
  const prefillLocation = Number(prefill.get('location')) || null;
  const [pickedLocationId, setLocationId] = useState<number | null>(null);
  // Worked out each render: the locations list can arrive after the form opens (a refresh on ?add=1).
  const locationId = pickedLocationId ?? (prefillLocation && locations.some(location => location.id === prefillLocation) ? prefillLocation
    : defaultLocationId ?? (locations.length === 1 ? locations[0].id : null));
  const [fullName, setFullName] = useState(prefill.get('name') || '');
  const [email, setEmail] = useState(prefill.get('email') || '');
  const [phone, setPhone] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [choice, setChoice] = useState<Choice>('customer');
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [expiries, setExpiries] = useState<Record<string, string>>({});
  const [responsible, setResponsible] = useState(false);
  const [match, setMatch] = useState<Match>({ match: null });
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const requirements = useQuery({
    queryKey: [`/api/public/locations/${locationId}/requirements`],
    queryFn: async () => (await fetch(`/api/public/locations/${locationId}/requirements`)).json(),
    enabled: locationId !== null,
  });
  const documents = useMemo(() => locationDocuments(requirements.data), [requirements.data]);

  const checkEmail = async () => {
    setMatch({ match: null });
    if (!locationId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return;
    const response = await fetch(`/api/manager/customer-invites/check?locationId=${locationId}&email=${encodeURIComponent(email.trim())}`, { headers: await authHeaders(), credentials: 'include' }).catch(() => null);
    if (response?.ok) setMatch(await response.json());
  };

  // A prefilled email is checked straight away, so "already your customer" shows before anything is typed.
  useEffect(() => { if (prefill.get('email')) void checkEmail(); }, [locationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const uploads = documents.filter(doc => files[doc.key]);
  const missingDate = uploads.some(doc => doc.hasExpiry && !expiries[doc.key]);
  const ready = !!locationId && fullName.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && !match.match
    && (choice !== 'uploaded' || (uploads.length > 0 && !missingDate)) && (choice !== 'waived' || responsible);

  const send = async () => {
    if (!ready || !locationId) return;
    setSending(true); setError('');
    try {
      const body = new FormData();
      body.append('locationId', String(locationId)); body.append('email', email.trim()); body.append('fullName', fullName.trim());
      if (phone.trim()) body.append('phone', phone.trim());
      if (businessName.trim()) body.append('businessName', businessName.trim());
      body.append('choice', choice);
      if (choice === 'waived') body.append('confirmResponsibility', 'true');
      if (choice === 'uploaded') for (const doc of uploads) {
        body.append(`doc_${doc.key}`, files[doc.key]!);
        if (doc.hasExpiry) body.append(`doc_${doc.key}__expiry`, expiries[doc.key]);
      }
      const response = await fetch('/api/manager/customer-invites', { method: 'POST', body, headers: await authHeaders(), credentials: 'include' });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || mt('acSendFailed'));
      void queryClient.invalidateQueries({ queryKey: ['/api/manager/customer-invites'] });
      onDone(email.trim());
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : mt('acSendFailed'));
    } finally { setSending(false); }
  };

  const choiceCard = (value: Choice, title: string, hint: string) => (
    <label key={value} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors', choice === value ? 'border-foreground bg-muted/40' : 'hover:bg-muted/30')}>
      <input type="radio" name="requirements-choice" value={value} checked={choice === value} onChange={() => setChoice(value)} className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]" />
      <span><span className="block text-sm font-medium text-foreground">{title}</span><span className="mt-0.5 block text-sm text-muted-foreground">{hint}</span></span>
    </label>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header>
        <button type="button" onClick={() => onDone(null)} className="!min-h-0 -ml-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="h-4 w-4" aria-hidden="true" />{mt('cuTitle')}</button>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{mt('acTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{mt('acLead')}</p>
      </header>

      <section className="space-y-4">
        <h2 className="text-base font-semibold text-foreground">{mt('acWho')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ac-name">{mt('acName')}</Label>
            <Input id="ac-name" type="text" value={fullName} onChange={event => setFullName(event.target.value)} autoComplete="off" maxLength={120} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ac-email">{mt('acEmail')}</Label>
            <Input id="ac-email" type="email" value={email} onChange={event => { setEmail(event.target.value); setMatch({ match: null }); }} onBlur={() => void checkEmail()} autoComplete="off" aria-describedby="ac-email-note" />
            <p id="ac-email-note" className={cn('text-sm', match.match ? 'text-amber-800' : 'text-muted-foreground')}>
              {match.match === 'customer' && <>{mt('acAlreadyCustomer')} <Link href={customerHref(match.chefId!, locationId!)} className="font-medium underline underline-offset-4">{mt('acOpenCustomer')}</Link></>}
              {match.match === 'request' && <>{mt('acAlreadyRequested')} <Link href={`/manager/dashboard?view=applications&application=${match.applicationId}`} className="font-medium underline underline-offset-4">{mt('acOpenRequest')}</Link></>}
              {match.match === 'invited' && mt('acAlreadyInvited')}
              {!match.match && mt('acEmailHint')}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ac-phone">{mt('acPhone')} <span className="font-normal text-muted-foreground">{mt('qbOptionalTag')}</span></Label>
            <Input id="ac-phone" type="tel" inputMode="tel" value={phone} onChange={event => setPhone(event.target.value)} autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ac-business">{mt('acBusiness')} <span className="font-normal text-muted-foreground">{mt('qbOptionalTag')}</span></Label>
            <Input id="ac-business" type="text" value={businessName} onChange={event => setBusinessName(event.target.value)} autoComplete="off" />
          </div>
          {locations.length > 1 && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ac-location">{mt('acLocation')}</Label>
              <Select value={locationId ? String(locationId) : ''} onValueChange={value => { setLocationId(Number(value)); setFiles({}); setExpiries({}); setMatch({ match: null }); }}>
                <SelectTrigger id="ac-location"><SelectValue placeholder={mt('acChooseLocation')} /></SelectTrigger>
                <SelectContent>{locations.map(location => <SelectItem key={location.id} value={String(location.id)}>{location.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">{mt('step2')}</h2>
          <p className="text-sm text-muted-foreground">{mt('acRequirementsLead')}</p>
        </div>
        <div className="space-y-2" role="radiogroup" aria-label={mt('step2')}>
          {choiceCard('customer', mt('acChoiceCustomer'), mt('acChoiceCustomerHint'))}
          {choiceCard('uploaded', mt('acChoiceUploaded'), mt('acChoiceUploadedHint'))}
          {choice === 'uploaded' && (
            <div className="rounded-xl border bg-card">
              {!documents.length ? <p className="p-4 text-sm text-muted-foreground">{locationId ? mt('acNoDocuments') : mt('acChooseLocation')}</p> : (
                <ul className="divide-y">
                  {documents.map(doc => (
                    <li key={doc.key} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-end">
                      <div className="space-y-1.5 min-w-0">
                        <Label htmlFor={`ac-file-${doc.key}`}>{doc.label} <span className="font-normal text-muted-foreground">{doc.required ? mt('docModeRequired') : mt('docModeTrack')}</span></Label>
                        <input id={`ac-file-${doc.key}`} type="file" accept=".pdf,.jpg,.jpeg,.png"
                          className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm"
                          onChange={event => setFiles(current => ({ ...current, [doc.key]: event.target.files?.[0] ?? null }))} />
                      </div>
                      {doc.hasExpiry ? (
                        <div className="space-y-1.5">
                          <Label htmlFor={`ac-expiry-${doc.key}`}>{mt('qbPreviewExpiry')}</Label>
                          <DateField id={`ac-expiry-${doc.key}`} value={expiries[doc.key] || ''} onChange={value => setExpiries(current => ({ ...current, [doc.key]: value }))} placeholder={mt('qbPreviewPickDate')} />
                        </div>
                      ) : <p className="text-sm text-muted-foreground">{mt('acNoExpiry')}</p>}
                    </li>
                  ))}
                </ul>
              )}
              <p className="border-t px-4 py-3 text-sm text-muted-foreground">{mt('acUploadedNote')}</p>
            </div>
          )}
          {choiceCard('waived', mt('approveWithoutDocuments'), mt('acChoiceWaivedHint'))}
          {choice === 'waived' && (
            <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              <Checkbox checked={responsible} onCheckedChange={checked => setResponsible(checked === true)} className="mt-0.5" />
              <span>{mt('waiverConfirm')}</span>
            </label>
          )}
        </div>
      </section>

      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
      <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={() => onDone(null)}>{mt('cancel')}</Button>
        <Button type="button" disabled={!ready || sending} onClick={() => void send()}>{sending ? mt('acSending') : mt('acSend')}</Button>
      </div>
    </div>
  );
}
