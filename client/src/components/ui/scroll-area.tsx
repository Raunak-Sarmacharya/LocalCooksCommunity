import * as React from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
    showScrollIndicators?: boolean;
  }
>(({ className, children, showScrollIndicators = true, ...props }, ref) => {
  const [canScrollTop, setCanScrollTop] = React.useState(false);
  const [canScrollBottom, setCanScrollBottom] = React.useState(false);
  const viewportRef = React.useRef<HTMLDivElement>(null);

  const checkScroll = React.useCallback(() => {
    if (!viewportRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = viewportRef.current;
    setCanScrollTop(scrollTop > 0);
    // Use a small threshold (e.g., 2px) to account for rounding errors
    setCanScrollBottom(scrollTop + clientHeight < scrollHeight - 2);
  }, []);

  React.useEffect(() => {
    checkScroll();
    
    const viewport = viewportRef.current;
    if (!viewport) return;
    
    const observer = new ResizeObserver(() => checkScroll());
    observer.observe(viewport);
    
    if (viewport.firstElementChild) {
      observer.observe(viewport.firstElementChild);
    }
    
    return () => observer.disconnect();
  }, [checkScroll]);

  return (
    <ScrollAreaPrimitive.Root
      ref={ref}
      className={cn("relative overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport 
        ref={viewportRef}
        className="h-full w-full rounded-[inherit]"
        onScroll={checkScroll}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />

      {/* Top scroll fade */}
      {showScrollIndicators && canScrollTop && (
        <div className="absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-background/90 to-transparent pointer-events-none z-20 transition-opacity duration-300" />
      )}
      
      {/* Bottom scroll fade and arrow */}
      {showScrollIndicators && canScrollBottom && (
        <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-background/90 to-transparent pointer-events-none z-20 flex items-end justify-center pb-1 transition-opacity duration-300">
           <ChevronDown className="h-4 w-4 text-muted-foreground animate-bounce opacity-70" />
        </div>
      )}
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
