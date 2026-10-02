import { Skeleton } from "@/components/ui/skeleton";

/** Keeps the availability controls in place while their saved values load. */
export function AvailabilitySkeleton({ header = false }: { header?: boolean }) {
  return (
    <div className="space-y-6" role="status" aria-label="Loading availability" aria-busy="true">
      {header && <><Skeleton className="h-7 w-64 max-w-full" /><Skeleton className="h-4 w-80 max-w-full" /><Skeleton className="h-10 w-72 max-w-full" /></>}
      <div className="flex gap-6 border-b pb-3"><Skeleton className="h-5 w-32" /><Skeleton className="h-5 w-28" /></div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="space-y-2 border-b p-4"><Skeleton className="h-6 w-44" /><Skeleton className="h-4 w-64 max-w-full" /></div>
        <div className="divide-y">
          {Array.from({ length: 7 }, (_, day) => <div key={day} className="grid min-h-[60px] grid-cols-[7rem_1fr_auto] items-center gap-4 px-4 py-3">
            <Skeleton className="h-4 w-20" /><div className="flex justify-end"><Skeleton className="h-9 w-28" /></div><Skeleton className="h-6 w-11 rounded-full" />
          </div>)}
        </div>
      </div>
    </div>
  );
}
