import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Eye } from "@/components/ui/manager-icons";
import { auth } from "@/lib/firebase";
import { formatBookingDate, formatCurrency } from "@/lib/formatters";
import { TestClockCard, useTestClockEnabled } from "../TestClockCard";
import { DamageClaimPanel } from "../booking-support/DamageClaimPanel";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const EMPTY = "__empty__";

interface AdminStorageRental {
  id: number;
  ref: string | null;
  kitchenName: string;
  listingName: string;
  unitLabel: string;
  chefName: string;
  state: string;
  startOn: string | null;
  paidThrough: string | null;
  totalCents: number | null;
}

async function adminFetch(url: string, body?: unknown) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("Not authenticated");
  const token = await currentUser.getIdToken();
  const response = await fetch(url, { credentials: "include", method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function normalize(row: Record<string, any>): AdminStorageRental {
  const sum = Array.isArray(row.terms) ? row.terms.reduce((total: number, term: any) => total + Number(term.totalCents ?? 0), 0) : null;
  return {
    id: Number(row.id),
    ref: row.ref ?? row.referenceCode ?? null,
    kitchenName: row.kitchen?.name ?? row.kitchenName ?? "",
    listingName: row.listing?.name ?? row.listingName ?? "",
    unitLabel: row.unitLabel ?? String(row.unitIndex ?? ""),
    chefName: row.chef?.name ?? row.chefName ?? "",
    state: String(row.state ?? row.rentalState ?? ""),
    startOn: row.startOn ?? row.termStart ?? null,
    paidThrough: row.paidThrough ?? null,
    totalCents: typeof row.totalCents === "number" ? row.totalCents : sum,
  };
}

export function AdminStorageRentalsSection() {
  const { t } = useTranslation("storage");
  const [selected, setSelected] = useState<AdminStorageRental | null>(null);
  const [search, setSearch] = useState("");
  const [state, setState] = useState("");
  const [kitchenId, setKitchenId] = useState("");
  const [needsAttention, setNeedsAttention] = useState(false);
  const params = new URLSearchParams({ q: search, needsAttention: needsAttention ? "1" : "0", ...(state ? { state } : {}), ...(kitchenId ? { kitchenId } : {}) });
  const query = useQuery<AdminStorageRental[]>({
    queryKey: ["/api/admin/storage-rentals", search, state, kitchenId, needsAttention],
    retry: false,
    queryFn: async () => {
      const payload = await adminFetch(`/api/admin/storage-rentals?${params}`);
      const rows: Array<Record<string, any>> = Array.isArray(payload) ? payload : payload?.rentals ?? [];
      return rows.map(normalize);
    },
  });
  // ?rental=<id> (from the claims queue) opens that rental's drawer once the list has it.
  const [linked, setLinked] = useState(() => Number(new URLSearchParams(window.location.search).get("rental")) || null);
  useEffect(() => {
    const row = linked ? query.data?.find(rental => rental.id === linked) : null;
    if (row) { setSelected(row); setLinked(null); }
  }, [linked, query.data]);

  if (query.isLoading) {
    return (
      <div className="space-y-3" role="status" aria-label={t("stLoading")}>
        <Skeleton className="h-11 w-full rounded-xl" />
        {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-12 w-full rounded-xl" />)}
      </div>
    );
  }

  const rows = query.data ?? [];
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t("stAdminTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("stAdminSubtitle")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input aria-label={t('stSearch')} placeholder={t('stSearch')} value={search} onChange={event => setSearch(event.target.value)} />
        <Input aria-label={t('stAdminColKitchen')} placeholder={t('stKitchenId')} type="number" min={1} value={kitchenId} onChange={event => setKitchenId(event.target.value)} />
        <Select value={state === "" ? EMPTY : state} onValueChange={value => setState(value === EMPTY ? "" : value)}>
          <SelectTrigger aria-label={t('stAdminColState')} className="rounded-md"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={EMPTY}>{t('stFilterAll')}</SelectItem>
            {['requested','reserved','active','move_out_requested','removal_review','ended','declined','withdrawn','expired'].map(value => <SelectItem key={value} value={value}>{t(`stState_${value}` as never)}</SelectItem>)}
          </SelectContent>
        </Select>
        <label><input type="checkbox" checked={needsAttention} onChange={event => setNeedsAttention(event.target.checked)} /> {t('stFilterNeedsAction')}</label>
      </div>
      {query.error && <p role="alert">{t('stActionFailed')}</p>}
      {rows.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{t("stAdminEmpty")}</CardContent></Card>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("stAdminColRef")}</TableHead>
                <TableHead>{t("stAdminColKitchen")}</TableHead>
                <TableHead>{t("stAdminColListing")}</TableHead>
                <TableHead>{t("stAdminColUnit")}</TableHead>
                <TableHead>{t("stAdminColChef")}</TableHead>
                <TableHead>{t("stAdminColState")}</TableHead>
                <TableHead>{t("stAdminColPaidThrough")}</TableHead>
                <TableHead>{t("stAdminColAmount")}</TableHead>
                <TableHead className="text-right">{t("stAdminDrawerTitle")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.ref ?? `#${row.id}`}</TableCell>
                  <TableCell>{row.kitchenName}</TableCell>
                  <TableCell>{row.listingName}</TableCell>
                  <TableCell>{row.unitLabel}</TableCell>
                  <TableCell>{row.chefName}</TableCell>
                  <TableCell><Badge variant="outline">{t(`stState_${row.state}` as never)}</Badge></TableCell>
                  <TableCell>{row.paidThrough ? formatBookingDate(row.paidThrough) : "—"}</TableCell>
                  <TableCell className="tabular-nums">{row.totalCents != null ? formatCurrency(row.totalCents) : "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setSelected(row)}>
                      <Eye className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("stViewUnit")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet open={selected !== null} onOpenChange={(next) => { if (!next) setSelected(null); }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          {selected && (
            <div className="space-y-4">
              <SheetHeader>
                <SheetTitle>{t("stAdminDrawerTitle")}</SheetTitle>
                <SheetDescription>{selected.ref ?? `#${selected.id}`}</SheetDescription>
              </SheetHeader>
              <dl className="space-y-2 text-sm">
                {[
                  [t("stAdminColKitchen"), selected.kitchenName],
                  [t("stAdminColListing"), selected.listingName],
                  [t("stAdminColUnit"), selected.unitLabel],
                  [t("stAdminColChef"), selected.chefName],
                  [t("stAdminColState"), t(`stState_${selected.state}` as never)],
                  [t("stAdminColDates"), selected.startOn ? `${formatBookingDate(selected.startOn)} – ${formatBookingDate(selected.paidThrough ?? selected.startOn)}` : "—"],
                  [t("stAdminColAmount"), selected.totalCents != null ? formatCurrency(selected.totalCents) : "—"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-right font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
              <AdminStorageTools key={selected.id} id={selected.id} onDone={() => void query.refetch()} />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function AdminStorageTools({ id, onDone }: { id: number; onDone: () => void }) {
  const { t } = useTranslation('storage');
  const testClock = useTestClockEnabled();
  const detail = useQuery<Record<string, any>>({ queryKey: ['/api/admin/storage-rentals', id], queryFn: () => adminFetch(`/api/admin/storage-rentals/${id}`) });
  const [type, setType] = useState('');
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState('');
  const [fundedBy, setFundedBy] = useState('kitchen');
  const [flagId, setFlagId] = useState('');
  const [photos, setPhotos] = useState('');
  const [items, setItems] = useState([{ name: '', qty: 1, perishable: false }]);
  const [itemIndexes, setItemIndexes] = useState<number[]>([]);
  const [emergency, setEmergency] = useState(false);
  const [refund, setRefund] = useState(true);
  const [operationKey, setOperationKey] = useState(() => crypto.randomUUID());
  const [preview, setPreview] = useState<{ amountCents: number; date?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const money = type === 'goodwill_refund' || type === 'end_rental' && refund;
  const requiresPreview = money || ['release_payout', 'waive_holdover', 'approve_for_kitchen', 'decline_for_kitchen'].includes(type);
  const body = { type, reason, operationKey, fundedBy: money ? fundedBy : 'none', emergency, refund,
    ...(amount ? { amountCents: Math.round(Number(amount) * 100) } : {}), ...(unit ? { unitIndex: Number(unit) } : {}),
    ...(flagId ? { flagId: Number(flagId) } : {}), ...(type === 'send_final_notice' ? { photos: photos.split(/\s+/).filter(Boolean), items } : {}), itemIndexes };
  async function act(previewOnly: boolean) {
    setError(''); setSaving(true);
    try {
      const result = await adminFetch(`/api/admin/storage-rentals/${id}/actions${previewOnly ? '/preview' : ''}`, body);
      if (previewOnly) setPreview(result);
      else { setType(''); setReason(''); setPreview(null); setOperationKey(crypto.randomUUID()); await detail.refetch(); onDone(); }
    } catch { setError(t('stActionFailed')); } finally { setSaving(false); }
  }
  if (detail.isLoading) return <p role="status">{t('stLoading')}</p>;
  if (!detail.data || detail.error) return <p role="alert">{t('stActionFailed')}</p>;
  const data = detail.data;
  return <div className="space-y-4">
    {/* A claim waiting on Local Cooks is the work here: it comes before the record. */}
    {data.claims?.length > 0 && <DamageClaimPanel storageRentalId={id} />}
    {['payments', 'flags', 'supportActions', 'problems', 'claims', 'holdover', 'notices'].map(section => <section key={section} className="space-y-2">
      <h3 className="font-medium">{t(`stAdminSection_${section}` as never)}</h3>
      {data[section]?.length ? data[section].map((row: any, index: number) => <div className="rounded border p-2 text-sm" key={row.id ?? index}>
        <p>{row.reason ?? row.description ?? row.title ?? row.subject ?? (row.kind ? t(`stFlag_${row.kind}` as never) : '')}</p>
        <p>{t(`stState_${row.status}` as never, { defaultValue: row.status?.replace(/_/g, ' ') ?? '' })} {row.fundedBy ? t(`stFunded_${row.fundedBy}` as never) : ''}</p>
        {row.amountCents != null && <p>{formatCurrency(row.amountCents)}</p>}
        {section === 'payments' && <p>{t('stPaymentSummary', { refunded: formatCurrency(row.refundedCents), payout: formatCurrency(row.payoutAmountCents), status: t(`stState_${row.payoutStatus}` as never), hold: row.holdReason ? t(`stHold_${row.holdReason}` as never) : '' })}</p>}
        {(row.payoutDate || row.createdAt || row.deadline) && <p>{formatBookingDate(row.payoutDate || row.createdAt || row.deadline)}</p>}
      </div>) : <p className="text-sm text-muted-foreground">{t('stNone')}</p>}
    </section>)}
    {testClock && <TestClockCard kind="storage" id={id} timezone={data.timezone || 'America/St_Johns'} onMoved={() => { void detail.refetch(); onDone(); }} />}
    <div onChange={() => setPreview(null)} className="space-y-3">
      <Label htmlFor="admin-storage-action">{t('stAdminAction')}</Label>
      <Select value={type === "" ? EMPTY : type} onValueChange={value => { setType(value === EMPTY ? "" : value); setOperationKey(crypto.randomUUID()); }}>
        <SelectTrigger id="admin-storage-action"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={EMPTY}>{t('stChooseAction')}</SelectItem>
          {data.adminActions.map((action: string) => <SelectItem key={action} value={action}>{t(`stAdminAction_${action}` as never)}</SelectItem>)}
        </SelectContent>
      </Select>
      {type && <>
        <Label htmlFor="admin-storage-reason">{t('stAdminReason')}</Label>
        <Textarea id="admin-storage-reason" value={reason} onChange={event => setReason(event.target.value)} />
        {type === 'goodwill_refund' && <><Label htmlFor="admin-storage-amount">{t('stAmountLabel')}</Label><Input id="admin-storage-amount" type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></>}
        {['relocate', 'approve_for_kitchen'].includes(type) && <><Label htmlFor="admin-storage-unit">{t('stUnitFieldLabel')}</Label><Input id="admin-storage-unit" type="number" min={1} value={unit} onChange={event => setUnit(event.target.value)} /></>}
        {type === 'end_rental' && <div className="space-y-2">
          <label className="block"><input type="checkbox" checked={emergency} onChange={event => setEmergency(event.target.checked)} /> {t('stEmergency')}</label>
          <label className="block"><input type="checkbox" checked={refund} onChange={event => setRefund(event.target.checked)} /> {t('stRefundUnused')}</label>
        </div>}
        {money && <><Label htmlFor="admin-storage-funding">{t('stFundedBy')}</Label><Select value={fundedBy} onValueChange={setFundedBy}><SelectTrigger id="admin-storage-funding"><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="kitchen">{t('stFunded_manager')}</SelectItem><SelectItem value="local_cooks">{t('stFunded_local_cooks')}</SelectItem>
        </SelectContent></Select></>}
        {type === 'resolve_flag' && <><Label htmlFor="admin-storage-flag">{t('stFlag')}</Label><Select value={flagId === "" ? EMPTY : flagId} onValueChange={value => setFlagId(value === EMPTY ? "" : value)}><SelectTrigger id="admin-storage-flag"><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value={EMPTY}>{t('stChooseAction')}</SelectItem>{data.flags.filter((flag: any) => !flag.resolvedAt).map((flag: any) => <SelectItem key={flag.id} value={String(flag.id)}>{flag.note ?? t(`stFlag_${flag.kind}` as never)}</SelectItem>)}
        </SelectContent></Select></>}
        {type === 'send_final_notice' && <>
          <Label htmlFor="admin-storage-photos">{t('stPhotosLabel')}</Label><Textarea id="admin-storage-photos" value={photos} onChange={event => setPhotos(event.target.value)} />
          {items.map((item, index) => <div key={index} className="space-y-2 rounded border p-2">
            <Input aria-label={t('stItemName')} placeholder={t('stItemName')} value={item.name} onChange={event => setItems(items.map((old, i) => i === index ? { ...old, name: event.target.value } : old))} />
            <Input aria-label={t('stQuantity')} type="number" min={1} value={item.qty} onChange={event => setItems(items.map((old, i) => i === index ? { ...old, qty: Number(event.target.value) } : old))} />
            <label><input type="checkbox" checked={item.perishable} onChange={event => setItems(items.map((old, i) => i === index ? { ...old, perishable: event.target.checked } : old))} /> {t('stPerishable')}</label>
          </div>)}
          <Button variant="outline" onClick={() => setItems([...items, { name: '', qty: 1, perishable: false }])}>{t('stAddItem')}</Button>
        </>}
        {type === 'record_removal_for_kitchen' && data.removalReview?.items?.map((item: any, index: number) => !item.removedAt && <label key={index} className="block">
          <input type="checkbox" checked={itemIndexes.includes(index)} onChange={event => setItemIndexes(event.target.checked ? [...itemIndexes, index] : itemIndexes.filter(i => i !== index))} /> {item.name} × {item.qty} · {formatBookingDate(item.perishable ? data.removalReview.perishablesAfter : data.removalReview.othersAfter)}
        </label>)}
        {preview && <p role="status">{formatCurrency(preview.amountCents)} · {preview.date ? formatBookingDate(preview.date) : formatBookingDate(new Date().toISOString())}</p>}
        {error && <p role="alert">{error}</p>}
        <Button disabled={saving || reason.trim().length < 10} onClick={() => void act(!!requiresPreview && !preview)}>{t(requiresPreview && !preview ? 'stPreview' : 'stConfirm')}</Button>
      </>}
    </div>
  </div>;
}
