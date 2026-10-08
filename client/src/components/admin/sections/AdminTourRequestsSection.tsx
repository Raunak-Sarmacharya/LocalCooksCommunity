import { AdminTourVisitEvidence } from '@/components/tour/AdminTourVisitEvidence';
import { TourFunnel } from '@/components/tour/TourFunnel';
import { TourFeedbackPanel } from '@/components/tour/TourFeedbackPanel';
import { AdminTourRepeatPermissionPanel } from '@/components/tour/TourRepeatPermissionPanel';
import { adminTourOutcomeNotes } from '@shared/tour-outcome';
import { TourIntakeDetails } from "@/components/tour/TourIntakeDetails";
import { TourHistoryPanel } from '@/components/tour/TourHistoryPanel';
import { TourChatButton } from '@/components/chat/TourChatButton';
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { tourRequestDecision } from '@shared/tour-request-decision';

type TourRequest = {
  viewing: {
    id: number;
    scheduledAt: string;
    durationMinutes: number;
    chefNotes: string | null;
    intakeData: Record<string, unknown> | null;
    status: string;
    confirmationVerified?: boolean; visitEvidenceState?: string;
    cancelledBy: string | null;
    adminReviewDecision: "approved" | "denied" | null;
    adminReviewReason: string | null;
    adminReviewedAt: string | null;
    createdAt: string;
    updatedAt: string;
    rescheduleProposedSlots?: string[];
    requestedRescheduleAt?: string | null;
    checkedInAt?: string | null;
    rescheduleProposedAt?: string | null;
    requestExpiredAt?: string | null;
    managerNotes?: string | null;
    sharedManagerNotes?: string | null;
    disruptionReason?: string | null;
    outcomeHistory?: Array<{ from: string; to: string; recordedAt: string; actorRole: string; notes?: string | null; sharedNotes?: string | null; outcomeNotes?: string | null; disruptionReason?: string | null }>;
  };
  chefName: string;
  chefUsername: string | null;
  chefEmail: string | null;
  chefPhone: string | null;
  kitchenName: string | null;
  locationName: string | null;
  locationAddress: string | null;
  locationTimezone: string | null;
  managerId?: number | null;
  managerName?: string | null;
  managerEmail?: string | null;
  managerPhone?: string | null;
  reconfirmation?: { reply: string | null; needsStaffAttention: boolean };
};

async function authHeaders() {
  const token = await auth.currentUser?.getIdToken();
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

export function AdminTourRequestsSection() {
  useTourClock();
  const { t } = useTranslation("common");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<TourRequest | null>(null);
  const [decision, setDecision] = useState<"approved" | "denied">("approved");
  const [reason, setReason] = useState("");
  const [tab, setTab] = useState<"pending" | "overdue" | "outcomes" | "history">("pending");
  const [takeover, setTakeover] = useState<TourRequest | null>(null);
  const [takeoverReason, setTakeoverReason] = useState('');
  const [acknowledgeOverlap, setAcknowledgeOverlap] = useState(false);
  const takeoverContext = useQuery<any>({
    queryKey: ['admin-tour-takeover-context', takeover?.viewing.id, takeover?.viewing.updatedAt], enabled: !!takeover,
    queryFn: async () => { const response = await fetch(`/api/viewings/manager/${takeover!.viewing.id}/decision-context`, { headers: await authHeaders(), credentials: 'include' });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Unable to review current availability'); return body; },
  });
  const confirmTakeover = useMutation({ mutationFn: async () => {
    if (!takeover || !takeoverContext.data || takeoverContext.data.updatedAt !== takeover.viewing.updatedAt) throw new Error('Refresh and review this request again');
    const response = await fetch(`/api/viewings/${takeover.viewing.id}/status`, { method: 'PATCH', headers: await authHeaders(), credentials: 'include',
      body: JSON.stringify({ status: 'confirmed', takeoverReason: takeoverReason.trim(), expectedUpdatedAt: takeover.viewing.updatedAt,
        overlapReviewKey: takeoverContext.data.overlapReviewKey, acceptBookingOverlap: acknowledgeOverlap }) });
    const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Unable to confirm tour'); return body;
  }, onSuccess: () => { setTakeover(null); void queryClient.invalidateQueries({ queryKey: ['/api/viewings/admin'] }); },
    onError: (error: Error) => { void queryClient.invalidateQueries({ queryKey: ['/api/viewings/admin'] }); void takeoverContext.refetch(); toast({ title: 'Confirmation failed', description: error.message, variant: 'destructive' }); } });
  const linkedTourId = Number(new URLSearchParams(useSearch()).get('viewing'));
  const openedLink = useRef<number | null>(null);
  const [outcomeTour, setOutcomeTour] = useState<TourRequest | null>(null);
  const [outcome, setOutcome] = useState<'completed' | 'no_show' | 'disrupted' | 'unknown'>('completed');
  const [outcomeReason, setOutcomeReason] = useState('');
  const [outcomeNotes, setOutcomeNotes] = useState('');
  const needsOutcome = (request: TourRequest) => request.viewing.status === 'confirmed'
    && new Date(request.viewing.scheduledAt).getTime() + request.viewing.durationMinutes * 60_000 <= Date.now();
  const pendingConfirmedDecision = (request: TourRequest) => request.viewing.status === 'confirmed' && !request.viewing.checkedInAt && Date.parse(request.viewing.scheduledAt) > Date.now() &&
    (!!request.viewing.requestedRescheduleAt || !!request.viewing.rescheduleProposedSlots?.length || !!request.reconfirmation?.needsStaffAttention || ['reschedule', 'cant_make_it'].includes(request.reconfirmation?.reply || ''));
  const recordOutcome = useMutation({
    mutationFn: async () => {
      if (!outcomeTour) throw new Error('Select a tour');
      const response = await fetch(`/api/viewings/${outcomeTour.viewing.id}/status`, {
        method: 'PATCH', headers: await authHeaders(), credentials: 'include',
        body: JSON.stringify({ expectedUpdatedAt: outcomeTour.viewing.updatedAt, status: ['disrupted', 'unknown'].includes(outcome) ? 'cancelled' : outcome,
          noShowReason: outcome === 'no_show' ? 'visitor_absent' : undefined, disruptionReason: outcome === 'unknown' ? 'outcome_unknown' : outcome === 'disrupted' ? outcomeReason : undefined,
          outcomeNotes: outcomeNotes.trim() || undefined }),
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
    const tour = requests.find(request => request.viewing.id === linkedTourId);
    if (!tour) return;
    setTab(tourRequestDecision(tour.viewing)?.overdue ? 'overdue' : pendingConfirmedDecision(tour) || tour.viewing.status === 'pending_local_cooks' && Date.parse(tour.viewing.scheduledAt) > Date.now() ? 'pending' : needsOutcome(tour) ? 'outcomes' : 'history');
    openedLink.current = linkedTourId;
    requestAnimationFrame(() => document.getElementById(`admin-tour-${linkedTourId}`)?.scrollIntoView?.({ block: 'center' }));
  }, [linkedTourId, requests]);
  const retryDelivery = useMutation({ mutationFn: async (viewingId: number) => {
    const response = await fetch(`/api/viewings/admin/${viewingId}/retry-delivery`, { method: 'POST', headers: await authHeaders(), credentials: 'include' });
    const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Retry failed'); return body;
  }, onSuccess: (body) => { queryClient.invalidateQueries({ queryKey: ['/api/viewings/admin/delivery-status'] });
    toast({ title: body.notificationDeliveryFailed ? 'Some delivery remains pending' : 'Tour communications delivered', description: 'The tour result and kitchen tour times were not changed.' }); },
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
    tab === 'overdue' ? !!tourRequestDecision(request.viewing)?.overdue : tab === "pending" ? pendingConfirmedDecision(request) || request.viewing.status === "pending_local_cooks" && new Date(request.viewing.scheduledAt).getTime() > Date.now()
      : tab === 'outcomes' ? needsOutcome(request) : request.viewing.status !== 'pending_local_cooks' || new Date(request.viewing.scheduledAt).getTime() <= Date.now()
  );
  useEffect(() => {
    if (selected) { const current = requests.find(item => item.viewing.id === selected.viewing.id); if (!current || current.viewing.status !== 'pending_local_cooks') setSelected(null); else if (current.viewing.updatedAt !== selected.viewing.updatedAt) { setSelected(current); setReason(''); } }
    if (takeover) { const current = requests.find(item => item.viewing.id === takeover.viewing.id); if (!current || !tourRequestDecision(current.viewing)?.canTakeOver) setTakeover(null); else if (current.viewing.updatedAt !== takeover.viewing.updatedAt) { setTakeover(current); setTakeoverReason(''); setAcknowledgeOverlap(false); } }
  }, [requests, selected, takeover]);

  const openReview = (request: TourRequest, nextDecision: "approved" | "denied") => {
    setSelected(request);
    setDecision(nextDecision);
    setReason("");
  };

  return (
    <div className="min-w-0 space-y-5 [overflow-wrap:anywhere]">
      {isError && <div role="alert"><p>We couldn’t load tour requests.</p><Button variant="outline" onClick={() => void refetch()}>Try again</Button></div>}
      {!isLoading && !isError && linkedTourId > 0 && !requests.some(request => request.viewing.id === linkedTourId) &&
        <div role="alert"><p>This tour is unavailable. Check your access or try again.</p><Button variant="outline" onClick={() => void refetch()}>Try again</Button></div>}
      <HistoricalVisitReviews />
      {!linkedTourId && <TourFunnel role="admin" />}
      {pendingDeliveries.length > 0 && <Card><CardHeader><CardTitle>Tour communications pending ({pendingDeliveries.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">{Array.from(new Set(pendingDeliveries.map(event => event.viewingId))).map(id => <div key={id} className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span>TOUR-{id} · {pendingDeliveries.filter(event => event.viewingId === id).length} pending events</span>
          <Button variant="outline" className="h-auto min-h-11 whitespace-normal py-2" disabled={retryDelivery.isPending} onClick={() => retryDelivery.mutate(id)}>Retry delivery</Button>
        </div>)}</CardContent></Card>}
      <div>
        <h2 className="text-xl font-semibold">Tour requests</h2>
        <p className="text-sm text-muted-foreground">
          Local Cooks screens each request before it reaches a kitchen manager.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as "pending" | "overdue" | "outcomes" | "history")}>
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:inline-flex sm:w-auto [&>button]:min-h-11 [&>button]:whitespace-normal">
          <TabsTrigger value="overdue">{t('tourOverdueQueue', 'Overdue decisions')} ({requests.filter(request => tourRequestDecision(request.viewing)?.overdue).length})</TabsTrigger>
          <TabsTrigger value="pending">Pending ({requests.filter((request) => pendingConfirmedDecision(request) || request.viewing.status === "pending_local_cooks" && new Date(request.viewing.scheduledAt).getTime() > Date.now()).length})</TabsTrigger>
          <TabsTrigger value="outcomes">Past kitchen tours · results ({requests.filter(needsOutcome).length})</TabsTrigger>
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
        <div className={linkedTourId ? "grid gap-4" : "grid gap-4 lg:grid-cols-2"}>
          {visibleRequests.map((request) => (
            <Card key={request.viewing.id} id={`admin-tour-${request.viewing.id}`} className={`min-w-0 [overflow-wrap:anywhere] ${request.viewing.id === linkedTourId ? "border-primary" : ""}`}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{request.chefName || request.chefUsername || "Chef"}</CardTitle>
                    <CardDescription>{request.kitchenName || request.locationName || "Kitchen tour"}</CardDescription>
                  </div>
                  <Badge variant={request.viewing.status === "cancelled" || request.viewing.status === "no_show" ? "destructive" : request.viewing.status === "confirmed" || request.viewing.status === "completed" ? "success" : "warning"}>
                    {request.viewing.requestExpiredAt || ['pending_local_cooks', 'pending'].includes(request.viewing.status) && new Date(request.viewing.scheduledAt).getTime() <= Date.now() ? 'Request expired' : request.viewing.status === "cancelled"
                      ? request.viewing.disruptionReason ? "Disrupted" : request.viewing.adminReviewDecision === "denied" || request.viewing.cancelledBy === "manager_declined" ? "Rejected" : "Cancelled"
                      : request.viewing.status === "confirmed" ? "Confirmed"
                      : request.viewing.status === "completed" ? "Completed"
                      : request.viewing.status === "no_show" ? "No show"
                      : request.viewing.adminReviewDecision === "approved" ? "Request sent" : "Local Cooks review"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className={linkedTourId ? "grid min-w-0 items-start gap-4 text-sm xl:grid-cols-[minmax(0,1fr)_20rem]" : "min-w-0 space-y-4 text-sm"}>
                <div className="min-w-0 space-y-3">
                <TourChatButton tour={request.viewing} role="admin" buttonLabel={t('tourChatParticipants', 'Chat with chef and manager')} />
                {request.viewing.status === 'pending_local_cooks' && <p className="text-xs text-muted-foreground">{t('tourChatAfterReview', 'Messaging becomes available after this request is forwarded to the kitchen manager.')}</p>}
                {pendingConfirmedDecision(request) && <p className="rounded-lg border p-3 text-xs">{t('tourConfirmedDecisionPending', 'A tour reply or time-change decision needs attention. The appointment remains confirmed; the current manager owns any requested time change.')}</p>}
                {(() => { const stage = tourRequestDecision(request.viewing); return stage && <div className="rounded-lg border p-3 text-xs">
                  <p>{t('tourDecisionOwner', 'Responsible')}: {stage.stage === 'triage' ? 'Local Cooks' : stage.stage === 'chef_offer' ? request.chefName || 'Visitor' : request.managerName || 'Kitchen manager'}</p>
                  <p>{stage.stage === 'chef_offer' ? t('tourOfferResponseBefore', 'Invitation response before') : t('tourDecisionDue', 'Decision due')}: {stage.dueAt ? formatTourWhen(stage.dueAt, null, 'America/St_Johns') : t('tourDecisionTimeUnknown', 'Time not recorded')}</p>
                  {stage.startedAt && <p>{t('tourDecisionAge', { hours: Math.max(0, Math.floor((Date.now() - Date.parse(stage.startedAt)) / 3_600_000)), defaultValue: 'Waiting {hours} hours' })}</p>}
                  {stage.overdue && <p className="font-medium text-destructive">{t('tourDecisionOverdue', 'Decision overdue')}</p>}
                </div>; })()}
                <div><span className="font-medium">Tour reference:</span> TOUR-{request.viewing.id}</div>
                <div><span className="font-medium">Submitted:</span> {formatTourWhen(request.viewing.createdAt, null, request.locationTimezone || "America/St_Johns")}</div>
                <div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />{formatTourWhen(request.viewing.scheduledAt, request.viewing.durationMinutes, request.locationTimezone || "America/St_Johns")} · {request.viewing.durationMinutes} min</div>
                <div className="flex items-center gap-2"><MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />{request.locationName || "Kitchen"}{request.locationAddress ? ` · ${request.locationAddress}` : ""}</div>
                {request.chefEmail && <div className="flex items-center gap-2"><Mail className="h-4 w-4 shrink-0 text-muted-foreground" /><a className="text-primary hover:underline" href={`mailto:${request.chefEmail}`}>{request.chefEmail}</a></div>}
                {request.chefPhone && <div className="flex items-center gap-2"><Phone className="h-4 w-4 shrink-0 text-muted-foreground" /><a className="text-primary hover:underline" href={`tel:${request.chefPhone}`}>{request.chefPhone}</a></div>}
                <section aria-label={t("tourManagerContactTitle", "Kitchen manager")} className="rounded-md border p-3 space-y-2">
                  <h3 className="text-xs font-medium text-muted-foreground">{t("tourManagerContactTitle", "Kitchen manager")}</h3>
                  {request.managerId != null ? <>
                    <p className="font-medium">{request.managerName || t("tourManagerContactTitle", "Kitchen manager")}</p>
                    {request.managerEmail && <div className="flex items-center gap-2"><Mail className="h-4 w-4 shrink-0 text-muted-foreground" /><a className="text-primary hover:underline break-all" href={`mailto:${request.managerEmail}`}>{request.managerEmail}</a></div>}
                    {request.managerPhone && <div className="flex items-center gap-2"><Phone className="h-4 w-4 shrink-0 text-muted-foreground" /><a className="text-primary hover:underline" href={`tel:${request.managerPhone}`}>{request.managerPhone}</a></div>}
                    {!request.managerEmail && !request.managerPhone && <p className="text-muted-foreground">{t("tourManagerContactUnavailable", "Manager contact details are unavailable")}</p>}
                  </> : <p className="text-muted-foreground">{request.managerId === null ? t("tourManagerUnassigned", "No manager assigned") : t("tourManagerContactUnavailable", "Manager contact details are unavailable")}</p>}
                </section>
                {request.viewing.chefNotes && <p className="rounded-md bg-muted p-3"><span className="font-medium">Chef notes:</span> {request.viewing.chefNotes}</p>}
                {request.viewing.adminReviewReason && <p className="rounded-md bg-muted p-3"><span className="font-medium">Review reason:</span> {request.viewing.adminReviewReason}</p>}
                {request.viewing.sharedManagerNotes && <p><strong>Manager notes:</strong> {request.viewing.sharedManagerNotes}</p>}
                {adminTourOutcomeNotes(request.viewing) && <p className="whitespace-pre-wrap"><strong>Outcome notes · admin only:</strong> {adminTourOutcomeNotes(request.viewing)}</p>}
                {request.viewing.managerNotes && <p className="rounded-md border p-3"><strong>Internal notes · admin only:</strong> {request.viewing.managerNotes}</p>}
                {request.viewing.disruptionReason && <p>{request.viewing.disruptionReason === 'outcome_unknown' ? t('tourFeedbackUnverified') : <><strong>Disruption:</strong> {tourDisruptionReasons[request.viewing.disruptionReason as keyof typeof tourDisruptionReasons] || request.viewing.disruptionReason}</>}</p>}
                {hasTourConfirmation(request.viewing) && Date.parse(request.viewing.scheduledAt) + request.viewing.durationMinutes * 60_000 <= Date.now() && <TourFeedbackPanel id={request.viewing.id} role="admin" version={request.viewing.updatedAt} />}
                {(['completed', 'no_show'].includes(request.viewing.status) || request.viewing.status === 'cancelled' && !!request.viewing.disruptionReason) &&
                  <AdminTourVisitEvidence id={request.viewing.id} version={request.viewing.updatedAt} needsReview={request.viewing.visitEvidenceState === 'review'} />}
                {(request.viewing.status === 'completed' || request.viewing.disruptionReason === 'outcome_unknown') && <AdminTourRepeatPermissionPanel id={request.viewing.id} version={request.viewing.updatedAt} />}
                {request.viewing.adminReviewedAt && <p><span className="font-medium">Reviewed:</span> {formatTourWhen(request.viewing.adminReviewedAt, null, request.locationTimezone || "America/St_Johns")}</p>}
                {request.viewing.intakeData && Object.keys(request.viewing.intakeData).length > 0 && (
                  <div className="rounded-md border p-3"><TourIntakeDetails data={request.viewing.intakeData} /></div>
                )}
                {request.viewing.status === "pending_local_cooks" && <div className="grid gap-2 pt-1 sm:flex sm:justify-end [&>button]:h-auto [&>button]:min-h-11 [&>button]:whitespace-normal [&>button]:py-2">
                  <Button variant="outline" onClick={() => openReview(request, "denied")}><X className="mr-2 h-4 w-4" />Deny</Button>
                  <Button disabled={new Date(request.viewing.scheduledAt).getTime() <= Date.now()} onClick={() => openReview(request, "approved")}><Check className="mr-2 h-4 w-4" />Approve for manager</Button>
                </div>}
                {tourRequestDecision(request.viewing)?.canTakeOver && <Button variant="outline" onClick={() => { setTakeover(request); setTakeoverReason(''); setAcknowledgeOverlap(false); }}>{t('tourTakeoverConfirm', 'Review and confirm overdue request')}</Button>}
                {(needsOutcome(request) || (hasTourConfirmation(request.viewing) && (['completed', 'no_show'].includes(request.viewing.status) || request.viewing.disruptionReason))) &&
                  <Button variant="outline" onClick={() => {
                    setOutcomeTour(request); setOutcome(request.viewing.status === 'completed' ? 'no_show' : 'completed');
                    setOutcomeReason(''); setOutcomeNotes('');
                  }}>{needsOutcome(request) ? 'Record outcome' : 'Correct outcome'}</Button>}
                </div>
                <aside className="min-w-0"><TourHistoryPanel id={request.viewing.id} version={request.viewing.updatedAt} role="admin" /></aside>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!takeover} onOpenChange={open => !open && !confirmTakeover.isPending && setTakeover(null)}>
        <DialogContent className="min-w-0 [overflow-wrap:anywhere]"><DialogHeader><DialogTitle>{t('tourTakeoverConfirm', 'Review and confirm overdue request')}</DialogTitle><DialogDescription>{t('tourTakeoverHelp', 'Confirm the current tour time after reviewing availability. Your reason will be shared with the visitor and manager.')}</DialogDescription></DialogHeader>
          {takeoverContext.isFetching && <p role="status">{t('tourReviewLoading', 'Checking current availability…')}</p>}
          {takeoverContext.isError && <div><p role="alert">{String(takeoverContext.error.message)}</p><Button variant="outline" onClick={() => void takeoverContext.refetch()}>{t('retry', 'Retry')}</Button></div>}
          {takeoverContext.data && <><p>{formatTourWhen(takeoverContext.data.scheduledAt, takeover?.viewing.durationMinutes, 'America/St_Johns')}</p>
            {takeoverContext.data.overlaps?.map((overlap: any) => <p key={overlap.bookingId}>{overlap.reference} · {formatTourWhen(overlap.start, null, 'America/St_Johns')}</p>)}
            {!!takeoverContext.data.overlaps?.length && <label className="flex gap-2 text-sm"><input type="checkbox" checked={acknowledgeOverlap} onChange={event => setAcknowledgeOverlap(event.target.checked)} />{t('tourTakeoverOverlap', 'I reviewed the overlapping bookings and can safely host this tour.')}</label>}</>}
          <Textarea aria-label={t('tourTakeoverReason', 'Shared confirmation reason')} maxLength={500} value={takeoverReason} onChange={event => setTakeoverReason(event.target.value)} />
          <DialogFooter className="gap-2 sm:space-x-0 [&>button]:h-auto [&>button]:min-h-11 [&>button]:whitespace-normal [&>button]:py-2"><Button variant="outline" disabled={confirmTakeover.isPending} onClick={() => setTakeover(null)}>{t('cancel', 'Cancel')}</Button><Button disabled={confirmTakeover.isPending || takeoverContext.isFetching || takeoverContext.isError || !takeoverContext.data || takeoverContext.data.updatedAt !== takeover?.viewing.updatedAt || takeoverReason.trim().length < 10 || (!!takeoverContext.data.overlaps?.length && !acknowledgeOverlap)} onClick={() => confirmTakeover.mutate()}>{t('tourConfirmTakeover', 'Confirm tour')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(outcomeTour)} onOpenChange={(open) => !open && setOutcomeTour(null)}>
        <DialogContent className="min-w-0 [overflow-wrap:anywhere]">
          <DialogHeader><DialogTitle>Record tour outcome</DialogTitle>
            <DialogDescription>Review both private feedback responses before choosing the final outcome. Record your reasoning in admin-only notes. The chef and manager receive the outcome status without these notes. Absence is never inferred from silence.</DialogDescription></DialogHeader>
          <Select value={outcome} onValueChange={(value) => { setOutcome(value as 'completed' | 'no_show' | 'disrupted' | 'unknown'); setOutcomeReason(''); }}>
            <SelectTrigger className="h-auto min-h-11 text-left [&>span]:min-w-0 [&>span]:line-clamp-none [&>span]:whitespace-normal" aria-label="Tour outcome"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="completed" disabled={outcomeTour?.viewing.status === 'completed'}>Completed</SelectItem><SelectItem value="no_show" disabled={outcomeTour?.viewing.status === 'no_show'}>Visitor did not attend</SelectItem><SelectItem value="disrupted" disabled={!!outcomeTour?.viewing.disruptionReason}>Disrupted</SelectItem><SelectItem value="unknown">Close without a verified outcome</SelectItem></SelectContent>
          </Select>
          {outcome === 'no_show' && <p className="text-sm text-muted-foreground">Only choose this if the chef did not come. If the manager was unavailable, access failed or weather prevented the kitchen tour, record why the tour couldn’t take place instead.</p>}
          {outcome === 'disrupted' && <Select value={outcomeReason} onValueChange={setOutcomeReason}>
            <SelectTrigger className="h-auto min-h-11 text-left [&>span]:min-w-0 [&>span]:line-clamp-none [&>span]:whitespace-normal" aria-label="Disruption reason"><SelectValue placeholder="Select disruption" /></SelectTrigger>
            <SelectContent>{Object.entries(tourDisruptionReasons).map(([reason, label]) => <SelectItem key={reason} value={reason}>{label}</SelectItem>)}</SelectContent>
          </Select>}
          <Textarea aria-label="Internal outcome notes" required minLength={10} maxLength={2000} value={outcomeNotes} onChange={(event) => setOutcomeNotes(event.target.value)} placeholder="Explain the final decision · visible only to Local Cooks admins" />
          <DialogFooter className="gap-2 sm:space-x-0 [&>button]:h-auto [&>button]:min-h-11 [&>button]:whitespace-normal [&>button]:py-2"><Button variant="outline" onClick={() => setOutcomeTour(null)}>Cancel</Button>
            <Button disabled={recordOutcome.isPending || (outcome === 'disrupted' && !outcomeReason)
              || outcomeNotes.trim().length < 10}
              onClick={() => recordOutcome.mutate()}>{recordOutcome.isPending ? 'Saving…' : 'Save outcome'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="min-w-0 [overflow-wrap:anywhere]">
          <DialogHeader>
            <DialogTitle>{decision === "approved" ? "Send request to kitchen manager?" : "Deny tour request?"}</DialogTitle>
            <DialogDescription>
              {decision === "approved"
                ? "The request will become visible to the manager, who can approve or deny it."
                : "The manager will not see this request. The chef will receive your reason."}
            </DialogDescription>
          </DialogHeader>
          {decision === "denied" && <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason for the chef" rows={4} />}
          <DialogFooter className="gap-2 sm:space-x-0 [&>button]:h-auto [&>button]:min-h-11 [&>button]:whitespace-normal [&>button]:py-2">
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
