/**
 * Shared class strings for `ScrollArea`.
 *
 * Same idea as `lib/chef-cta.ts`: a class string that several call sites must agree on lives here
 * rather than being copy-pasted, so there is one place to change it.
 */

/**
 * Neutralises the table-based content wrapper Radix puts inside a ScrollArea.
 *
 * Apply to any ScrollArea that scrolls a whole PAGE (the dashboard shells) — not to one that scrolls
 * a short panel.
 *
 * Radix styles that wrapper as a table with a minimum width of the full viewport. A table is sized
 * to the MIN-CONTENT width of its content, so one descendant that cannot shrink stretches the
 * wrapper, and every sibling with it. On the manager Spaces page the seven non-wrapping kitchen tabs
 * add up to roughly 780px of min-content, so the wrapper grew to about 780px on a 390px phone: the
 * page title, the description, the callout copy and the description textarea were each cut mid-word
 * at the same edge, while the header — which sits outside the ScrollArea — looked perfectly fine.
 *
 * Forcing the wrapper back to a plain block makes it the viewport width instead, so a wide child
 * scrolls inside its own horizontal overflow container (which is what those tab lists are written to
 * do) rather than dragging the page sideways. The rule has to win against an inline style, so it
 * carries the important flag.
 */
export const SCROLL_AREA_FLUID_CONTENT = "[&_[data-radix-scroll-area-viewport]>div]:!block";
