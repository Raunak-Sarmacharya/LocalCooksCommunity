import type { Application } from "@shared/schema";

/** Newest active seller application — same rule as My Applications tab. */
export function pickDocumentVerificationApp(
  applications: Application[] | undefined | null,
): Application | null {
  if (!applications?.length) return null;
  const sorted = [...applications].sort((a, b) => {
    const aTime = new Date(a.createdAt as unknown as string).getTime();
    const bTime = new Date(b.createdAt as unknown as string).getTime();
    return bTime - aTime;
  });
  return (
    sorted.find((app) => app.status !== "cancelled" && app.status !== "rejected") ??
    sorted[0]
  );
}
