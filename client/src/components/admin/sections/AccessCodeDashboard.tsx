import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { auth } from "@/lib/firebase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Key,
  ShieldCheck,
  ShieldX,
  Clock,
  AlertTriangle,
  BarChart3,
  Search,
  Loader2,
  Timer,
  XCircle,
  AlertOctagon,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ============================================================================
// TYPES
// ============================================================================

interface ActiveAccessCode {
  bookingId: number;
  kitchenId: number;
  kitchenName: string;
  locationName: string;
  chefId: number | null;
  chefEmail: string | null;
  accessCodeFormat: string | null;
  accessCodeValidFrom: string | null;
  accessCodeValidUntil: string | null;
  bookingDate: string;
  startTime: string;
  endTime: string;
  checkinStatus: string | null;
}

interface AuditEntry {
  id: number;
  bookingId: number | null;
  kitchenId: number;
  action: string;
  accessCodeHash: string | null;
  source: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface Analytics {
  totalCodesGenerated: number;
  codesUsed: number;
  codesExpired: number;
  codesRevoked: number;
  usageRate: number;
  avgTimeToFirstUseMinutes: number | null;
  failedValidationAttempts: number;
  noShowCorrelation: number;
}

// ============================================================================
// HELPERS
// ============================================================================

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString();
}

function formatTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleTimeString();
}

function getActionBadge(action: string) {
  const config: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    generated: { variant: "default", label: "Generated" },
    validated_success: { variant: "secondary", label: "Validated" },
    validated_failed: { variant: "destructive", label: "Failed" },
    used: { variant: "default", label: "Used" },
    expired: { variant: "outline", label: "Expired" },
    revoked: { variant: "destructive", label: "Revoked" },
    regenerated: { variant: "secondary", label: "Regenerated" },
  };
  const c = config[action] || { variant: "outline" as const, label: action };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

function getCheckinBadge(status: string | null) {
  if (!status) return <Badge variant="outline">Unknown</Badge>;
  const config: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    not_checked_in: { variant: "outline", label: "Not Checked In" },
    checked_in: { variant: "default", label: "Checked In" },
    checkout_requested: { variant: "secondary", label: "Checkout Requested" },
    checked_out: { variant: "secondary", label: "Checked Out" },
    no_show: { variant: "destructive", label: "No Show" },
  };
  const c = config[status] || { variant: "outline" as const, label: status };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

async function fetchWithAuth(url: string) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

async function postWithAuth(url: string, body: unknown) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// ============================================================================
// COMPONENT
// ============================================================================

export function AccessCodeDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<"active" | "audit" | "analytics">("active");
  const [auditActionFilter, setAuditActionFilter] = useState<string>("all");
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<{ kitchenId?: number; bookingId?: number; label: string } | null>(null);
  const [revokeReason, setRevokeReason] = useState("");

  // Fetch active codes
  const { data: activeData, isLoading: activeLoading } = useQuery({
    queryKey: ["adminAccessCodesActive"],
    queryFn: () => fetchWithAuth("/api/admin/access-codes/active"),
  });

  // Fetch audit trail
  const { data: auditData, isLoading: auditLoading } = useQuery({
    queryKey: ["adminAccessCodesAudit", auditActionFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (auditActionFilter !== "all") params.set("action", auditActionFilter);
      params.set("limit", "100");
      return fetchWithAuth(`/api/admin/access-codes/audit?${params}`);
    },
  });

  // Fetch analytics
  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ["adminAccessCodesAnalytics"],
    queryFn: () => fetchWithAuth("/api/admin/access-codes/analytics"),
  });

  // Emergency revoke mutation
  const revokeMutation = useMutation({
    mutationFn: (params: { kitchenId?: number; bookingId?: number; reason: string }) =>
      postWithAuth("/api/admin/access-codes/emergency-revoke", params),
    onSuccess: (data) => {
      toast({
        title: "Codes Revoked",
        description: `${data.revoked} access code(s) have been emergency revoked.`,
      });
      queryClient.invalidateQueries({ queryKey: ["adminAccessCodesActive"] });
      queryClient.invalidateQueries({ queryKey: ["adminAccessCodesAudit"] });
      queryClient.invalidateQueries({ queryKey: ["adminAccessCodesAnalytics"] });
      setRevokeDialogOpen(false);
      setRevokeTarget(null);
      setRevokeReason("");
    },
    onError: (error: Error) => {
      toast({ title: "Revocation Failed", description: error.message, variant: "destructive" });
    },
  });

  const activeCodes: ActiveAccessCode[] = activeData?.codes || [];
  const auditEntries: AuditEntry[] = auditData?.entries || [];
  const stats: Analytics = analytics || {
    totalCodesGenerated: 0, codesUsed: 0, codesExpired: 0, codesRevoked: 0,
    usageRate: 0, avgTimeToFirstUseMinutes: null, failedValidationAttempts: 0,
    noShowCorrelation: 0,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Key className="h-6 w-6" />
            Access Code Dashboard
          </h2>
          <p className="text-muted-foreground">
            Monitor, audit, and manage kitchen access codes across all locations.
          </p>
        </div>
        <Dialog open={revokeDialogOpen} onOpenChange={setRevokeDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="destructive" size="sm">
              <AlertOctagon className="h-4 w-4 mr-2" />
              Emergency Revoke
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Emergency Revoke Access Codes</DialogTitle>
              <DialogDescription>
                Immediately revoke all active access codes for a kitchen or specific booking.
                Affected chefs will be notified. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Scope</label>
                <Select
                  value={revokeTarget?.kitchenId ? "kitchen" : revokeTarget?.bookingId ? "booking" : ""}
                  onValueChange={(v) => {
                    if (v === "kitchen") setRevokeTarget({ kitchenId: undefined, label: "All kitchens" });
                    else if (v === "booking") setRevokeTarget({ bookingId: undefined, label: "Specific booking" });
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Select scope..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="kitchen">All codes for a kitchen</SelectItem>
                    <SelectItem value="booking">Specific booking</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {revokeTarget?.kitchenId !== undefined && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Kitchen ID</label>
                  <Input
                    type="number"
                    placeholder="Enter kitchen ID"
                    onChange={(e) => setRevokeTarget({ kitchenId: parseInt(e.target.value) || undefined, label: `Kitchen ${e.target.value}` })}
                  />
                </div>
              )}
              {revokeTarget?.bookingId !== undefined && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Booking ID</label>
                  <Input
                    type="number"
                    placeholder="Enter booking ID"
                    onChange={(e) => setRevokeTarget({ bookingId: parseInt(e.target.value) || undefined, label: `Booking ${e.target.value}` })}
                  />
                </div>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium">Reason (min 5 chars)</label>
                <Input
                  value={revokeReason}
                  onChange={(e) => setRevokeReason(e.target.value)}
                  placeholder="Security incident, lock compromise..."
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRevokeDialogOpen(false)}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={
                  revokeReason.trim().length < 5 ||
                  (!revokeTarget?.kitchenId && !revokeTarget?.bookingId) ||
                  revokeMutation.isPending
                }
                onClick={() => {
                  if (revokeTarget) {
                    revokeMutation.mutate({
                      kitchenId: revokeTarget.kitchenId,
                      bookingId: revokeTarget.bookingId,
                      reason: revokeReason.trim(),
                    });
                  }
                }}
              >
                {revokeMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Revoke All Codes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Analytics Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Codes Generated</CardTitle>
            <Key className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalCodesGenerated}</div>
            <p className="text-xs text-muted-foreground">
              {stats.codesUsed} used ({stats.usageRate}% usage rate)
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Time to First Use</CardTitle>
            <Timer className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.avgTimeToFirstUseMinutes !== null ? `${stats.avgTimeToFirstUseMinutes}m` : "—"}
            </div>
            <p className="text-xs text-muted-foreground">From generation to first use</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Failed Validations</CardTitle>
            <ShieldX className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.failedValidationAttempts}</div>
            <p className="text-xs text-muted-foreground">
              {stats.codesExpired} expired, {stats.codesRevoked} revoked
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">No-Show Correlation</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.noShowCorrelation}</div>
            <p className="text-xs text-muted-foreground">Codes generated but never used (no-show)</p>
          </CardContent>
        </Card>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b pb-2">
        <Button
          variant={activeTab === "active" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("active")}
        >
          <ShieldCheck className="h-4 w-4 mr-2" />
          Active Codes
        </Button>
        <Button
          variant={activeTab === "audit" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("audit")}
        >
          <Search className="h-4 w-4 mr-2" />
          Audit Trail
        </Button>
        <Button
          variant={activeTab === "analytics" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("analytics")}
        >
          <BarChart3 className="h-4 w-4 mr-2" />
          Analytics
        </Button>
      </div>

      {/* Active Codes Table */}
      {activeTab === "active" && (
        <Card>
          <CardHeader>
            <CardTitle>Currently Active Access Codes</CardTitle>
            <CardDescription>
              {activeCodes.length} active code(s) across all kitchens
            </CardDescription>
          </CardHeader>
          <CardContent>
            {activeLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : activeCodes.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No active access codes</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Booking</TableHead>
                      <TableHead>Kitchen</TableHead>
                      <TableHead>Chef</TableHead>
                      <TableHead>Valid From</TableHead>
                      <TableHead>Valid Until</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeCodes.map((code) => {
                      const isExpired = code.accessCodeValidUntil
                        ? new Date(code.accessCodeValidUntil) < new Date()
                        : false;

                      return (
                        <TableRow key={code.bookingId}>
                          <TableCell className="font-medium">#{code.bookingId}</TableCell>
                          <TableCell>
                            <div>{code.kitchenName}</div>
                            <div className="text-xs text-muted-foreground">{code.locationName}</div>
                          </TableCell>
                          <TableCell className="text-sm">{code.chefEmail || "—"}</TableCell>
                          <TableCell className="text-xs">{formatTime(code.accessCodeValidFrom)}</TableCell>
                          <TableCell className="text-xs">{formatTime(code.accessCodeValidUntil)}</TableCell>
                          <TableCell>
                            {isExpired ? (
                              <Badge variant="outline" className="gap-1">
                                <XCircle className="h-3 w-3" />
                                Expired
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="gap-1">
                                <Clock className="h-3 w-3" />
                                Active
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>{getCheckinBadge(code.checkinStatus)}</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => {
                                setRevokeTarget({ bookingId: code.bookingId, label: `Booking #${code.bookingId}` });
                                setRevokeReason("");
                                setRevokeDialogOpen(true);
                              }}
                            >
                              Revoke
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Audit Trail */}
      {activeTab === "audit" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Audit Trail</CardTitle>
                <CardDescription>Complete access code lifecycle events</CardDescription>
              </div>
              <Select value={auditActionFilter} onValueChange={setAuditActionFilter}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  <SelectItem value="generated">Generated</SelectItem>
                  <SelectItem value="validated_success">Validated</SelectItem>
                  <SelectItem value="validated_failed">Failed Validation</SelectItem>
                  <SelectItem value="used">Used</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="revoked">Revoked</SelectItem>
                  <SelectItem value="regenerated">Regenerated</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {auditLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : auditEntries.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No audit entries found</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Booking</TableHead>
                      <TableHead>Kitchen</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditEntries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {formatDate(entry.createdAt)}
                        </TableCell>
                        <TableCell>{entry.bookingId || "—"}</TableCell>
                        <TableCell>{entry.kitchenId}</TableCell>
                        <TableCell>{getActionBadge(entry.action)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{entry.source}</Badge>
                        </TableCell>
                        <TableCell className="text-xs max-w-48 truncate">
                          {entry.metadata
                            ? Object.entries(entry.metadata)
                                .filter(([k]) => !["accessCodeHash"].includes(k))
                                .map(([k, v]) => `${k}: ${String(v)}`)
                                .join(", ")
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Analytics Detail */}
      {activeTab === "analytics" && (
        <Card>
          <CardHeader>
            <CardTitle>Access Code Analytics</CardTitle>
            <CardDescription>Detailed breakdown of access code usage patterns</CardDescription>
          </CardHeader>
          <CardContent>
            {analyticsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-4">
                  <h3 className="font-semibold">Lifecycle Summary</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Generated</span>
                      <span className="font-medium">{stats.totalCodesGenerated}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Successfully Used</span>
                      <span className="font-medium text-green-600">{stats.codesUsed}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Expired Unused</span>
                      <span className="font-medium text-amber-600">{stats.codesExpired}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Revoked</span>
                      <span className="font-medium text-red-600">{stats.codesRevoked}</span>
                    </div>
                    <div className="flex justify-between border-t pt-2">
                      <span className="font-medium">Usage Rate</span>
                      <span className="font-bold">{stats.usageRate}%</span>
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  <h3 className="font-semibold">Performance Metrics</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Avg Time to First Use</span>
                      <span className="font-medium">
                        {stats.avgTimeToFirstUseMinutes !== null ? `${stats.avgTimeToFirstUseMinutes} min` : "No data"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Failed Validation Attempts</span>
                      <span className="font-medium text-red-600">{stats.failedValidationAttempts}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">No-Show Correlation</span>
                      <span className="font-medium text-amber-600">{stats.noShowCorrelation}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
