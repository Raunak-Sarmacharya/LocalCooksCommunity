const DEFAULT_HEADING_GAP = 48;

export function scrollToPageSection(
  sectionId: string,
  behavior: ScrollBehavior = "smooth",
): boolean {
  if (typeof window === "undefined") return false;

  const section = document.getElementById(sectionId);
  if (!section) return false;

  const header = document.querySelector<HTMLElement>("header");
  const headerHeight =
    header && window.getComputedStyle(header).position === "fixed"
      ? header.getBoundingClientRect().height
      : 0;
  const sectionPaddingTop = Number.parseFloat(window.getComputedStyle(section).paddingTop) || 0;
  const top =
    window.scrollY +
    section.getBoundingClientRect().top +
    sectionPaddingTop -
    headerHeight -
    DEFAULT_HEADING_GAP;

  window.scrollTo({ top: Math.max(0, top), behavior });
  return true;
}
