/** The public host used by our uploaded files and the R2 proxy. */
export function isAllowedR2Url(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "files.localcooks.ca";
  } catch {
    return false;
  }
}
