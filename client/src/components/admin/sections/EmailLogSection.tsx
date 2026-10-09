import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AppDialogContent } from "@/components/ui/app-dialog";
import { CheckCircle, ChevronLeft, ChevronRight, Download, Eye, Mail, RefreshCw, Search, XCircle, AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import { downloadCSV as sharedDownloadCSV } from "@/lib/formatters";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface EmailLogSectionProps {
  getFirebaseToken: () => Promise<string>;
}

interface EmailLogRecord {
  delivery?: { source: string; sourceId: number | null; eventId: number | null; resource: string; channel: string;
    originalLogId: number; dueAt: string | null; nextAttemptAt: string | null; attempts: number | null;
    lastAttemptAt: string | null; attemptStatus: string; eventAttempts: number | null; state: string; destination: string; recipientDestination?: string; recovery: string; suppression: string | null };
  id: number;
  recipientEmail: string;
  recipientUserId: number | null;
  recipientRole: string;
  subject: string;
  previewText: string | null;
  category: string;
  status: string;
  errorMessage: string | null;
  trackingId: string | null;
  smtpMessageId: string | null;
  fromAddress: string | null;
  retryCount: number;
  retriedAt: string | null;
  retryOfId: number | null;
  canRetry: boolean;
  createdAt: string;
}

interface EmailLogListResponse {
  logs: EmailLogRecord[];
  total: number;
  limit: number;
  offset: number;
}

interface EmailLogStats {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  last24h: number;
  failedLast24h: number;
  chefs: number;
  managers: number;
}

const PAGE_SIZE = 50;

const CATEGORY_OPTIONS = [
  { value: "all", label: "All categories" },
  { value: "advance_reminder", label: "Scheduled actions" },
  { value: "advance_reminder_attempt", label: "Reminder attempts" },
  { value: "lifecycle_outcome_attempt", label: "Outcome attempts" },
  { value: "booking", label: "Booking" },
  { value: "application", label: "Application" },
  { value: "verification", label: "Verification" },
  { value: "welcome", label: "Welcome" },
  { value: "promo", label: "Promo" },
  { value: "damage_claim", label: "Damage claim" },
  { value: "lifecycle_outcome", label: "Outcome intent" },
  { value: "overstay", label: "Overstay" },
  { value: "Kitchen Tour", label: "Kitchen Tour" },
  { value: "license", label: "License" },
  { value: "checkin", label: "Check-in / out" },
  { value: "access", label: "Access" },
  { value: "storage", label: "Storage" },
  { value: "password", label: "Password" },
  { value: "cancellation", label: "Cancellation" },
  { value: "refund", label: "Refund" },
  { value: "payout", label: "Payout" },
  { value: "general", label: "General" },
];

function formatDateTimeSt(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleString("en-US", {
      timeZone: "America/St_Johns",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function roleLabel(role: string): string {
  switch (role) {
    case "chef":
      return "Chef";
    case "manager":
      return "Manager";
    case "chef_and_manager":
      return "Chef & Manager";
    case "admin":
      return "Admin";
    case "portal":
      return "Portal";
    default:
      return "Unknown";
  }
}

function categoryLabel(category: string): string {
  return CATEGORY_OPTIONS.find((option) => option.value === category)?.label
    || category.replace(/_/g, " ");
}

function statusBadge(status: string) {
  if (status === "scheduled") return <Badge variant="secondary">Scheduled action</Badge>;
  if (status === "suppressed") return <Badge variant="secondary">Obsolete action suppressed</Badge>;
  if (status === "queued") return <Badge variant="secondary">Pending delivery</Badge>;
  if (status === "sent") {
    return (
      <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
        <CheckCircle className="mr-1 h-3 w-3" />
        Acknowledged
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive">
        <XCircle className="mr-1 h-3 w-3" />
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      <AlertTriangle className="mr-1 h-3 w-3" />
      Skipped
    </Badge>
  );
}

export function EmailLogSection({ getFirebaseToken }: EmailLogSectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [role, setRole] = useState("chefs_and_managers");
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(0);
  const [selectedLog, setSelectedLog] = useState<EmailLogRecord | null>(null);
  const [eventPage, setEventPage] = useState(0);
  const [deliveryReview, setDeliveryReview] = useState<{ id: number; key: string; recipient: string; lastAttemptAt: string } | null>(null);
  const [deliveryEvidence, setDeliveryEvidence] = useState('');
  const pendingQuery = useQuery<{ events: { source: string; id: number; reservationId: number;
    attempts: number | null; dueAt: string; nextAttemptAt: string | null; paused?: boolean; leaseUntil: string | null; destination: string; acknowledgmentCount: number;
    recoveryOwnerIds: number[]; recipients: { key?: string; recipient: string; channel: string; acknowledged: boolean; needsReview?: boolean; lastAttemptAt?: string | null; diagnostic?: string | null }[] }[] }>({
    queryKey: ['/api/admin/email-logs/pending-events', eventPage],
    queryFn: async () => {
      const token = await getFirebaseToken();
      const response = await fetch(`/api/admin/email-logs/pending-events?offset=${eventPage * 50}`, { headers: { Authorization: `Bearer ${token}` }, credentials: 'include' });
      if (!response.ok) throw new Error('Pending delivery events unavailable');
      return response.json();
    }, staleTime: 15_000,
  });
  const eventRetry = useMutation({
    mutationFn: async (event: { source: string; id: number }) => {
      const token = await getFirebaseToken();
      const response = await fetch(`/api/admin/email-logs/events/${event.source}/${event.id}/retry`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` }, credentials: 'include' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Original event remains pending');
      return data;
    }, onSuccess: data => toast.success('Recovery checked', { description: data.message }),
    onError: (error: Error) => toast.error('Recovery pending', { description: error.message }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['/api/admin/email-logs'] }).then(() =>
      queryClient.invalidateQueries({ queryKey: ['/api/admin/email-logs/pending-events'] })),
  });
  const reconcileDelivery = useMutation({
    mutationFn: async (decision: 'accepted' | 'resend') => {
      if (!deliveryReview) throw new Error('Select an attempt to review');
      const token = await getFirebaseToken();
      const response = await fetch(`/api/admin/email-logs/events/tour/${deliveryReview.id}/reconcile`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ key: deliveryReview.key, lastAttemptAt: deliveryReview.lastAttemptAt, decision, evidence: deliveryEvidence.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Delivery reconciliation failed');
      return data;
    }, onSuccess: data => { toast.success('Delivery reviewed', { description: data.message }); setDeliveryReview(null); setDeliveryEvidence(''); },
    onError: (error: Error) => toast.error('Review pending', { description: error.message }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['/api/admin/email-logs'] }).then(() =>
      queryClient.invalidateQueries({ queryKey: ['/api/admin/email-logs/pending-events'] })),
  });

  const offset = page * PAGE_SIZE;

  const statsQuery = useQuery<EmailLogStats>({
    queryKey: ["/api/admin/email-logs/stats"],
    queryFn: async () => {
      const token = await getFirebaseToken();
      const response = await fetch("/api/admin/email-logs/stats", {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to load email stats");
      return response.json();
    },
    staleTime: 15_000,
  });

  const logsQuery = useQuery<EmailLogListResponse>({
    queryKey: ["/api/admin/email-logs", search, status, role, category, offset],
    queryFn: async () => {
      const token = await getFirebaseToken();
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        role,
      });
      if (search) params.set("search", search);
      if (status !== "all") params.set("status", status);
      if (category !== "all") params.set("category", category);
      const response = await fetch(`/api/admin/email-logs?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to load email logs");
      return response.json();
    },
    staleTime: 10_000,
  });

  const retryMutation = useMutation({
    mutationFn: async (logId: number) => {
      const token = await getFirebaseToken();
      const response = await fetch(`/api/admin/email-logs/${logId}/retry`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Failed to retry email");
      }
      return data as { success: boolean; message?: string };
    },
    onSuccess: (data) => {
      toast.success("Delivery reconciled", {
        description: data.message || "Original acknowledgment recorded; inbox receipt is not confirmed.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/email-logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/email-logs/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/email-logs/pending-events"] });
      setSelectedLog(null);
    },
    onError: (error: Error) => {
      toast.error("Retry failed", { description: error.message });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/email-logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/email-logs/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/email-logs/pending-events"] });
    },
  });

  const logs = logsQuery.data?.logs ?? [];
  const total = logsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const stats = statsQuery.data;

  const applySearch = useCallback(() => {
    setPage(0);
    setSearch(searchInput.trim());
  }, [searchInput]);

  const handleExportCSV = useCallback(() => {
    const header = ["Sent At", "Recipient", "Role", "Subject", "Category", "Status", "Error", "Tracking ID"];
    const rows = logs.map((log) => [
      formatDateTimeSt(log.createdAt),
      log.recipientEmail,
      roleLabel(log.recipientRole),
      `"${(log.subject || "").replace(/"/g, '""')}"`,
      categoryLabel(log.category),
      log.status,
      `"${(log.errorMessage || "").replace(/"/g, '""')}"`,
      log.trackingId || "",
    ]);
    const csv = [header.join(","), ...rows.map((row) => row.join(","))].join("\n");
    sharedDownloadCSV(csv, `admin-email-log-${new Date().toISOString().split("T")[0]}`);
  }, [logs]);

  const isLoading = logsQuery.isLoading || statsQuery.isLoading;

  const rangeLabel = useMemo(() => {
    if (total === 0) return "0 emails";
    const start = offset + 1;
    const end = Math.min(offset + PAGE_SIZE, total);
    return `${start}–${end} of ${total}`;
  }, [offset, total]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (logsQuery.isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800">
        Could not load the email log. Refresh the page or try again in a moment.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Email Log</h1>
        <p className="text-muted-foreground">
          Track scheduled actions, original outcomes and attempts. Email acknowledgment means SMTP acceptance; inbox receipt is unverified. In-app acknowledgment is separate.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Pending original decisions</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>Local Cooks owns delivery recovery. These events may have no email attempt yet. Retry preserves original acknowledgments and decision ordering. Verify contact and missed response opportunity in the current source.</p>
          {pendingQuery.isError ? <p role="alert">Pending decisions could not be loaded. Refresh to retry.</p> : pendingQuery.isLoading ? <p>Loading pending decisions…</p> : !pendingQuery.data?.events.length ? <p>No pending original decision events.</p> : pendingQuery.data.events.map(event => (
            <div className="rounded border p-3 flex flex-wrap items-center gap-3" key={`${event.source}:${event.id}`}>
              <span>{event.source} #{event.reservationId} · event #{event.id} · {event.acknowledgmentCount} channel acknowledgments · {event.paused ? 'automatic delivery paused for review' : `next attempt ${formatDateTimeSt(event.nextAttemptAt)}`}{event.leaseUntil ? ` · lease until ${formatDateTimeSt(event.leaseUntil)}` : ''}</span>
              <span>Due {formatDateTimeSt(event.dueAt)} · assigned recovery owners: {event.recoveryOwnerIds.join(', ') || 'Local Cooks; assignment occurs on first failure'} · attempts: {event.attempts ?? 'not counted by ledger'}</span>
              <span>{event.recipients.map(person => `${person.recipient} (${person.channel}: ${person.acknowledged ? 'acknowledged' : person.needsReview ? 'review required; resend paused' : 'pending'})`).join('; ') || 'No pending email recipients; inspect current source'}</span>
              {event.source === 'tour' && event.recipients.filter(person => person.needsReview && person.key && person.lastAttemptAt).map(person => (
                <div key={person.key} className="w-full space-y-2">
                  <p>{person.recipient}: {person.diagnostic || 'Automatic retry limit reached; verify delivery before recovery.'}</p>
                  <Button variant="outline" size="sm" disabled={!!(event.leaseUntil && Date.parse(event.leaseUntil) > Date.now())}
                    onClick={() => { setDeliveryEvidence(''); setDeliveryReview({ id: event.id, key: person.key!, recipient: person.recipient, lastAttemptAt: person.lastAttemptAt! }); }}>
                    Review delivery for {person.recipient}
                  </Button>
                </div>
              ))}
              <a className="underline" href={event.destination}>Open current source</a>
              <Button variant="outline" size="sm" disabled={eventRetry.isPending || !!(event.leaseUntil && Date.parse(event.leaseUntil) > Date.now())} onClick={() => eventRetry.mutate(event)}>Recover original event</Button>
            </div>
          ))}
          <p>Up to 50 pending events per source per page; earlier decisions remain ahead of later ones until acknowledged or assigned recovery ownership.</p>
          <div className="flex gap-2 items-center">
            <Button variant="outline" size="sm" disabled={!eventPage} onClick={() => setEventPage(page => page - 1)}>Previous events</Button>
            <span>Page {eventPage + 1}</span>
            <Button variant="outline" size="sm" disabled={pendingQuery.isFetching || !['booking', 'tour'].some(source => (pendingQuery.data?.events.filter(event => event.source === source).length || 0) >= 50)} onClick={() => setEventPage(page => page + 1)}>Next events</Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!deliveryReview} onOpenChange={open => { if (!open && !reconcileDelivery.isPending) setDeliveryReview(null); }}>
        <AppDialogContent>
          <DialogHeader><DialogTitle>Review tour email delivery</DialogTitle>
            <DialogDescription>This email may already have arrived. Check provider records or the recipient’s inbox before deciding. A resend can create another copy.</DialogDescription>
          </DialogHeader>
          <p>{deliveryReview?.recipient}</p>
          <label htmlFor="delivery-evidence">What delivery evidence did you check?</label>
          <Input id="delivery-evidence" value={deliveryEvidence} onChange={event => setDeliveryEvidence(event.target.value)} maxLength={1000} />
          <div className="flex flex-wrap gap-2">
            <Button disabled={reconcileDelivery.isPending || deliveryEvidence.trim().length < 10} onClick={() => reconcileDelivery.mutate('accepted')}>Record verified delivery</Button>
            <Button variant="outline" disabled={reconcileDelivery.isPending || deliveryEvidence.trim().length < 10} onClick={() => reconcileDelivery.mutate('resend')}>Authorize one resend</Button>
          </div>
        </AppDialogContent>
      </Dialog>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Total logged</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.total ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">{stats?.last24h ?? 0} in last 24 hours</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Accepted</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats?.sent ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">SMTP attempt records; excludes intent and in-app rows</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Failed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats?.failed ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">{stats?.failedLast24h ?? 0} failed in last 24 hours</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Chefs / Managers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.chefs ?? 0} / {stats?.managers ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Recipient roles on logged emails</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search email, subject, tracking ID..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applySearch();
            }}
            className="pl-8"
          />
        </div>
        <Select
          value={role}
          onValueChange={(value) => {
            setRole(value);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Recipients" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="chefs_and_managers">Chefs & managers</SelectItem>
            <SelectItem value="chef">Chefs</SelectItem>
            <SelectItem value="manager">Managers</SelectItem>
            <SelectItem value="all">All recipients</SelectItem>
            <SelectItem value="admin">Admins</SelectItem>
            <SelectItem value="unknown">Unknown</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="due">Due / overdue intents</SelectItem>
            <SelectItem value="sent">Acknowledged</SelectItem>
            <SelectItem value="scheduled">Scheduled actions</SelectItem>
            <SelectItem value="suppressed">Obsolete actions suppressed</SelectItem>
            <SelectItem value="queued">Pending delivery</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="skipped_duplicate">Skipped</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={category}
          onValueChange={(value) => {
            setCategory(value);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORY_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={applySearch}>
          Search
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={logs.length === 0}>
          <Download className="h-4 w-4 mr-1" /> CSV
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">{rangeLabel}</span>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Logged</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Attempt / current channel</TableHead>
                  <TableHead className="w-[120px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                      <Mail className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      No emails logged yet. New sends to chefs and managers will appear here.
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {formatDateTimeSt(log.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-sm truncate max-w-[220px]">{log.recipientEmail}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{roleLabel(log.recipientRole)}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="max-w-[280px] truncate text-sm">{log.subject}</div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {categoryLabel(log.category)}
                      </TableCell>
                      <TableCell>{statusBadge(log.status)}{log.delivery && <div className="mt-1 text-xs">{log.delivery.channel} · {log.delivery.state}<br />Due {formatDateTimeSt(log.delivery.dueAt)}</div>}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {["failed", "queued", "scheduled"].includes(log.status) && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={!log.canRetry || retryMutation.isPending}
                                      onClick={() => retryMutation.mutate(log.id)}
                                    >
                                      {retryMutation.isPending && retryMutation.variables === log.id ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <RotateCcw className="h-3.5 w-3.5" />
                                      )}
                                      <span className="sr-only">Retry email</span>
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {log.canRetry
                                    ? "Check current action and reconcile original delivery"
                                    : "Future, accepted, suppressed, leased or unsupported legacy action: open details for recovery"}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => setSelectedLog(log)}>
                            <Eye className="h-4 w-4" />
                            <span className="sr-only">View details</span>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            <ChevronLeft className="h-4 w-4 mr-1" /> Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}

      <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <AppDialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Email details</DialogTitle>
            <DialogDescription>
              Delivery record for this outgoing message.
            </DialogDescription>
          </DialogHeader>
          {selectedLog && (
            <div className="mt-6 space-y-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                {statusBadge(selectedLog.status)}
              </div>
              <div className="flex items-start justify-between gap-4">
                <span className="text-muted-foreground">Recipient</span>
                <span className="text-right break-all">{selectedLog.recipientEmail}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Role</span>
                <span>{roleLabel(selectedLog.recipientRole)}</span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <span className="text-muted-foreground">Subject</span>
                <span className="text-right">{selectedLog.subject}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Category</span>
                <span>{categoryLabel(selectedLog.category)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Logged at</span>
                <span>{formatDateTimeSt(selectedLog.createdAt)}</span>
              </div>
              {selectedLog.delivery && <div className="rounded border p-3 space-y-2">
                <p>Current channel: {selectedLog.delivery.state} · {selectedLog.delivery.channel}</p>
                <p>This attempt: {selectedLog.delivery.attemptStatus}</p>
                <p>Source: {selectedLog.delivery.source} #{selectedLog.delivery.sourceId ?? 'unavailable'} · original {selectedLog.delivery.eventId ? 'attempt log' : 'intent/log'} #{selectedLog.delivery.originalLogId}{selectedLog.delivery.eventId ? ` · event #${selectedLog.delivery.eventId}` : ''} · {selectedLog.delivery.resource}</p>
                <p>Due: {formatDateTimeSt(selectedLog.delivery.dueAt)} · next attempt: {formatDateTimeSt(selectedLog.delivery.nextAttemptAt)} (first eligible worker run)</p>
                <p>Recorded channel attempts: {selectedLog.delivery.attempts ?? 'not counted by original ledger'} · last: {formatDateTimeSt(selectedLog.delivery.lastAttemptAt)}{selectedLog.delivery.eventAttempts != null ? ` · event processing runs: ${selectedLog.delivery.eventAttempts}` : ''}</p>
                {selectedLog.delivery.suppression && <p>{selectedLog.delivery.suppression}</p>}
                <p>{selectedLog.delivery.recovery}</p>
                {selectedLog.delivery.recipientDestination && <p>Intended participant action: {selectedLog.delivery.recipientDestination} (requires that participant’s role and ownership).</p>}
                <a className="underline" href={selectedLog.delivery.destination}>Open current source as Local Cooks</a>
              </div>}
              {selectedLog.fromAddress && (
                <div className="flex items-start justify-between gap-4">
                  <span className="text-muted-foreground">From</span>
                  <span className="text-right break-all">{selectedLog.fromAddress}</span>
                </div>
              )}
              {selectedLog.trackingId && (
                <div className="flex items-start justify-between gap-4">
                  <span className="text-muted-foreground">Tracking ID</span>
                  <span className="font-mono text-xs text-right break-all">{selectedLog.trackingId}</span>
                </div>
              )}
              {selectedLog.smtpMessageId && (
                <div className="flex items-start justify-between gap-4">
                  <span className="text-muted-foreground">SMTP message ID</span>
                  <span className="font-mono text-xs text-right break-all">{selectedLog.smtpMessageId}</span>
                </div>
              )}
              {selectedLog.errorMessage && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-800">
                  <p className="font-medium mb-1">Attempt diagnostic</p>
                  <p className="text-xs whitespace-pre-wrap">{selectedLog.errorMessage}</p>
                </div>
              )}
              {(selectedLog.retryCount > 0 || selectedLog.retriedAt) && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Retries</span>
                  <span>
                    {selectedLog.retryCount || 0}
                    {selectedLog.retriedAt ? ` · last ${formatDateTimeSt(selectedLog.retriedAt)}` : ""}
                  </span>
                </div>
              )}
              {selectedLog.retryOfId && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Retry of</span>
                  <span className="font-mono text-xs">#{selectedLog.retryOfId}</span>
                </div>
              )}
              {["failed", "queued", "scheduled"].includes(selectedLog.status) && (
                <Button
                  className="w-full"
                  disabled={!selectedLog.canRetry || retryMutation.isPending}
                  onClick={() => retryMutation.mutate(selectedLog.id)}
                >
                  {retryMutation.isPending && retryMutation.variables === selectedLog.id ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RotateCcw className="h-4 w-4 mr-2" />
                  )}
                  Check current action / retry original
                </Button>
              )}
              {selectedLog.previewText && (
                <div>
                  <p className="text-muted-foreground mb-1">Preview</p>
                  <p className="rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
                    {selectedLog.previewText}
                  </p>
                </div>
              )}
            </div>
          )}
        </AppDialogContent>
      </Dialog>
    </div>
  );
}
