import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"
import { ScrollEdgeFade, useScrollEdges } from "@/components/ui/scroll-edge-fade"

const Tabs = TabsPrimitive.Root

/**
 * Tabs that do not fit their container scroll horizontally — and now say so.
 *
 * The base classes have always included `overflow-x-auto`, so a tab bar with more tabs than room
 * (profile, My Kitchens, availability, the kitchen preview) silently scrolled with no cue that
 * anything was off-screen: the last visible tab just looked like the last tab. The List is wrapped
 * in a positioned container so the fade + chevron can sit ON TOP of the scroller instead of
 * scrolling away with its content — which is why a wrapper is required rather than optional.
 *
 * The wrapper is a plain block, so a `w-full` / `grid` / `overflow-x-auto` className still lands on
 * the List exactly as before. Radix finds the List through context, not DOM nesting, so wrapping
 * does not affect keyboard navigation or the aria wiring.
 */
const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, onScroll, ...props }, ref) => {
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const { edges, check } = useScrollEdges(listRef, "x")

  // Feed the same node to our internal ref and the caller's, exactly as ScrollArea does.
  const setListRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      listRef.current = node
      if (typeof ref === "function") ref(node)
      else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node
    },
    [ref]
  )

  const step = React.useCallback((direction: -1 | 1) => {
    const node = listRef.current
    if (!node) return
    node.scrollBy({ left: direction * node.clientWidth * 0.75, behavior: "smooth" })
  }, [])

  return (
    <div className="relative min-w-0">
      <TabsPrimitive.List
        ref={setListRef}
        onScroll={(event) => {
          check()
          onScroll?.(event)
        }}
        className={cn(
          "flex h-auto items-center justify-start rounded-lg bg-muted p-1 text-muted-foreground overflow-x-auto scrollbar-none",
          className
        )}
        {...props}
      >
        {children}
      </TabsPrimitive.List>
      <ScrollEdgeFade edges={edges} onStep={step} />
    </div>
  )
})
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
