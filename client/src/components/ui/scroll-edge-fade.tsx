import * as React from "react"
import { Icon } from "@iconify/react"

import { cn } from "@/lib/utils"

/**
 * The fade + arrow affordance for a scroll container that hides content off an edge.
 *
 * This is the ONE implementation. `PreviewScroll` on the kitchen preview page and the scrollable
 * `TabsList` (profile, My Kitchens, availability, …) both render it, so a scrollable row looks and
 * behaves the same everywhere in the product — before this, the preview page had the treatment and
 * the tab bars had a bare `overflow-x-auto` with no cue that more tabs existed.
 */

export type ScrollAxis = "x" | "y"

export interface ScrollEdges {
    /** Content is hidden before the current scroll position. */
    before: boolean
    /** Content is hidden after the current scroll position. */
    after: boolean
}

/**
 * Tracks which edges of a scroll container still have hidden content.
 *
 * Returns `check` as well as `edges` so the caller can wire it to `onScroll`; the hook also
 * re-checks on resize and on DOM mutation, because content routinely arrives after mount (a fetch,
 * a filter change, a badge count) without resizing the container.
 */
export function useScrollEdges<T extends HTMLElement>(
    ref: React.RefObject<T | null>,
    axis: ScrollAxis = "x"
): { edges: ScrollEdges; check: () => void } {
    const [edges, setEdges] = React.useState<ScrollEdges>({ before: false, after: false })

    const check = React.useCallback(() => {
        const node = ref.current
        if (!node) return
        const position = axis === "x" ? node.scrollLeft : node.scrollTop
        const size = axis === "x" ? node.clientWidth : node.clientHeight
        const total = axis === "x" ? node.scrollWidth : node.scrollHeight
        const before = position > 2
        const after = position + size < total - 2
        // Bail out when nothing moved: `check` runs on every scroll frame and every mutation.
        setEdges((previous) =>
            previous.before === before && previous.after === after ? previous : { before, after }
        )
    }, [axis, ref])

    React.useEffect(() => {
        const node = ref.current
        if (!node) return
        check()
        // jsdom has no ResizeObserver, and the tab list is rendered by dozens of component tests
        // that never stub one. Reading the edges once is still correct — it just does not update.
        if (typeof ResizeObserver === "undefined") return
        const observer = new ResizeObserver(check)
        observer.observe(node)
        Array.from(node.children).forEach((child) => observer.observe(child))
        const changes = new MutationObserver(check)
        changes.observe(node, { childList: true, subtree: true, characterData: true })
        return () => {
            observer.disconnect()
            changes.disconnect()
        }
    }, [check, ref])

    return { edges, check }
}

export interface ScrollEdgeFadeProps {
    edges: ScrollEdges
    /** Scroll one "page" in this direction. Negative is left/up. */
    onStep: (direction: -1 | 1) => void
    axis?: ScrollAxis
    className?: string
    /**
     * Screen-reader labels. English by default, matching the existing preview-page treatment; a
     * caller with translations can pass its own.
     */
    labels?: { before: string; after: string }
}

export function ScrollEdgeFade({ edges, onStep, axis = "x", className, labels }: ScrollEdgeFadeProps) {
    const defaultLabels = {
        before: `Scroll ${axis === "x" ? "left" : "up"}`,
        after: `Scroll ${axis === "x" ? "right" : "down"}`,
    }
    const text = labels ?? defaultLabels

    return (
        <>
            {(["before", "after"] as const).map((edge) => {
                if (!edges[edge]) return null
                const direction = edge === "before" ? "left" : "right"
                const icon =
                    axis === "x"
                        ? `mdi:chevron-${direction}`
                        : `mdi:chevron-${edge === "before" ? "up" : "down"}`
                return (
                    <button
                        key={edge}
                        type="button"
                        onClick={() => onStep(edge === "before" ? -1 : 1)}
                        aria-label={text[edge]}
                        className={cn(
                            "absolute z-10 flex items-center justify-center text-muted-foreground",
                            axis === "x" ? "inset-y-0 w-8" : "inset-x-0 h-8",
                            axis === "x"
                                ? edge === "before"
                                    ? "left-0 bg-gradient-to-r from-background to-transparent"
                                    : "right-0 bg-gradient-to-l from-background to-transparent"
                                : edge === "before"
                                    ? "top-0 bg-gradient-to-b from-background to-transparent"
                                    : "bottom-0 bg-gradient-to-t from-background to-transparent",
                            className
                        )}
                    >
                        <Icon icon={icon} className="size-4" aria-hidden />
                    </button>
                )
            })}
        </>
    )
}
