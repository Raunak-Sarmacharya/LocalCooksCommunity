import * as React from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

export function useScrollCues<T extends HTMLElement>() {
  const viewportRef = React.useRef<T | null>(null);
  const [canScrollTop, setCanScrollTop] = React.useState(false);
  const [canScrollBottom, setCanScrollBottom] = React.useState(false);
  const checkScroll = React.useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setCanScrollTop(viewport.scrollTop > 2);
    setCanScrollBottom(viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 2);
  }, []);
  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(checkScroll);
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    const changes = new MutationObserver(checkScroll);
    changes.observe(viewport, { childList: true, subtree: true });
    checkScroll();
    return () => { observer.disconnect(); changes.disconnect(); };
  }, [checkScroll]);
  return { viewportRef, canScrollTop, canScrollBottom, checkScroll };
}

export function ScrollCues({ top, bottom }: { top: boolean; bottom: boolean }) {
  return <>
    {top && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-20 h-6 bg-gradient-to-b from-background/90 to-transparent" />}
    {bottom && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex h-10 items-end justify-center bg-gradient-to-t from-background/90 to-transparent pb-1"><ChevronDown className="h-4 w-4 animate-bounce text-muted-foreground opacity-70" /></div>}
  </>;
}

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
    showScrollIndicators?: boolean;
    /**
     * Access the scrolling viewport itself. The Root is `overflow-hidden`, so
     * anything that needs to read or set scrollTop (e.g. resetting to the top
     * when content changes) must go through this rather than the outer ref.
     */
    viewportRef?: React.Ref<HTMLDivElement>;
  }
>(({ className, children, showScrollIndicators = true, viewportRef: externalViewportRef, ...props }, ref) => {
  const { viewportRef, canScrollTop, canScrollBottom, checkScroll } = useScrollCues<HTMLDivElement>();

  // Feed the same node to our internal ref and any caller-supplied one.
  const attachViewport = React.useCallback((node: HTMLDivElement | null) => {
    viewportRef.current = node;
    if (!externalViewportRef) return;
    if (typeof externalViewportRef === 'function') externalViewportRef(node);
    else (externalViewportRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
  }, [externalViewportRef]);

  return (
    <ScrollAreaPrimitive.Root
      ref={ref}
      className={cn("relative overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={attachViewport}
        className="scrollbar-none h-full w-full rounded-[inherit]"
        onScroll={checkScroll}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar className="pointer-events-none w-0 opacity-0" />
      {showScrollIndicators && <ScrollCues top={canScrollTop} bottom={canScrollBottom} />}
    </ScrollAreaPrimitive.Root>
  )
})
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "flex touch-none select-none transition-colors",
      orientation === "vertical" &&
        "h-full w-2.5 border-l border-l-transparent p-[1px]",
      orientation === "horizontal" &&
        "h-2.5 flex-col border-t border-t-transparent p-[1px]",
      className
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
))
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName

export { ScrollArea, ScrollBar }
