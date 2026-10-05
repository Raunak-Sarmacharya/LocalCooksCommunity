import { useEffect, useRef, useState } from "react";
import { useSearch } from "wouter";
import { useTourClock } from "@/hooks/use-tour-clock";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, Loader2, Mail, MapPin, Phone, X } from "lucide-react";
import { auth } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatTourWhen } from "@/lib/chef-viewing-display";
import { HistoricalVisitReviews } from '../HistoricalVisitReviews';
import { hasTourConfirmation, tourDisruptionReasons } from '@shared/tour-outcome';

type TourRequest = {
  viewing: {
    id: number;
    scheduledAt: string;
    durationMinutes: number;
    chefNotes: string | null;
    intakeData: Record<string, unknown> | null;
    status: string;
    cancelledBy: string | null;
    adminReviewDecision: "approved" | "denied" | null;
    adminReviewReason: string | null;
    adminReviewedAt: string | null;
    createdAt: string;
    updatedAt: string;
    managerNotes?: string | null;
    sharedManagerNotes?: string | null;
    disruptionReason?: string | null;
    outcomeHistory?: Array<{ from: string; to: string; recordedAt: string; actorRole: string; notes?: string | null; sharedNotes?: string | null }>;
  };
  chefName: string;
  chefUsername: string | null;
  chefEmail: string | null;
  chefPhone: string | null;
  kitchenName: string | null;
  locationName: string | null;
  locationAddress: string | null;
  locationTimezone: string | null;
};

async function authHeaders() {
  const token = await auth.currentUser?.getIdToken();
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

export function AdminTourRequestsSection() {
  useTourClock();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<TourRequest | null>(null);
  const [decision, setDecision] = useState<"approved" | "denied">("approved");
  const [reason, setReason] = useState("");
  const [tab, setTab] = useState<"pending" | "outcomes" | "history">("pending");
  const linkedTourId = Number(new URLSearchParams(useSearch()).get('viewing'));
  const openedLink = useRef<number | null>(null);
  const [outcomeTour, setOutcomeTour] = useState<TourRequest | null>(null);
  const [outcome, setOutcome] = useState<'completed' | 'no_show' | 'disrupted'>('completed');
  const [outcomeReason, setOutcomeReason] = useState('');
  const [outcomeNotes, setOutcomeNotes] = useState('');
  const needsOutcome = (request: TourRequest) => request.viewing.status === 'confirmed'
    && new Date(request.viewing.scheduledAt).getTime() + request.viewing.durationMinutes * 60_000 <= Date.now();
  const recordOutcome = useMutation({
    mutationFn: async () => {
      if (!outcomeTour) throw new Error('Select a tour');
      const response = await fetch(`/api/viewings/${outcomeTour.viewing.id}/status`, {
        method: 'PATCH', headers: await authHeaders(), credentials: 'include',
        body: JSON.stringify({ expectedUpdatedAt: outcomeTour.viewing.updatedAt, status: outcome === 'disrupted' ? 'cancelled' : outcome,
          noShowReason: outcome === 'no_show' ? 'visitor_absent' : undefined, disruptionReason: outcome === 'disrupted' ? outcomeReason : undefined,
          sharedManagerNotes: outcomeNotes.trim() || undefined }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Unable to save outcome');
      return body;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/viewings/admin'] });
      toast({ title: 'Tour outcome saved', description: data.notificationDeliveryFailed ? 'The outcome is saved, but some notifications could not be delivered.' : undefined }); setOutcomeTour(null);
    },
    onError: (error: Error) => { queryClient.invalidateQueries({ queryKey: ['/api/viewings/admin'] }); toast({ title: 'Outcome failed', description: error.message, variant: 'destructive' }); },
  });

  const { data: requests = [], isLoading, isError, refetch } = useQuery<TourRequest[]>({
    queryKey: ["/api/viewings/admin"],
    queryFn: async () => {
      const response = await fetch("/api/viewings/admin", { headers: await authHeaders(), credentials: "include" });
      if (!response.ok) throw new Error("Unable to load tour requests");
      return response.json();
    },
    refetchInterval: 30_000,
  });

  const { data: pendingDeliveries = [] } = useQuery<Array<{ id: number; viewingId: number; attempts: number; lastError: string | null }>>({
    queryKey: ['/api/viewings/admin/delivery-status'],
    queryFn: async () => { const response = await fetch('/api/viewings/admin/delivery-status', { headers: await authHeaders(), credentials: 'include' });
      if (!response.ok) throw new Error('Unable to load tour delivery status'); return response.json(); }, refetchInterval: 30_000,
  });
  useEffect(() => {
    if (!linkedTourId) { openedLink.current = null; return; }
    if (openedLink.current === linkedTourId) return;
    const tour = requests.find(request => request.viewing.id === linkedTourId);
    if (!tour) return;
    setTab(tour.viewing.status === 'pending_local_cooks' && Date.parse(tour.viewing.scheduledAt) > Date.now() ? 'pending' : needsOutcome(tour) ? 'outcomes' : 'history');
    openedLink.current = linkedTourId;
    requestAnimationFrame(() => document.getElementById(`admin-tour-${linkedTourId}`)?.scrollIntoView?.({ block: 'center' }));
  }, [linkedTourId, requests]);
  const retryDelivery = useMutation({ mutationFn: async (viewingId: number) => {
    const response = await fetch(`/api/viewings/admin/${viewingId}/retry-delivery`, { method: 'POST', headers: await authHeaders(), credentials: 'include' });
    const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Retry failed'); return body;
  }, onSuccess: (body) => { queryClient.invalidateQueries({ queryKey: ['/api/viewings/admin/delivery-status'] });
    toast({ title: body.notificationDeliveryFailed ? 'Some delivery remains pending' : 'Tour communications delivered', description: 'The tour result and visit times were not changed.' }); },
  onError: (error: Error) => toast({ title: 'Delivery retry failed', description: error.message, variant: 'destructive' }) });

  const review = useMutation({
    mutationFn: async () => {
      if (!selected) return;
      const response = await fetch(`/api/viewings/admin/${selected.viewing.id}/review`, {
        method: "PATCH",
        headers: await authHeaders(),
        credentials: "include",
        body: JSON.stringify({ decision, reason: reason || undefined, expectedUpdatedAt: selected.viewing.updatedAt }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to review tour request");
      return body;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/viewings/admin"] });
      toast({
        title: decision === "approved" ? "Sent to kitchen manager" : "Tour request declined",
        description: data?.chatProvisioningFailed ? `${data.chatProvisioningMessage}${data.notificationDeliveryFailed ? ' Some notifications also remain pending.' : ''}` : data?.notificationDeliveryFailed ? "The decision is saved, but some notifications could not be delivered." : decision === "approved"
          ? "The manager can now review and approve or deny the request."
          : "The chef has been notified.",
      });
      setSelected(null);
      setReason("");
    },
    onError: (error: Error) => { queryClient.invalidateQueries({ queryKey: ["/api/viewings/admin"] }); toast({ title: "Review failed", description: error.message, variant: "destructive" }); },
  });

  const visibleRequests = requests.filter((request) =>
    tab === "pending" ? request.viewing.status === "pending_local_cooks" && new Date(request.viewing.scheduledAt).getTime() > Date.now()
      : tab === 'outcomes' ? needsOutcome(request) : request.viewing.status !== 'pending_local_cooks' || new Date(request.viewing.scheduledAt).getTime() <= Date.now()
  );

  const openReview = (request: TourRequest, nextDecision: "approved" | "denied") => {
    setSelected(request);
    setDecision(nextDecision);
    setReason("");
  };

  return (
    <div className="space-y-5">
      {isError && <div role="alert"><p>We couldn’t load tour requests.</p><Button variant="outline" onClick={() => void refetch()}>Try again</Button></div>}
      {!isLoading && !isError && linkedTourId > 0 && !requests.some(request => request.viewing.id === linkedTourId) &&
        <div role="alert"><p>This tour is unavailable. Check your access or try again.</p><Button variant="outline" onClick={() => void refetch()}>Try again</Button></div>}
      <HistoricalVisitReviews />
      {pendingDeliveries.length > 0 && <Card><CardHeader><CardTitle>Tour communications pending ({pendingDeliveries.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">{Array.from(new Set(pendingDeliveries.map(event => event.viewingId))).map(id => <div key={id} className="flex items-center justify-between gap-3">
          <span>TOUR-{id} · {pendingDeliveries.filter(event => event.viewingId === id).length} pending events</span>
          <Button variant="outline" disabled={retryDelivery.isPending} onClick={() => retryDelivery.mutate(id)}>Retry delivery</Button>
        </div>)}</CardContent></Card>}
      <div>
        <h2 className="text-xl font-semibold">Tour requests</h2>
        <p className="text-sm text-muted-foreground">
          Local Cooks screens each request before it reaches a kitchen manager.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as "pending" | "outcomes" | "history")}>
        <TabsList>
          <TabsTrigger value="pending">Pending ({requests.filter((request) => request.viewing.status === "pending_local_cooks" && new Date(request.viewing.scheduledAt).getTime() > Date.now()).length})</TabsTrigger>
          <TabsTrigger value="outcomes">Past tours · visit results ({requests.filter(needsOutcome).length})</TabsTrigger>
          <TabsTrigger value="history">History ({requests.filter((request) => request.viewing.status !== 'pending_local_cooks' || new Date(request.viewing.scheduledAt).getTime() <= Date.now()).length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2" role="status" aria-label="Loading tour requests">
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-32 w-full rounded-xl" />)}
        </div>
      ) : visibleRequests.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">{tab === "pending" ? "No tour requests are waiting for Local Cooks review." : "No reviewed tour requests yet."}</CardContent></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visibleRequests.map((request) => (
            <Card key={request.viewing.id} id={`admin-tour-${request.viewing.id}`} className={request.viewing.id === linkedTourId ? 'border-primary' : undefined}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{request.chefName || request.chefUsername || "Chef"}</CardTitle>
                    <CardDescription>{request.kitchenName || request.locationName || "Kitchen tour"}</CardDescription>
                  </div>
                  <Badge variant={request.viewing.status === "cancelled" || request.viewing.status === "no_show" ? "destructive" : request.viewing.status === "confirmed" || request.viewing.status === "completed" ? "success" : "warning"}>
                    {['pending_local_cooks', 'pending'].includes(request.viewing.status) && new Date(request.viewing.scheduledAt).getTime() <= Date.now() ? 'Request expired' : request.viewing.status === "cancelled"
                      ? request.viewing.disruptionReason ? "Disrupted" : request.viewing.adminReviewDecision === "denied" || request.viewing.cancelledBy === "manager_declined" ? "Rejected" : "Cancelled"
                      : request.viewing.status === "confirmed" ? "Approved"
                      : request.viewing.status === "completed" ? "Completed"
                      : request.viewing.status === "no_show" ? "No show"
                      : request.viewing.adminReviewDecision === "approved" ? "Request sent" : "Local Cooks review"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div><span className="font-medium">Tour reference:</span> TOUR-{request.viewing.id}</div>
                <div><span className="font-medium">Submitted:</span> {formatTourWhen(request.viewing.createdAt, null, request.locationTimezone || "America/St_Johns")}</div>
                <div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-muted-foreground" />{formatTourWhen(request.viewing.scheduledAt, request.viewing.durationMinutes, request.locationTimezone || "America/St_Johns")} · {request.viewing.durationMinutes} min</div>
                <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" />{request.locationName || "Kitchen"}{request.locationAddress ? ` · ${request.locationAddress}` : ""}</div>
                {request.chefEmail && <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" /><a className="text-primary hover:underline" href={`mailto:${request.chefEmail}`}>{request.chefEmail}</a></div>}
                {request.chefPhone && <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" /><a className="text-primary hover:underline" href={`tel:${request.chefPhone}`}>{request.chefPhone}</a></div>}
                {request.viewing.chefNotes && <p className="rounded-md bg-muted p-3"><span className="font-medium">Chef notes:</span> {request.viewing.chefNotes}</p>}
                {request.viewing.adminReviewReason && <p className="rounded-md bg-muted p-3"><span className="font-medium">Review reason:</span> {request.viewing.adminReviewReason}</p>}
                {request.viewing.sharedManagerNotes && <p><strong>Message shared with chef:</strong> {request.viewing.sharedManagerNotes}</p>}
                {request.viewing.managerNotes && <p className="rounded-md border p-3"><strong>Internal notes · admin only:</strong> {request.viewing.managerNotes}</p>}
                {request.viewing.disruptionReason && <p><strong>Disruption:</strong> {tourDisruptionReasons[request.viewing.disruptionReason as keyof typeof tourDisruptionReasons] || request.viewing.disruptionReason}</p>}
                {!!request.viewing.outcomeHistory?.length && <details><summary>Outcome audit history</summary>{request.viewing.outcomeHistory.map((entry, index) => <div key={index} className="border-t py-2">
                  <p>{entry.from} → {entry.to} · {entry.actorRole} · {entry.recordedAt ? formatTourWhen(entry.recordedAt, null, 'America/St_Johns') : 'Timestamp not recorded'}</p>
                  {entry.notes && <p>Internal notes · admin only: {entry.notes}</p>}{entry.sharedNotes && <p>Message shared with chef: {entry.sharedNotes}</p>}
                </div>)}</details>}
                {request.viewing.adminReviewedAt && <p><span className="font-medium">Reviewed:</span> {formatTourWhen(request.viewing.adminReviewedAt, null, request.locationTimezone || "America/St_Johns")}</p>}
                {request.viewing.intakeData && Object.keys(request.viewing.intakeData).length > 0 && (
                  <dl className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
                    {Object.entries(request.viewing.intakeData).filter(([, value]) => value != null && value !== "").map(([key, value]) => (
                      <div key={key}><dt className="text-xs text-muted-foreground">{key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}</dt><dd className="break-words">{typeof value === "boolean" ? (value ? "Yes" : "No") : typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>
                    ))}
                  </dl>
                )}
                {request.viewing.status === "pending_local_cooks" && <div className="flex justify-end gap-2 pt-1">
                  <Button variant="outline" onClick={() => openReview(request, "denied")}><X className="mr-2 h-4 w-4" />Deny</Button>
                  <Button disabled={new Date(request.viewing.scheduledAt).getTime() <= Date.now()} onClick={() => openReview(request, "approved")}><Check className="mr-2 h-4 w-4" />Approve for manager</Button>
                </div>}
                {(needsOutcome(request) || (hasTourConfirmation(request.viewing) && (['completed', 'no_show'].includes(request.viewing.status) || request.viewing.disruptionReason))) &&
                  <Button variant="outline" onClick={() => {
                    setOutcomeTour(request); setOutcome(request.viewing.status === 'completed' ? 'no_show' : 'completed');
                    setOutcomeReason(''); setOutcomeNotes('');
                  }}>{needsOutcome(request) ? 'Record outcome' : 'Correct outcome'}</Button>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={Boolean(outcomeTour)} onOpenChange={(open) => !open && setOutcomeTour(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record tour outcome</DialogTitle>
            <DialogDescription>Confirm what happened. Correction explanations are shared with the chef. Disruptions are not visitor no-shows.</DialogDescription></DialogHeader>
          <Select value={outcome} onValueChange={(value) => { setOutcome(value as 'completed' | 'no_show' | 'disrupted'); setOutcomeReason(''); }}>
            <SelectTrigger aria-label="Tour outcome"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="completed" disabled={outcomeTour?.viewing.status === 'completed'}>Completed</SelectItem><SelectItem value="no_show" disabled={outcomeTour?.viewing.status === 'no_show'}>Visitor did not attend</SelectItem><SelectItem value="disrupted" disabled={!!outcomeTour?.viewing.disruptionReason}>Disrupted</SelectItem></SelectContent>
          </Select>
          {outcome === 'no_show' && <p className="text-sm text-muted-foreground">Only choose this if the chef did not come. If the manager was unavailable, access failed or weather prevented the visit, record why the tour couldn’t take place instead.</p>}
          {outcome === 'disrupted' && <Select value={outcomeReason} onValueChange={setOutcomeReason}>
            <SelectTrigger aria-label="Disruption reason"><SelectValue placeholder="Select disruption" /></SelectTrigger>
            <SelectContent>{Object.entries(tourDisruptionReasons).map(([reason, label]) => <SelectItem key={reason} value={reason}>{label}</SelectItem>)}</SelectContent>
          </Select>}
          <Textarea aria-label="Message to chef" value={outcomeNotes} onChange={(event) => setOutcomeNotes(event.target.value)} placeholder="Message to chef · shared with the chef and manager" />
          <DialogFooter><Button variant="outline" onClick={() => setOutcomeTour(null)}>Cancel</Button>
            <Button disabled={recordOutcome.isPending || (outcome === 'disrupted' && !outcomeReason)
              || (!!outcomeTour && (['completed', 'no_show'].includes(outcomeTour.viewing.status) || !!outcomeTour.viewing.disruptionReason || (outcome === 'disrupted' && outcomeReason === 'other')) && !outcomeNotes.trim())}
              onClick={() => recordOutcome.mutate()}>{recordOutcome.isPending ? 'Saving…' : 'Save outcome'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decision === "approved" ? "Send request to kitchen manager?" : "Deny tour request?"}</DialogTitle>
            <DialogDescription>
              {decision === "approved"
                ? "The request will become visible to the manager, who can approve or deny it."
                : "The manager will not see this request. The chef will receive your reason."}
            </DialogDescription>
          </DialogHeader>
          {decision === "denied" && <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason for the chef" rows={4} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button>
            <Button
              variant={decision === "denied" ? "destructive" : "default"}
              disabled={review.isPending || (decision === "denied" && !reason.trim())}
              onClick={() => review.mutate()}
            >
              {review.isPending ? "Saving…" : decision === "approved" ? "Send to manager" : "Deny request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
