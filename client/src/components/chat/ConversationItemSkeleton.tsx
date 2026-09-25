import { cn } from "@/lib/utils";

/**
 * Placeholder for a single conversation row.
 *
 * Deliberately mirrors ConversationItem's geometry — avatar circle, a two-line
 * text column, and the trailing timestamp/unread column — so the list settles
 * into place instead of jumping when the real rows arrive. A generic spinner
 * told the user nothing about what was coming; this shows the shape.
 */
export function ConversationItemSkeleton() {
  return (
    <div className="flex items-center gap-3 p-3" aria-hidden="true">
      {/* Avatar */}
      <div className="h-10 w-10 shrink-0 rounded-full bg-muted animate-pulse" />

      <div className="flex-1 overflow-hidden grid grid-cols-12 gap-2">
        <div className="col-span-8 flex flex-col gap-2 min-w-0">
          {/* Partner name */}
          <div className="h-4 w-2/3 rounded bg-muted animate-pulse" />
          {/* Last message / location */}
          <div className="h-3 w-full rounded bg-muted/70 animate-pulse" />
        </div>

        <div className="col-span-4 flex flex-col items-end gap-2">
          {/* Timestamp */}
          <div className="h-3 w-12 rounded bg-muted/70 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

/**
 * A full list of conversation skeletons.
 *
 * `count` should approximate how many real rows are expected, and rows are
 * staggered slightly so the column reads as loading rather than as a static
 * grey block.
 */
export function ConversationListSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("space-y-1", className)} role="status" aria-busy="true">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="animate-in fade-in-0 duration-300"
          style={{ animationDelay: `${index * 60}ms`, animationFillMode: 'backwards' }}
        >
          <ConversationItemSkeleton />
        </div>
      ))}
    </div>
  );
}

/**
 * Placeholder for a message thread.
 *
 * Alternates sides and varies bubble widths so it reads as a conversation
 * rather than a grid, and preserves the vertical rhythm of the real thread —
 * the message area keeps its scroll position and height instead of collapsing.
 */
export function MessageThreadSkeleton({ count = 6, className }: { count?: number; className?: string }) {
  // Width as a fraction of the row, cycled so consecutive bubbles differ.
  const widths = ['55%', '38%', '68%', '44%', '60%', '34%', '50%'];

  return (
    <div className={cn("flex flex-col gap-4 p-4", className)} role="status" aria-busy="true">
      {Array.from({ length: count }).map((_, index) => {
        const isOwn = index % 2 === 1;
        return (
          <div
            key={index}
            className={cn("flex flex-col gap-2", isOwn ? "items-end" : "items-start")}
            style={{ animationDelay: `${index * 70}ms`, animationFillMode: 'backwards' }}
          >
            <div className="h-3 w-20 rounded bg-muted/70 animate-pulse" />
            <div
              className="h-10 rounded-2xl bg-muted animate-pulse"
              style={{ width: widths[index % widths.length], minWidth: '7rem' }}
            />
          </div>
        );
      })}
    </div>
  );
}
