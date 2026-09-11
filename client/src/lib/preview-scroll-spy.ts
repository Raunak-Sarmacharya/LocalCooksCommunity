/** Pure scroll-spy picker — last section whose top has crossed the activation line. */
export function pickPreviewActiveSectionId(
  sections: { id: string; top: number }[],
  spyOffset: number,
  nearBottom: boolean
): string | null {
  if (sections.length === 0) return null;
  if (nearBottom) return sections[sections.length - 1].id;
  let active = sections[0].id;
  for (const section of sections) {
    if (section.top <= spyOffset + 1) active = section.id;
    else break;
  }
  return active;
}
