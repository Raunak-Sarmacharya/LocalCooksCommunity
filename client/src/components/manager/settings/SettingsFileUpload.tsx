import { Card } from "@tremor/react";
import { RiUploadCloud2Line } from "@remixicon/react";
import { Loader2 } from "lucide-react";

interface SettingsFileUploadProps {
  id: string;
  accept: string;
  file: File | null;
  label: string;
  hint: string;
  disabled?: boolean;
  onChange: (file: File | null) => void;
}

export function SettingsFileUpload({ id, accept, file, label, hint, disabled, onChange }: SettingsFileUploadProps) {
  return (
    <Card className="relative overflow-hidden p-0 shadow-none ring-1 ring-border">
      <input
        id={id}
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(event) => onChange(event.target.files?.[0] || null)}
        className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <label htmlFor={id} className="flex min-h-16 cursor-pointer items-center gap-3 px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-background">
          {disabled ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
          ) : (
            <RiUploadCloud2Line className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-foreground">{file?.name || label}</span>
          <span className="block text-xs text-muted-foreground">{hint}</span>
        </span>
      </label>
    </Card>
  );
}
