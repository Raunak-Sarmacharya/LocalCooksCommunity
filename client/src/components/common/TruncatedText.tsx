import { useCallback, useEffect, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Detects whether an element's content overflows its box.
 * Covers both single-line `truncate` (horizontal) and
 * multi-line `line-clamp-*` (vertical) truncation.
 */
function isOverflowing(el: HTMLElement): boolean {
  return (
    el.scrollWidth > el.clientWidth ||
    el.scrollHeight > el.clientHeight
  );
}

/**
 * useOverflowDetection
 *
 * Observes an element and reports whether its content is currently
 * truncated. Re-evaluates automatically when:
 *  - the element resizes (viewport changes, sidebar collapse, etc.)
 *  - the text content changes (e.g. language switch after i18n loads)
 */
export function useOverflowDetection<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [truncated, setTruncated] = useState(false);

  const check = useCallback(() => {
    const el = ref.current;
    if (el) setTruncated(isOverflowing(el));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Initial check + react to size changes of the element itself
    const observer = new ResizeObserver(check);
    observer.observe(el);

    // React to text changes (i18n hydration, async data)
    const mutation = new MutationObserver(check);
    mutation.observe(el, { childList: true, characterData: true, subtree: true });

    check();

    return () => {
      observer.disconnect();
      mutation.disconnect();
    };
  }, [check]);

  return { ref, truncated };
}

type AllowedTag = "span" | "p" | "div" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

interface TruncatedTextProps extends Omit<React.HTMLAttributes<HTMLElement>, "children"> {
  /** The text to render. Full text is shown in the tooltip when truncated. */
  children: string;
  /**
   * Classes applied to the visible span. Include your truncation classes here,
   * e.g. "truncate", "line-clamp-2", plus typography/spacing classes.
   * Layout-affecting classes are preserved as-is — nothing is added or resized.
   */
  className?: string;
  /** Which element to render (default: span). */
  as?: AllowedTag;
  /** Optional override for the tooltip text (defaults to children). */
  tooltipText?: string;
  /** Max width of the tooltip content in px (default 320). */
  tooltipWidth?: number;
}

/**
 * TruncatedText — industry-standard "truncate + hover-reveal" pattern.
 *
 * Renders the text exactly as before (same tag, same classes, same
 * footprint). When the text overflows its container, a portal tooltip
 * with the full text appears on hover AND keyboard focus (a11y).
 * When the text fits, no tooltip is rendered at all — zero noise.
 *
 * Usage:
 *   <TruncatedText className="truncate text-sm font-medium">{name}</TruncatedText>
 *   <TruncatedText as="p" className="line-clamp-1 text-xs text-muted-foreground">{desc}</TruncatedText>
 */
export function TruncatedText({
  children,
  className,
  as: Tag = "span",
  tooltipText,
  tooltipWidth = 320,
  ...rest
}: TruncatedTextProps) {
  const { ref, truncated } = useOverflowDetection<HTMLElement>();

  // Not overflowing → render the plain element, exactly like before.
  if (!truncated) {
    return (
      <Tag ref={ref as any} className={className} {...rest}>
        {children}
      </Tag>
    );
  }

  // Overflowing → same element becomes the tooltip trigger via asChild,
  // so the DOM footprint is unchanged.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Tag ref={ref as any} className={cn(className, "cursor-default")} {...rest}>
          {children}
        </Tag>
      </TooltipTrigger>
      <TooltipContent
        role="tooltip"
        className="max-h-40 whitespace-pre-wrap break-words"
        style={{ maxWidth: tooltipWidth }}
        collisionPadding={8}
      >
        <span className="text-xs leading-relaxed">{tooltipText ?? children}</span>
      </TooltipContent>
    </Tooltip>
  );
}
