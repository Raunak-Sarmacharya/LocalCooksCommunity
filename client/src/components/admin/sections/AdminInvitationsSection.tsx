import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { auth } from "@/lib/firebase";
import { formatCurrency } from "@/lib/formatters";
import { TestClockCard, untilLabel, useTestClockEnabled } from "../TestClockCard";

type Invitation = { id: string; version: number; status: string; kitchen: { name: string; locationName?: string };
  chef: { id: number; name: string } | null; date: string; startTime: string; endTime: string; timezone: string; dayCount: number;
  pricing: { totalCents: number }; expiresAt: string; createdAt: string; bookingId: number | null; note: string | null };
type CustomerLink = { id: number; locationName?: string; kitchenName?: string; fullName: string; email: string; status: string; sentAt: string; expiresAt: string };

async function adminFetch<T>(url: string, body?: unknown): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const response = await fetch(url, { credentials: "include", method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Something went wrong. Refresh and try again.");
  return result as T;
}

const OPEN = ["sent", "accepted_pending_payment", "unavailable"];
const statusWords: Record<string, string> = { sent: "Waiting on the customer", accepted_pending_payment: "Customer is paying", accepted: "Booked",
  declined: "Declined", withdrawn: "Withdrawn", expired: "Expired", superseded: "Replaced", unavailable: "Time no longer free" };
const when = (iso: string, timezone?: string) => new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(iso));
const expiry = (iso: string) => { const left = Date.parse(iso) - Date.now(); return left > 0 ? `in ${untilLabel(left)}` : `${untilLabel(-left)} ago`; };

/** Support view of every kitchen invitation: booking invitations (a time offered to a customer) and add-customer links. */
export function AdminInvitationsSection() {
  const [tab, setTab] = useState<"booking" | "links">("booking");
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<Invitation | null>(null);
  const [selectedLink, setSelectedLink] = useState<CustomerLink | null>(null);
  // shortcut: the server builds every invitation (with a live availability check) and filters nothing; add paging when the list grows past a few hundred.
  const invitations = useQuery({ queryKey: ["/api/admin/invitations"], enabled: tab === "booking", retry: false,
    queryFn: async () => (await adminFetch<{ invitations: Invitation[] }>("/api/admin/invitations")).invitations });
  const links = useQuery({ queryKey: ["/api/admin/customer-invites"], enabled: tab === "links", retry: false,
    queryFn: async () => { const body = await adminFetch<CustomerLink[] | { invites?: CustomerLink[] }>("/api/admin/customer-invites"); return Array.isArray(body) ? body : body.invites ?? []; } });

  const active = tab === "booking" ? invitations : links;
  const bookingRows = (invitations.data ?? []).filter(row => showAll || OPEN.includes(row.status))
    .sort((a, b) => showAll ? Date.parse(b.createdAt) - Date.parse(a.createdAt) : Date.parse(a.expiresAt) - Date.parse(b.expiresAt));
  const linkRows = (links.data ?? []).filter(row => showAll || row.status === "sent")
    .sort((a, b) => showAll ? Date.parse(b.sentAt) - Date.parse(a.sentAt) : Date.parse(a.expiresAt) - Date.parse(b.expiresAt));
  const empty = tab === "booking" ? bookingRows.length === 0 : linkRows.length === 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Invitations</h2>
        <p className="text-sm text-muted-foreground">Times kitchens offered to customers, and links that add someone as a kitchen's customer. Open ones first, soonest to expire on top.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Invitation type" className="inline-flex rounded-lg bg-muted p-1">
          {([["booking", "Booking invitations"], ["links", "Customer links"]] as const).map(([value, label]) => (
            <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === value ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={showAll} onChange={event => setShowAll(event.target.checked)} /> Include closed</label>
      </div>

      {active.isLoading ? (
        <div className="space-y-3" role="status" aria-label="Loading invitations">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-12 w-full rounded-xl" />)}</div>
      ) : active.error ? (
        <p role="alert" className="text-sm">Invitations didn't load. <Button variant="link" className="h-auto p-0" onClick={() => void active.refetch()}>Try again</Button></p>
      ) : empty ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{showAll ? "No invitations yet."
          : tab === "booking" ? "No open booking invitations. Kitchens send them from a customer's page." : "No open customer links. Kitchens send them from Customers → Add customer."}</CardContent></Card>
      ) : tab === "booking" ? (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Kitchen</TableHead><TableHead>Time offered</TableHead><TableHead>Status</TableHead><TableHead>Expires</TableHead><TableHead className="text-right"><span className="sr-only">Open</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {bookingRows.map(row => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.chef?.name ?? "Customer"}</TableCell>
                  <TableCell>{row.kitchen.name}</TableCell>
                  <TableCell>{row.date} · {row.startTime}–{row.endTime}{row.dayCount > 1 ? ` · ${row.dayCount} days` : ""}</TableCell>
                  <TableCell><Badge variant="outline">{statusWords[row.status] ?? row.status}</Badge></TableCell>
                  <TableCell className="tabular-nums">{row.status === "sent" ? expiry(row.expiresAt) : "—"}</TableCell>
                  <TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => setSelected(row)}>Open</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>Person</TableHead><TableHead>Kitchen</TableHead><TableHead>Sent</TableHead><TableHead>Status</TableHead><TableHead>Expires</TableHead><TableHead className="text-right"><span className="sr-only">Open</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {linkRows.map(row => (
                <TableRow key={row.id}>
                  <TableCell><span className="font-medium">{row.fullName}</span><span className="block text-xs text-muted-foreground">{row.email}</span></TableCell>
                  <TableCell>{row.kitchenName || row.locationName}</TableCell>
                  <TableCell>{when(row.sentAt)}</TableCell>
                  <TableCell><Badge variant="outline">{row.status === "sent" ? "Waiting on the person" : statusWords[row.status] ?? row.status}</Badge></TableCell>
                  <TableCell className="tabular-nums">{row.status === "sent" ? expiry(row.expiresAt) : "—"}</TableCell>
                  <TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => setSelectedLink(row)}>Open</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet open={!!selected || !!selectedLink} onOpenChange={open => { if (!open) { setSelected(null); setSelectedLink(null); } }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          {selected && <InvitationDrawer key={`${selected.id}:${selected.version}`} invitation={selected}
            onChanged={next => { setSelected(next); void invitations.refetch(); }} onMoved={() => void invitations.refetch()} />}
          {selectedLink && <LinkDrawer link={selectedLink} onMoved={() => void links.refetch()} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Facts({ rows }: { rows: Array<[string, string]> }) {
  return <dl className="space-y-2 text-sm">{rows.map(([label, value]) => (
    <div key={label} className="flex items-start justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium">{value}</dd></div>
  ))}</dl>;
}

function InvitationDrawer({ invitation, onChanged, onMoved }: { invitation: Invitation; onChanged: (next: Invitation) => void; onMoved: () => void }) {
  const testClock = useTestClockEnabled();
  const [action, setAction] = useState<"extend" | "resend" | "withdraw" | null>(null);
  const [hours, setHours] = useState(48), [reason, setReason] = useState("");
  const canWithdraw = invitation.status === "sent", canExtend = ["sent", "expired"].includes(invitation.status);
  const run = useMutation({
    mutationFn: () => adminFetch<Invitation>(`/api/admin/invitations/${invitation.id}/${action}`, { reason: reason.trim(), version: invitation.version, ...(action === "extend" ? { hours } : {}) }),
    onSuccess: next => { setAction(null); setReason(""); onChanged(next); },
  });
  const consequence = action === "withdraw" ? "The customer can no longer book this time and is told the kitchen's invitation was withdrawn."
    : action === "extend" ? `The customer gets ${hours === 168 ? "7 days" : `${hours} hours`} from now to book, never past the kitchen's checkout cutoff. They're told the new deadline.`
    : "The customer gets the invitation again with a fresh deadline of the same length.";
  return (
    <div className="space-y-4">
      <SheetHeader>
        <SheetTitle>{invitation.chef?.name ?? "Customer"} · {invitation.kitchen.name}</SheetTitle>
        <SheetDescription>{statusWords[invitation.status] ?? invitation.status}{invitation.status === "sent" ? ` · expires ${expiry(invitation.expiresAt)}` : ""}</SheetDescription>
      </SheetHeader>
      <Facts rows={[
        ["Time offered", `${invitation.date} · ${invitation.startTime}–${invitation.endTime}${invitation.dayCount > 1 ? ` · ${invitation.dayCount} days` : ""}`],
        ["Total", formatCurrency(invitation.pricing.totalCents)],
        ["Sent", when(invitation.createdAt, invitation.timezone)],
        ["Expires", when(invitation.expiresAt, invitation.timezone)],
        ...(invitation.bookingId ? [["Booking", `#${invitation.bookingId}`] as [string, string]] : []),
        ...(invitation.note ? [["Kitchen's note", invitation.note] as [string, string]] : []),
      ]} />
      {(canWithdraw || canExtend) && (
        <section className="space-y-3 rounded-xl bg-muted/50 p-4" aria-label="Support actions">
          <h3 className="text-sm font-semibold">Help with this invitation</h3>
          <div className="flex flex-wrap gap-2">
            {canExtend && <Button size="sm" variant={action === "extend" ? "default" : "outline"} onClick={() => setAction("extend")}>Give more time</Button>}
            {canExtend && <Button size="sm" variant={action === "resend" ? "default" : "outline"} onClick={() => setAction("resend")}>Send again</Button>}
            {canWithdraw && <Button size="sm" variant={action === "withdraw" ? "default" : "outline"} onClick={() => setAction("withdraw")}>Withdraw</Button>}
          </div>
          {action && <div className="space-y-3">
            {action === "extend" && <div className="flex gap-2" role="group" aria-label="New deadline">
              {[24, 48, 168].map(value => <Button key={value} size="sm" variant={hours === value ? "default" : "outline"} onClick={() => setHours(value)}>{value === 168 ? "7 days" : `${value} h`}</Button>)}
            </div>}
            <p className="text-sm">{consequence}</p>
            <div className="space-y-1"><Label htmlFor="invitation-reason">Reason (kept in the record)</Label>
              <Textarea id="invitation-reason" value={reason} maxLength={500} onChange={event => setReason(event.target.value)} placeholder="e.g. Customer asked for more time on the phone" /></div>
            {run.error && <p role="alert" className="text-sm text-destructive">{run.error.message}</p>}
            <div className="flex gap-2">
              <Button size="sm" disabled={!reason.trim() || run.isPending} onClick={() => run.mutate()}>{run.isPending ? "Saving…" : "Confirm"}</Button>
              <Button size="sm" variant="ghost" disabled={run.isPending} onClick={() => { setAction(null); run.reset(); }}>Cancel</Button>
            </div>
          </div>}
        </section>
      )}
      {testClock && <TestClockCard kind="invitation" id={invitation.id} timezone={invitation.timezone} onMoved={onMoved} />}
    </div>
  );
}

function LinkDrawer({ link, onMoved }: { link: CustomerLink; onMoved: () => void }) {
  const testClock = useTestClockEnabled();
  return (
    <div className="space-y-4">
      <SheetHeader>
        <SheetTitle>{link.fullName}</SheetTitle>
        <SheetDescription>{link.status === "sent" ? `Waiting on the person · expires ${expiry(link.expiresAt)}` : statusWords[link.status] ?? link.status}</SheetDescription>
      </SheetHeader>
      <Facts rows={[["Email", link.email], ["Kitchen", link.kitchenName || link.locationName || "—"], ["Sent", when(link.sentAt)], ["Expires", when(link.expiresAt)]]} />
      <p className="text-sm text-muted-foreground">The kitchen sends a link again from its Customers page; Local Cooks doesn't resend these.</p>
      {testClock && <TestClockCard kind="customer_invite" id={link.id} timezone="America/St_Johns" onMoved={onMoved} />}
    </div>
  );
}
