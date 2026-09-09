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

export function walkthroughStorageKey(base: string, uid?: string | null) {
  // Account-lifetime tours must be uid-scoped; bare keys are not once-per-user.
  if (!uid) return `${base}:anonymous`;
  return `${base}:${uid}`;
}

/** True if this account already completed any key in the walkthrough family. */
export function hasCompletedTourFamily(familyPrefix: string, uid: string) {
  try {
    const scopedEnd = `:${uid}`;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(familyPrefix)) continue;
      if (localStorage.getItem(key) !== "1") continue;
      if (key.endsWith(scopedEnd)) return true;
      // Legacy unscoped flag (no :uid suffix after the family prefix).
      if (!key.slice(familyPrefix.length).includes(":")) return true;
    }
    return false;
  } catch {
    return true; // fail closed — don't show the tour if storage is broken
  }
}

/** Copy any prior family completion onto the stable seen key for this uid. */
export function migrateTourFamilyCompletion(familyPrefix: string, uid: string, seenKey: string) {
  try {
    if (localStorage.getItem(seenKey) === "1") return;
    if (!hasCompletedTourFamily(familyPrefix, uid)) return;
    localStorage.setItem(seenKey, "1");
  } catch {
    // ignore
  }
}

/** Exported for assert check — true only when this storage key is marked done. */
export function hasCompletedTour(storageKey: string) {
  try {
    if (localStorage.getItem(storageKey) === "1") return true;
    // Migrate legacy unscoped flag → this uid key (one-time).
    const scopedAt = storageKey.lastIndexOf(":");
    if (scopedAt > 0) {
      const unscoped = storageKey.slice(0, scopedAt);
      if (unscoped && localStorage.getItem(unscoped) === "1") {
        localStorage.setItem(storageKey, "1");
        return true;
      }
    }
    return false;
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

/** Return the rendered target when responsive markup contains duplicate ids. */
export function findWalkthroughTarget(attr: string, id: string) {
  const candidates = document.querySelectorAll(selectorFor(attr, id));
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    if (!(candidate instanceof HTMLElement)) continue;
    const rect = candidate.getBoundingClientRect();
    const style = getComputedStyle(candidate);
    if (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    ) {
      return candidate;
    }
  }
  return null;
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
    const elA = findWalkthroughTarget(attr, a.id);
    const elB = findWalkthroughTarget(attr, b.id);
    if (!elA || !elB) return 0;
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
    const found = steps.filter((item) => findWalkthroughTarget(attr, item.id));
    const ids = found.map((item) => item.id);
    if (found.length === 0) return false;
    if (readyWhen && !readyWhen(ids)) return false;

    const probe = findWalkthroughTarget(attr, found[0].id);
    if (probe) scrollPageToTop(probe);

    setVisibleSteps(sortStepsTopDown(found, attr));
    setStepIndex(0);
    setOpen(true);
    return true;
  }, [attr, readyWhen, steps]);

  const tryStartRef = useRef(tryStart);
  tryStartRef.current = tryStart;

  useEffect(() => {
    if (!enabled || open || hasCompletedTour(storageKey)) return;

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
  }, [enabled, open, storageKey]);

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
    if (!open || !enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, open, close]);

  useLayoutEffect(() => {
    if (!open || !enabled || !step) {
      setHighlight(null);
      return;
    }

    const el = findWalkthroughTarget(attr, step.id);
    if (!el) {
      setHighlight(null);
      const nextIndex = visibleSteps.findIndex(
        (item, index) => index > stepIndex && !!findWalkthroughTarget(attr, item.id)
      );
      if (nextIndex >= 0) setStepIndex(nextIndex);
      else close();
      return;
    }

    el.scrollIntoView({ block: "nearest", inline: "nearest" });

    let frame = 0;
    let running = true;
    const tick = () => {
      if (!running) return;
      const target = findWalkthroughTarget(attr, step.id);
      if (target) {
        const next = readHighlight(target);
        setHighlight((prev) => (sameHighlight(prev, next) ? prev : next));
      } else {
        running = false;
        setHighlight(null);
        const nextIndex = visibleSteps.findIndex(
          (item, index) => index > stepIndex && !!findWalkthroughTarget(attr, item.id)
        );
        if (nextIndex >= 0) setStepIndex(nextIndex);
        else close();
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };
    tick();

    return () => {
      running = false;
      window.cancelAnimationFrame(frame);
    };
  }, [attr, close, enabled, open, step, stepIndex, visibleSteps]);

  useLayoutEffect(() => {
    if (!popoverRef.current) return;
    setPopoverHeight(Math.round(popoverRef.current.getBoundingClientRect().height));
  }, [step, highlight]);

  if (!enabled || !open || !step || !highlight || highlight.width === 0) return null;

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
        className="fixed z-10 rounded-xl border border-gray-200 bg-white px-3.5 py-3 shadow-sm"
        style={{ top: popoverTop, left: popoverLeft, width: POPOVER_WIDTH }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          aria-hidden
          className={cn(
            "absolute h-2 w-2 rotate-45 bg-white",
            placeBelow ? "-top-1 border-l border-t border-gray-200" : "-bottom-1 border-r border-b border-gray-200"
          )}
          style={{ left: arrowLeft }}
        />

        <div className="flex items-start justify-between gap-3">
          <h2 id="spotlight-walkthrough-title" className="text-[13px] font-semibold leading-none text-gray-900">
            {step.title}
          </h2>
          <div className="flex items-center gap-1 pt-0.5" aria-hidden>
            {visibleSteps.map((item, index) => (
              <span
                key={item.id}
                className={
                  index === stepIndex
                    ? "h-1.5 w-1.5 rounded-full bg-[#F51042]"
                    : "h-1.5 w-1.5 rounded-full bg-gray-300"
                }
              />
            ))}
          </div>
        </div>
        <p className="mt-1.5 text-[13px] leading-snug text-gray-500">{step.body}</p>
        <div className="mt-3 flex items-center justify-end gap-4">
          {!isLast && (
            <button
              type="button"
              onClick={close}
              className="text-[13px] text-gray-500 transition-colors hover:text-gray-900"
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
            className="text-[13px] font-semibold text-[#F51042] hover:text-[#d60e39]"
          >
            {isLast ? t("done", "Done") : t("next", "Next")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
