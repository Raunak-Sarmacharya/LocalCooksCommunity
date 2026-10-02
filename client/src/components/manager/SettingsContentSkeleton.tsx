import { Skeleton } from "@/components/ui/skeleton";

export function SettingsContentSkeleton({ rows = 4 }: { rows?: number }) {
  return <div className="space-y-5" role="status" aria-label="Loading settings" aria-busy="true">
    <div className="space-y-2"><Skeleton className="h-7 w-56 max-w-full" /><Skeleton className="h-4 w-80 max-w-full" /></div>
    <div className="overflow-hidden rounded-xl border bg-card">
      {Array.from({ length: rows }, (_, index) => <div key={index} className="flex min-h-20 items-center justify-between gap-4 border-b p-4 last:border-b-0">
        <div className="space-y-2"><Skeleton className="h-4 w-40 max-w-full" /><Skeleton className="h-3 w-56 max-w-full" /></div>
        <Skeleton className="h-9 w-28 shrink-0 rounded-lg" />
      </div>)}
    </div>
  </div>;
}
