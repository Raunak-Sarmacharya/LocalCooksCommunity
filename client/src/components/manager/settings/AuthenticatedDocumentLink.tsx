/**
 * Shared document link for manager settings.
 * Prefers a short-lived presigned URL, falls back to the raw URL while it loads.
 */

import type { ReactNode } from "react";
import { usePresignedDocumentUrl } from "@/hooks/use-presigned-document-url";

export function AuthenticatedDocumentLink({ url, className, children }: { url: string | null | undefined; className?: string; children: ReactNode }) {
  const { url: presignedUrl } = usePresignedDocumentUrl(url);

  if (!url) return null;

  return (
    <a
      href={presignedUrl || url}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children}
    </a>
  );
}
