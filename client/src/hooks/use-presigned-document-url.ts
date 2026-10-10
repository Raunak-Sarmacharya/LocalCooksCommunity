import { logger } from "@/lib/logger";
import { useState, useEffect } from "react";
import { getAuthenticatedFileUrl } from "@/utils/r2-url-helper";

/** Resolve stored documents through the same authenticated helper as images. */
export function usePresignedDocumentUrl(documentUrl: string | null | undefined): {
    url: string | null;
    isLoading: boolean;
    error: Error | null;
} {
    const [result, setResult] = useState<{ source: string; url: string | null; error: Error | null } | null>(null);

    useEffect(() => {
        let cancelled = false;
        if (!documentUrl) {
            setResult(null);
            return;
        }
        setResult(null);
        getAuthenticatedFileUrl(documentUrl).then(url => {
            if (!cancelled) setResult({ source: documentUrl, url, error: null });
        }).catch(err => {
            logger.error('Error fetching authenticated document URL:', err);
            if (!cancelled) setResult({ source: documentUrl, url: null, error: err instanceof Error ? err : new Error('Failed to load document') });
        });
        return () => { cancelled = true; };
    }, [documentUrl]);

    const current = result?.source === documentUrl ? result : null;
    return { url: current?.url ?? null, isLoading: !!documentUrl && !current, error: current?.error ?? null };
}
