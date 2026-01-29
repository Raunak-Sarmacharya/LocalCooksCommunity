import { ExternalLink, Loader2, FileText, AlertCircle } from 'lucide-react';
import { usePresignedDocumentUrl } from '@/hooks/use-presigned-document-url';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useState } from 'react';

interface SecureDocumentLinkProps {
    url: string | null | undefined;
    label?: string;
    fileName?: string;
    className?: string;
    showIcon?: boolean;
}

export function SecureDocumentLink({
    url,
    label = "View Document",
    fileName,
    className,
    showIcon = true
}: SecureDocumentLinkProps) {
    const { url: signedUrl, isLoading, error } = usePresignedDocumentUrl(url);
    const [imgError, setImgError] = useState(false);

    if (!url) {
        return <span className="text-gray-400 text-sm italic">No document</span>;
    }

    const handleClick = (e: React.MouseEvent) => {
        // If it's a direct PDF/Image link, we usually want new tab
        if (signedUrl) {
            // Allow default behavior but ensure we have the signed URL
        } else {
            e.preventDefault();
        }
    };

    const isImage = url.match(/\.(jpg|jpeg|png|webp|gif)$/i) || (fileName && fileName.match(/\.(jpg|jpeg|png|webp|gif)$/i));

    return (
        <div className={cn("flex items-center gap-2", className)}>
            {showIcon && (
                <div className={cn(
                    "p-2 rounded-lg flex items-center justify-center",
                    error ? "bg-red-50 text-red-500" : "bg-primary/10 text-primary"
                )}>
                    {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : error ? (
                        <AlertCircle className="h-4 w-4" />
                    ) : (
                        <FileText className="h-4 w-4" />
                    )}
                </div>
            )}

            <div className="flex flex-col">
                {fileName && <span className="text-sm font-medium text-gray-700 truncate max-w-[200px]">{fileName}</span>}

                {isLoading ? (
                    <span className="text-xs text-gray-400">Loading...</span>
                ) : (
                    <a
                        href={signedUrl || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={handleClick}
                        className={cn(
                            "text-sm hover:underline flex items-center gap-1",
                            error ? "text-red-500 cursor-not-allowed" : "text-primary hover:text-primary/80"
                        )}
                        title={error ? "Failed to load document" : label}
                    >
                        {error ? "Error loading document" : label}
                        {!error && <ExternalLink className="h-3 w-3" />}
                    </a>
                )}
            </div>
        </div>
    );
}
