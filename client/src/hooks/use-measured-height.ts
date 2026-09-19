import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Tracks an element's rendered height with a callback ref + `ResizeObserver`.
 *
 * A callback ref rather than `useRef` + `useLayoutEffect`, and that is the whole
 * point. The caller unmounts the element while a loading gate is up, and an
 * effect cannot tell that apart from a re-render — its cleanup only runs when
 * the deps change or the *component* unmounts. Two failures follow:
 *
 * 1. The observer keeps watching a **detached** node, whose box is 0. It fires,
 *    and the caller pins itself to `0 + offset` — a 2px sliver.
 * 2. If a dep changes while the element is unmounted, the effect re-runs against
 *    a null ref, bails out, and never re-establishes an observer — so nothing
 *    ever corrects the collapsed height.
 *
 * Tying the observer's lifetime to the node's fixes both: every mount
 * re-measures, and an unmount reports nothing instead of reporting zero.
 *
 * Returns the ref callback to attach, and the measured height (`undefined` while
 * the element is unmounted, so callers can fall back to `auto`).
 */
export function useMeasuredHeight(offset = 2): [(node: HTMLElement | null) => void, number | undefined] {
  const [height, setHeight] = useState<number>();
  const observerRef = useRef<ResizeObserver | null>(null);

  const measureRef = useCallback(
    (node: HTMLElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;

      if (!node) {
        // Unmounted. Drop back to `auto` rather than leaving a stale pixel
        // height behind — never pin an element to a height it has not measured
        // while mounted.
        setHeight(undefined);
        return;
      }

      const measure = () => {
        const next = node.offsetHeight;
        // A detached or not-yet-laid-out node reports 0; committing that is what
        // collapses the caller.
        if (next > 0) setHeight(next + offset);
      };
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      observerRef.current = observer;
    },
    [offset],
  );

  // React calls callback refs with null on unmount, so this is belt-and-braces.
  useEffect(() => () => observerRef.current?.disconnect(), []);

  return [measureRef, height];
}
