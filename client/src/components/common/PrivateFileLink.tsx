import type { AnchorHTMLAttributes } from 'react';
import { usePresignedDocumentUrl } from '@/hooks/use-presigned-document-url';

/** A link to a stored private file: the raw storage URL is not readable, so it opens the authenticated URL. */
export function PrivateFileLink({ url, ...props }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { url: string }) {
  const { url: href } = usePresignedDocumentUrl(url);
  return <a {...props} href={href ?? undefined} target="_blank" rel="noopener noreferrer" aria-busy={!href} />;
}
