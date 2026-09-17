import { useRef } from "react";

import { mt } from "@/i18n/manager";
import {
  CheckCircle,
  ImagePlus,
  MoreHorizontal,
  Star,
  Trash2,
} from "@/components/ui/manager-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SmartImage } from "@/components/ui/smart-image";
import { resolveImageUrl } from "@/lib/resolve-image-url";
import { getDocumentFilename } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/**
 * The kitchen photo fields, shared by the Photos tab and the onboarding wizard.
 *
 * These are the *fields* only — they own the file input, the dropzone, the
 * preview and the ⋯ menu, and hand a chosen `File` back to the caller. Upload
 * and persistence stay with the caller because the two hosts differ: the Photos
 * tab saves straight to a kitchen that already exists, while the onboarding
 * create form collects the reference into local state and saves with the rest of
 * the form. Sharing the markup is what keeps the two from drifting apart.
 */

export const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

/**
 * The global stylesheet forces `min-height: 44px` on every `<button>` (see
 * `index.css`), and that selector out-specifies a plain utility — so a 32px icon
 * button renders 32 wide by 44 tall, i.e. an oval. These resets need `!` to win.
 */
export const SQUARE_RESET = "!min-h-0 !min-w-0";

/** Small circular icon action that sits on top of a photo. */
export const OVERLAY_ACTION = cn(
  SQUARE_RESET,
  "inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:pointer-events-none disabled:opacity-50",
);

/** Revealed on hover and — importantly — on keyboard focus. */
export const OVERLAY_REVEAL =
  "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100";

/** The dashed dropzone, identical wherever a photo is added. */
const DROPZONE =
  "flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/20 text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

interface CoverPhotoFieldProps {
  /** Stored reference; resolved to a loadable URL internally. */
  value?: string | null;
  /** A file was chosen by click or drop — the caller uploads it. */
  onSelectFile: (file: File) => void;
  /** Chosen from the ⋯ menu. */
  onRemove: () => void;
  disabled?: boolean;
  /** Width class for the field. The Photos tab uses `sm:w-96`; the wizard a form column. */
  className?: string;
  /** Rendered next to the field on wide screens (the Photos tab's tips). */
  children?: React.ReactNode;
}

export function CoverPhotoField({
  value,
  onSelectFile,
  onRemove,
  disabled = false,
  className = "w-full",
  children,
}: CoverPhotoFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const src = resolveImageUrl(value);

  const pick = (files: FileList | null | undefined) => {
    const file = files?.[0];
    if (file) onSelectFile(file);
  };

  return (
    <section className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className={cn("shrink-0", className)}>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(",")}
          className="hidden"
          disabled={disabled}
          onChange={(event) => {
            pick(event.target.files);
            event.target.value = "";
          }}
        />

        {src ? (
          <div className={cn("group relative overflow-hidden rounded-xl border bg-muted/30", className)}>
            <div className="aspect-[16/9]">
              <SmartImage src={src} alt={mt("coverPhoto")} className="h-full w-full object-cover" />
            </div>
            <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
              <Star className="h-3 w-3" />
              {mt("coverPhotoBadge")}
            </span>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={disabled}
                  className={cn(
                    OVERLAY_ACTION,
                    "absolute right-2 top-2 opacity-80 data-[state=open]:opacity-100 group-hover:opacity-100",
                  )}
                  aria-label={mt("photoActions")}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                  disabled={disabled}
                  onSelect={() => inputRef.current?.click()}
                  className="gap-2 focus:bg-muted focus:text-foreground"
                >
                  <ImagePlus className="h-4 w-4 shrink-0" />
                  {mt("replaceCoverPhoto")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={disabled}
                  onSelect={onRemove}
                  className="gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 shrink-0" />
                  {mt("removeCoverPhoto")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              pick(event.dataTransfer.files);
            }}
            className={cn(DROPZONE, "aspect-[16/9]")}
          >
            <ImagePlus className="h-6 w-6" />
            <span className="text-sm font-medium text-foreground">{mt("addCoverPhoto")}</span>
            <span className="text-xs">{mt("jpgPngWebpMaxSize")}</span>
          </button>
        )}
      </div>

      {children}
    </section>
  );
}

interface LogoPhotoFieldProps {
  /** Stored reference; resolved to a loadable URL internally. */
  value?: string | null;
  /** A file was chosen by click or drop — the caller uploads it. */
  onSelectFile: (file: File) => void;
  /** Chosen from the row's Remove action. */
  onRemove: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Business logo field.
 *
 * Deliberately *not* a dropzone. The logo is one field among many in a long
 * form, and uxpatterns.dev's image-upload pattern is explicit about this split:
 * the dropzone variation is for when uploading is the primary task, while a
 * "simple picker" is for when the upload is a small part of a larger form. A
 * square dropzone in a full-width form row is what made this look tacky and
 * pushed the form out of alignment.
 *
 * So: one row. Empty → a quiet picker line. Filled → the mark, its filename and
 * an uploaded tag, with Replace / Remove beside it. The filename comes from the
 * stored URL rather than component state, so it survives a reload.
 */
export function LogoPhotoField({
  value,
  onSelectFile,
  onRemove,
  disabled = false,
  className,
}: LogoPhotoFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const src = resolveImageUrl(value);
  const fileName = value ? getDocumentFilename(value) : null;

  const pick = (files: FileList | null | undefined) => {
    const file = files?.[0];
    if (file) onSelectFile(file);
  };

  return (
    <div className={cn("w-full", className)}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          pick(event.target.files);
          event.target.value = "";
        }}
      />

      {src ? (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
          {/* Preview — same box size as the empty state's icon tile, so the row
              does not change height when a logo is added. */}
          <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background">
            <SmartImage
              src={src}
              alt={fileName || mt("locationLogo")}
              className="h-full w-full object-cover"
            />
          </span>

          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">
              {fileName || mt("locationLogo")}
            </span>
            <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <CheckCircle className="h-3 w-3 shrink-0" aria-hidden />
              {mt("logoUploaded")}
            </span>
          </span>

          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
              className={cn(SQUARE_RESET, "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50")}
            >
              <ImagePlus className="h-3.5 w-3.5" aria-hidden />
              {mt("replace")}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={onRemove}
              className={cn(SQUARE_RESET, "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50")}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {mt("remove")}
            </button>
          </span>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            pick(event.dataTransfer.files);
          }}
          className="flex w-full items-center gap-3 rounded-lg border border-dashed border-border bg-muted/20 p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/40 disabled:opacity-60"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">
            <ImagePlus className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">{mt("addLogo")}</span>
            <span className="block text-xs text-muted-foreground">{mt("jpgPngWebpMaxSize")}</span>
          </span>
        </button>
      )}
    </div>
  );
}

interface CoverPhotoTileProps {
  value?: string | null;
  onSelectFile: (file: File) => void;
  onRemove: () => void;
  disabled?: boolean;
  /** Grid span / sizing from the host, so the cover can lead the gallery. */
  className?: string;
}

/**
 * The cover, drawn as a cell of the gallery grid.
 *
 * Same 4:3 frame, rounding and gap as every other photo so the row reads as one
 * set, with a "Cover" chip in the corner. The chip is the convention Airbnb,
 * Zillow and Turo all use to mark the photo that represents the listing — it
 * says which one leads without needing a caption or a second section.
 */
export function CoverPhotoTile({ value, onSelectFile, onRemove, disabled = false, className }: CoverPhotoTileProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const src = resolveImageUrl(value);

  return (
    <div className="group relative overflow-hidden rounded-xl border bg-muted/30">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onSelectFile(file);
          event.target.value = "";
        }}
      />

      <div className="aspect-[4/3]">
        {src ? (
          <SmartImage src={src} alt="" className="h-full w-full object-cover" />
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-muted-foreground transition-colors hover:bg-muted/50"
          >
            <ImagePlus className="h-5 w-5" aria-hidden />
            <span className="text-xs font-medium">{mt("addCoverPhoto")}</span>
          </button>
        )}
      </div>

      <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
        <Star className="h-3 w-3" aria-hidden />
        {mt("coverPhotoBadge")}
      </span>

      {src && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              className={cn(
                OVERLAY_ACTION,
                "absolute right-2 top-2 opacity-80 data-[state=open]:opacity-100 group-hover:opacity-100",
              )}
              aria-label={mt("photoActions")}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem
              disabled={disabled}
              onSelect={() => inputRef.current?.click()}
              className="gap-2 focus:bg-muted focus:text-foreground"
            >
              <ImagePlus className="h-4 w-4 shrink-0" />
              {mt("replaceCoverPhoto")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={disabled}
              onSelect={onRemove}
              className="gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
            >
              <Trash2 className="h-4 w-4 shrink-0" />
              {mt("removeCoverPhoto")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

interface GalleryPhotoFieldProps {
  /** Stored references; resolved internally. */
  images: string[];
  /** One or more files were chosen — the caller uploads them. */
  onSelectFiles: (files: File[]) => void;
  onReplace: (oldUrl: string, file: File) => void;
  onRemove: (url: string) => void;
  disabled?: boolean;
  /** Optional upload progress line (the Photos tab shows a bar while uploading). */
  progress?: React.ReactNode;
  /**
   * Rendered as the first cell of the same grid — the cover, when the host has
   * one. It has to be a cell rather than a block above the grid: a separate
   * 16:9 banner over a 4:3 grid can never line up, which is what made the
   * photos look uneven.
   */
  coverSlot?: React.ReactNode;
  className?: string;
}

export function GalleryPhotoField({
  images,
  onSelectFiles,
  onReplace,
  onRemove,
  disabled = false,
  progress,
  coverSlot,
  className = "grid grid-cols-2 gap-4 md:grid-cols-3",
}: GalleryPhotoFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef<string | null>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        multiple
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          onSelectFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <input
        ref={replaceInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          const target = replaceTargetRef.current;
          if (file && target) onReplace(target, file);
          replaceTargetRef.current = null;
          event.target.value = "";
        }}
      />

      {progress}

      {(images.length > 0 || coverSlot) && (
        <div className={className}>
          {coverSlot}
          {images.map((imageUrl, index) => (
            <div key={`${imageUrl}-${index}`} className="group relative overflow-hidden rounded-xl border bg-muted/30">
              <div className="aspect-[4/3]">
                <SmartImage
                  src={resolveImageUrl(imageUrl) || undefined}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </div>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={disabled}
                    className={cn(
                      OVERLAY_ACTION,
                      "absolute right-2 top-2 opacity-80 data-[state=open]:opacity-100 group-hover:opacity-100",
                    )}
                    aria-label={mt("photoActions")}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    disabled={disabled}
                    onSelect={() => {
                      replaceTargetRef.current = imageUrl;
                      replaceInputRef.current?.click();
                    }}
                    className="gap-2 focus:bg-muted focus:text-foreground"
                  >
                    <ImagePlus className="h-4 w-4 shrink-0" />
                    {mt("replacePhoto")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={disabled}
                    onSelect={() => onRemove(imageUrl)}
                    className="gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 shrink-0" />
                    {mt("removePhoto")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          onSelectFiles(Array.from(event.dataTransfer.files ?? []));
        }}
        className={cn(DROPZONE, images.length > 0 ? "mt-4 py-6" : "mt-3 py-10 px-6")}
      >
        <ImagePlus className="h-6 w-6" />
        <span className="text-sm font-medium text-foreground">
          {images.length > 0 ? mt("addPhotos") : mt("galleryEmpty")}
        </span>
        <span className="text-xs">
          {images.length > 0 ? mt("jPGPNGWebPMax45MB") : mt("galleryEmptyHint")}
        </span>
      </button>
    </>
  );
}
