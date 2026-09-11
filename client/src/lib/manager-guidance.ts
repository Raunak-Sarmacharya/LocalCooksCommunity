export function getManagerImprovementDestination(task: string) {
  if (task.includes("location")) return { view: "settings" as const, tab: "branding" as const };
  return { view: "kitchens" as const };
}
