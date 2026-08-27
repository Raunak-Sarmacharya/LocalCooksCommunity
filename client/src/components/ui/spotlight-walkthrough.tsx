import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export type SpotlightWalkthroughStep = {
  id: string;
  title: string;
  body: string;
};

type Highlight = {
  top: number;
  left: number;
  width: number;
  height: number;
  radius: number;
};

const POPOVER_WIDTH = 248;
const GAP = 10;
const PAD = 4;

function hasCompletedTour(storageKey: string) {
  try {
    return localStorage.getItem(storageKey) === "1";
  } catch {
    return true;
  }
}

function markTourComplete(storageKey: string) {
  try {
    localStorage.setItem(storageKey, "1");
  } catch {
    // ignore
  }
}

function selectorFor(attr: string, id: string) {
  return `[${attr}="${id}"]`;
}

function readHighlight(el: HTMLElement): Highlight {
  const rect = el.getBoundingClientRect();
  const computedRadius = Number.parseFloat(getComputedStyle(el).borderRadius);
  const radius = Math.min(
    Number.isFinite(computedRadius) && computedRadius > 0 ? computedRadius : 8,
    Math.min(rect.width, rect.height) / 2
  );
  return {
    top: rect.top - PAD,
    left: rect.left - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
    radius: radius + PAD,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function sameHighlight(a: Highlight | null, b: Highlight) {
  if (!a) return false;
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5 &&
    Math.abs(a.radius - b.radius) < 0.5
  );
}

function scrollPageToTop(fromEl: HTMLElement) {
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  let node: HTMLElement | null = fromEl;
  while (node) {
    const canScroll = node.scrollHeight > node.clientHeight + 8;
    const overflowY = getComputedStyle(node).overflowY;
    if (canScroll && (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay")) {
      node.scrollTop = 0;
    }
    node = node.parentElement;
  }
}

function sortStepsTopDown(items: readonly SpotlightWalkthroughStep[], attr: string) {
  return [...items].sort((a, b) => {
    const elA = document.querySelector(selectorFor(attr, a.id));
    const elB = document.querySelector(selectorFor(attr, b.id));
    if (!(elA instanceof HTMLElement) || !(elB instanceof HTMLElement)) return 0;
    const ra = elA.getBoundingClientRect();
    const rb = elB.getBoundingClientRect();
    const dy = ra.top - rb.top;
    if (Math.abs(dy) > 40) return dy;
    return ra.left - rb.left;
  });
}

export function SpotlightWalkthrough({
  storageKey,
  steps,
  enabled,
  replayToken = 0,
  attr = "data-walkthrough",
  readyWhen,
}: {
  storageKey: string;
  maskId?: string;
  steps: readonly SpotlightWalkthroughStep[];
  enabled: boolean;
  replayToken?: number;
  attr?: string;
  readyWhen?: (foundIds: string[]) => boolean;
}) {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const [visibleSteps, setVisibleSteps] = useState<SpotlightWalkthroughStep[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const [popoverHeight, setPopoverHeight] = useState(108);
  const popoverRef = useRef<HTMLDivElement>(null);

  const step = visibleSteps[stepIndex];
  const isLast = stepIndex >= visibleSteps.length - 1;

  const close = useCallback(() => {
    markTourComplete(storageKey);
    setOpen(false);
  }, [storageKey]);

  const tryStart = useCallback(() => {
    const found = steps.filter((item) => document.querySelector(selectorFor(attr, item.id)));
    const ids = found.map((item) => item.id);
    if (found.length === 0) return false;
    if (readyWhen && !readyWhen(ids)) return false;

    const probe = document.querySelector(selectorFor(attr, found[0].id));
    if (probe instanceof HTMLElement) scrollPageToTop(probe);

    setVisibleSteps(sortStepsTopDown(found, attr));
    setStepIndex(0);
    setOpen(true);
    return true;
  }, [attr, readyWhen, steps]);

  const tryStartRef = useRef(tryStart);
  tryStartRef.current = tryStart;

  useEffect(() => {
    if (!enabled || hasCompletedTour(storageKey)) return;

    let cancelled = false;
    let retryTimer = 0;

    const attempt = () => {
      if (cancelled) return;
      if (tryStartRef.current()) return;
      retryTimer = window.setTimeout(attempt, 250);
    };

    const timer = window.setTimeout(attempt, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(retryTimer);
    };
  }, [enabled, storageKey]);

  useEffect(() => {
    if (!enabled || replayToken === 0) return;

    let cancelled = false;
    let retryTimer = 0;

    const attempt = () => {
      if (cancelled) return;
      if (tryStartRef.current()) return;
      retryTimer = window.setTimeout(attempt, 150);
    };

    attempt();
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
    };
  }, [enabled, replayToken]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (!enabled && open) {
      setOpen(false);
    }
  }, [enabled, open]);

  useLayoutEffect(() => {
    if (!open || !step) {
      setHighlight(null);
      return;
    }

    const el = document.querySelector(selectorFor(attr, step.id));
    if (!(el instanceof HTMLElement)) {
      setHighlight(null);
      return;
    }

    el.scrollIntoView({ block: "nearest", inline: "nearest" });

    let frame = 0;
    let running = true;
    const tick = () => {
      if (!running) return;
      const target = document.querySelector(selectorFor(attr, step.id));
      if (target instanceof HTMLElement) {
        const next = readHighlight(target);
        setHighlight((prev) => (sameHighlight(prev, next) ? prev : next));
      }
      frame = window.requestAnimationFrame(tick);
    };
    tick();

    return () => {
      running = false;
      window.cancelAnimationFrame(frame);
    };
  }, [attr, open, step]);

  useLayoutEffect(() => {
    if (!popoverRef.current) return;
    setPopoverHeight(Math.round(popoverRef.current.getBoundingClientRect().height));
  }, [step, highlight]);

  if (!open || !step || !highlight || highlight.width === 0) return null;

  const placeBelow =
    window.innerHeight - (highlight.top + highlight.height) > popoverHeight + GAP + 16;
  const anchorX = highlight.left + highlight.width / 2;
  const popoverLeft = clamp(anchorX - POPOVER_WIDTH / 2, 16, window.innerWidth - POPOVER_WIDTH - 16);
  const popoverTop = placeBelow
    ? highlight.top + highlight.height + GAP
    : clamp(highlight.top - GAP - popoverHeight, 16, window.innerHeight - popoverHeight - 16);
  const arrowLeft = clamp(anchorX - popoverLeft - 4, 14, POPOVER_WIDTH - 18);

  return createPortal(
    <div className="fixed inset-0 z-[200] overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="spotlight-walkthrough-title">
      <div className="absolute inset-0" onClick={close} />
      <div
        aria-hidden
        className="pointer-events-none fixed"
        style={{
          top: highlight.top,
          left: highlight.left,
          width: highlight.width,
          height: highlight.height,
          borderRadius: highlight.radius,
          boxShadow: "0 0 0 1.5px rgb(255 255 255 / 0.92), 0 0 0 9999px rgb(15 15 15 / 0.38)",
        }}
      />

      <div
        ref={popoverRef}
        className="fixed z-10 rounded-md border bg-background px-3.5 py-3 shadow-sm"
        style={{ top: popoverTop, left: popoverLeft, width: POPOVER_WIDTH }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          aria-hidden
          className={cn(
            "absolute h-2 w-2 rotate-45 bg-background",
            placeBelow ? "-top-1 border-l border-t" : "-bottom-1 border-r border-b"
          )}
          style={{ left: arrowLeft }}
        />

        <div className="flex items-start justify-between gap-3">
          <h2 id="spotlight-walkthrough-title" className="text-[13px] font-medium leading-none">
            {step.title}
          </h2>
          <div className="flex items-center gap-1 pt-0.5" aria-hidden>
            {visibleSteps.map((item, index) => (
              <span
                key={item.id}
                className={
                  index === stepIndex
                    ? "h-1 w-1 rounded-full bg-foreground"
                    : "h-1 w-1 rounded-full bg-muted-foreground/30"
                }
              />
            ))}
          </div>
        </div>
        <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">{step.body}</p>
        <div className="mt-3 flex items-center justify-end gap-4">
          {!isLast && (
            <button
              type="button"
              onClick={close}
              className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("skip", "Skip")}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (isLast) close();
              else setStepIndex((current) => current + 1);
            }}
            className="text-[13px] font-medium text-foreground"
          >
            {isLast ? t("done", "Done") : t("next", "Next")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
