import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarDays, Check, Loader2, MapPin, X } from "lucide-react";
import { auth } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type TourRequest = {
  viewing: {
    id: number;
    scheduledAt: string;
    durationMinutes: number;
    chefNotes: string | null;
    intakeData: Record<string, unknown> | null;
    status: string;
    adminReviewDecision: "approved" | "denied" | null;
    adminReviewReason: string | null;
    adminReviewedAt: string | null;
  };
  chefName: string;
  chefUsername: string | null;
  kitchenName: string | null;
  locationName: string | null;
  locationAddress: string | null;
};

async function authHeaders() {
  const token = await auth.currentUser?.getIdToken();
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

export function AdminTourRequestsSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<TourRequest | null>(null);
  const [decision, setDecision] = useState<"approved" | "denied">("approved");
  const [reason, setReason] = useState("");
  const [tab, setTab] = useState<"pending" | "history">("pending");

  const { data: requests = [], isLoading } = useQuery<TourRequest[]>({
    queryKey: ["/api/viewings/admin"],
    queryFn: async () => {
      const response = await fetch("/api/viewings/admin", { headers: await authHeaders(), credentials: "include" });
      if (!response.ok) throw new Error("Unable to load tour requests");
      return response.json();
    },
    refetchInterval: 30_000,
  });

  const review = useMutation({
    mutationFn: async () => {
      if (!selected) return;
      const response = await fetch(`/api/viewings/admin/${selected.viewing.id}/review`, {
        method: "PATCH",
        headers: await authHeaders(),
        credentials: "include",
        body: JSON.stringify({ decision, reason: reason || undefined }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to review tour request");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/viewings/admin"] });
      toast({
        title: decision === "approved" ? "Sent to kitchen manager" : "Tour request declined",
        description: decision === "approved"
          ? "The manager can now review and approve or deny the request."
          : "The chef has been notified.",
      });
      setSelected(null);
      setReason("");
    },
    onError: (error: Error) => toast({ title: "Review failed", description: error.message, variant: "destructive" }),
  });

  const visibleRequests = requests.filter((request) =>
    tab === "pending" ? request.viewing.status === "pending_local_cooks" : Boolean(request.viewing.adminReviewedAt)
  );

  const openReview = (request: TourRequest, nextDecision: "approved" | "denied") => {
    setSelected(request);
    setDecision(nextDecision);
    setReason("");
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Tour requests</h2>
        <p className="text-sm text-muted-foreground">
          Local Cooks screens each request before it reaches a kitchen manager.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as "pending" | "history")}>
        <TabsList>
          <TabsTrigger value="pending">Pending ({requests.filter((request) => request.viewing.status === "pending_local_cooks").length})</TabsTrigger>
          <TabsTrigger value="history">History ({requests.filter((request) => request.viewing.adminReviewedAt).length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : visibleRequests.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">{tab === "pending" ? "No tour requests are waiting for Local Cooks review." : "No reviewed tour requests yet."}</CardContent></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visibleRequests.map((request) => (
            <Card key={request.viewing.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{request.chefName || request.chefUsername || "Chef"}</CardTitle>
                    <CardDescription>{request.kitchenName || request.locationName || "Kitchen tour"}</CardDescription>
                  </div>
                  <Badge variant={request.viewing.adminReviewDecision === "approved" ? "success" : request.viewing.adminReviewDecision === "denied" ? "destructive" : "warning"}>
                    {request.viewing.adminReviewDecision === "approved" ? "Approved" : request.viewing.adminReviewDecision === "denied" ? "Denied" : "Local Cooks review"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-muted-foreground" />{format(new Date(request.viewing.scheduledAt), "EEE, MMM d, yyyy 'at' h:mm a")} · {request.viewing.durationMinutes} min</div>
                <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" />{request.locationName || "Kitchen"}{request.locationAddress ? ` · ${request.locationAddress}` : ""}</div>
                {request.viewing.chefNotes && <p className="rounded-md bg-muted p-3"><span className="font-medium">Chef notes:</span> {request.viewing.chefNotes}</p>}
                {request.viewing.adminReviewReason && <p className="rounded-md bg-muted p-3"><span className="font-medium">Review reason:</span> {request.viewing.adminReviewReason}</p>}
                {request.viewing.intakeData && Object.keys(request.viewing.intakeData).length > 0 && (
                  <dl className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
                    {Object.entries(request.viewing.intakeData).filter(([, value]) => value != null && value !== "").map(([key, value]) => (
                      <div key={key}><dt className="text-xs text-muted-foreground">{key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}</dt><dd>{typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)}</dd></div>
                    ))}
                  </dl>
                )}
                {request.viewing.status === "pending_local_cooks" && <div className="flex justify-end gap-2 pt-1">
                  <Button variant="outline" onClick={() => openReview(request, "denied")}><X className="mr-2 h-4 w-4" />Deny</Button>
                  <Button onClick={() => openReview(request, "approved")}><Check className="mr-2 h-4 w-4" />Approve for manager</Button>
                </div>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

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
