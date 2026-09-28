export interface FullRefundRequest {
  status: "pending" | "approved" | "rejected";
  requestedAmount?: number;
  approvedAmount?: number;
  note?: string | null;
}

export function RefundRequestStatus({ request }: { request?: FullRefundRequest | null }) {
  if (!request) return null;
  const label = { pending: "Refund request awaiting admin review", approved: "Refund request approved", rejected: "Refund request declined" }[request.status];
  if (!label) return null;
  return <div role="status" className="rounded-lg border bg-muted/30 p-3 text-sm">
    <p className="font-medium text-foreground">{label}</p>
    {request.note && <p className="mt-1 text-xs text-muted-foreground">{request.note}</p>}
  </div>;
}
