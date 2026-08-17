import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  Mail,
  RefreshCw,
  Search,
  XCircle,
  AlertTriangle,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { downloadCSV as sharedDownloadCSV } from "@/lib/formatters";
import { useToast } from "@/hooks/use-toast";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface EmailLogSectionProps {
  getFirebaseToken: () => Promise<string>;
}

interface EmailLogRecord {
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
  { value: "booking", label: "Booking" },
  { value: "application", label: "Application" },
  { value: "verification", label: "Verification" },
  { value: "welcome", label: "Welcome" },
  { value: "promo", label: "Promo" },
  { value: "damage_claim", label: "Damage claim" },
  { value: "overstay", label: "Overstay" },
  { value: "viewing", label: "Viewing" },
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
  if (status === "sent") {
    return (
      <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
        <CheckCircle className="mr-1 h-3 w-3" />
        Sent
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
    onSuccess: (_data, logId) => {
      toast.success("Email resent", {
        description: "A new delivery attempt was logged.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/email-logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/email-logs/stats"] });
      setSelectedLog((current) =>
        current && current.id === logId
          ? {
              ...current,
              retryCount: (current.retryCount || 0) + 1,
              retriedAt: new Date().toISOString(),
            }
          : current
      );
    },
    onError: (error: Error) => {
      toast.error("Retry failed", { description: error.message });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/email-logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/email-logs/stats"] });
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
          Track every email sent to chefs and managers, including whether delivery succeeded.
        </p>
      </div>

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
            <CardTitle className="text-sm text-muted-foreground">Sent</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats?.sent ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Accepted by the mail server</p>
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
            <SelectItem value="sent">Sent</SelectItem>
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
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            logsQuery.refetch();
            statsQuery.refetch();
          }}
          disabled={logsQuery.isFetching}
        >
          <RefreshCw className={`h-4 w-4 mr-1 ${logsQuery.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">{rangeLabel}</span>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sent</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
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
                      <TableCell>{statusBadge(log.status)}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {log.status === "failed" && (
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
                                    ? "Resend this email"
                                    : "Original content was not stored, so this send cannot be retried"}
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

      <Sheet open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Email details</SheetTitle>
            <SheetDescription>
              Delivery record for this outgoing message.
            </SheetDescription>
          </SheetHeader>
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
                <span className="text-muted-foreground">Sent at</span>
                <span>{formatDateTimeSt(selectedLog.createdAt)}</span>
              </div>
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
                  <p className="font-medium mb-1">Error</p>
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
              {selectedLog.status === "failed" && (
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
                  Retry send
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
        </SheetContent>
      </Sheet>
    </div>
  );
}
