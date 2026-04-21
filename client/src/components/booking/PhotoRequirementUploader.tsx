/**
 * PhotoRequirementUploader
 *
 * Renders one upload slot per photo requirement. Chefs must upload at least
 * one photo per required requirement before proceeding. When no requirements
 * are defined, falls back to a single generic uploader.
 *
 * State shape: Record<requirementId | '__generic__', string[]>
 */

import { useCallback } from "react"
import { Camera, Upload, X, Loader2, CheckCircle } from "lucide-react"
import { toast } from "sonner"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { getR2ProxyUrl } from "@/utils/r2-url-helper"
import { useSessionFileUpload } from "@/hooks/useSessionFileUpload"
import type { PhotoRequirement } from "@/hooks/use-location-checklist"

const GENERIC_KEY = "__generic__"
export const MAX_PHOTOS_PER_REQUIREMENT = 3
export const GENERIC_MAX_PHOTOS = 10
export const GENERIC_MIN_PHOTOS = 1

export interface PhotoRequirementUploaderProps {
  /** Manager-defined photo requirements. Empty array = use generic uploader. */
  requirements: PhotoRequirement[]
  /** Current uploaded photos keyed by requirement id (or __generic__ for fallback). */
  photos: Record<string, string[]>
  /** Setter for the photos map. */
  onPhotosChange: (next: Record<string, string[]>) => void
  /** Folder name on R2 for uploaded files. */
  uploadFolder: string
  /** Fallback instructional text when no requirements are defined. */
  genericInstruction?: string
  /** Disable the whole uploader. */
  disabled?: boolean
}

/**
 * Flattens the photos map into a single array of URLs (the format stored server-side).
 */
export function flattenPhotos(photos: Record<string, string[]>): string[] {
  return Object.values(photos).flat().filter(Boolean)
}

/**
 * Checks whether all required photo slots have at least one upload.
 * If no requirements, returns true when at least one generic photo exists.
 */
export function areAllRequiredPhotosUploaded(
  requirements: PhotoRequirement[],
  photos: Record<string, string[]>,
): boolean {
  if (requirements.length === 0) {
    return (photos[GENERIC_KEY]?.length || 0) >= GENERIC_MIN_PHOTOS
  }
  return requirements
    .filter((r) => r.required !== false) // required defaults to true
    .every((r) => (photos[r.id]?.length || 0) >= 1)
}

function SingleRequirementSlot({
  requirementId,
  label,
  description,
  required,
  max,
  photos,
  onChange,
  uploadFolder,
  disabled,
}: {
  requirementId: string
  label: string
  description?: string
  required: boolean
  max: number
  photos: string[]
  onChange: (next: string[]) => void
  uploadFolder: string
  disabled?: boolean
}) {
  const { uploadFile, isUploading, uploadProgress } = useSessionFileUpload({
    maxSize: 4.5 * 1024 * 1024,
    allowedTypes: ["image/jpeg", "image/jpg", "image/png", "image/webp"],
    onSuccess: (response) => {
      onChange([...photos, response.url])
    },
    onError: (err) => toast.error(err),
  })

  const handleUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      if (photos.length >= max) {
        toast.error(`You can upload up to ${max} photo${max !== 1 ? "s" : ""} for this requirement`)
        return
      }
      uploadFile(file, uploadFolder)
      e.target.value = ""
    },
    [uploadFile, photos.length, max, uploadFolder],
  )

  const handleRemove = useCallback(
    (url: string) => {
      onChange(photos.filter((p) => p !== url))
    },
    [photos, onChange],
  )

  const hasPhotos = photos.length > 0
  const slotId = `photo-slot-${requirementId}`

  return (
    <div
      className={cn(
        "rounded-lg border p-3 space-y-2 transition-colors",
        hasPhotos ? "border-green-200 bg-green-50/40" : "border-border bg-background",
      )}
    >
      {/* Header: label + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <Camera className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {label}
              {required && <span className="text-destructive ml-0.5">*</span>}
            </span>
          </p>
          {description && (
            <p className="text-[11px] text-muted-foreground mt-0.5 ml-5">{description}</p>
          )}
        </div>
        {hasPhotos && (
          <Badge variant="success" className="text-[10px] shrink-0">
            <CheckCircle className="h-2.5 w-2.5 mr-0.5" />
            {photos.length}/{max}
          </Badge>
        )}
      </div>

      {/* Thumbnails */}
      {hasPhotos && (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((url, i) => (
            <div key={`${url}-${i}`} className="relative group">
              <img
                src={getR2ProxyUrl(url)}
                alt={`${label} photo ${i + 1}`}
                className="w-full h-16 object-cover rounded-md border"
              />
              <button
                type="button"
                onClick={() => handleRemove(url)}
                className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label={`Remove photo ${i + 1}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Upload button */}
      {photos.length < max && (
        <div
          className={cn(
            "border-2 border-dashed rounded-md p-2.5 transition-colors",
            hasPhotos ? "border-green-300 hover:border-green-400" : "border-border hover:border-primary/50",
            (isUploading || disabled) && "opacity-50 cursor-not-allowed",
          )}
        >
          <input
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            onChange={handleUpload}
            className="hidden"
            id={slotId}
            disabled={isUploading || disabled}
          />
          <label
            htmlFor={slotId}
            className={cn(
              "flex items-center justify-center gap-2 cursor-pointer text-xs",
              (isUploading || disabled) && "cursor-not-allowed",
            )}
          >
            {isUploading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Uploading... {Math.round(uploadProgress)}%</span>
              </>
            ) : (
              <>
                <Upload className="h-3.5 w-3.5" />
                <span>{hasPhotos ? "Add another photo" : "Upload photo"}</span>
              </>
            )}
          </label>
        </div>
      )}
    </div>
  )
}

export function PhotoRequirementUploader({
  requirements,
  photos,
  onPhotosChange,
  uploadFolder,
  genericInstruction,
  disabled,
}: PhotoRequirementUploaderProps) {
  const updateSlot = useCallback(
    (id: string, next: string[]) => {
      onPhotosChange({ ...photos, [id]: next })
    },
    [photos, onPhotosChange],
  )

  // Fallback: no requirements defined → show single generic uploader with backwards-compatible behavior.
  if (requirements.length === 0) {
    return (
      <SingleRequirementSlot
        requirementId={GENERIC_KEY}
        label="Condition Photos"
        description={
          genericInstruction ||
          "Upload photos showing the current condition. This helps resolve any disputes and speeds up approval."
        }
        required
        max={GENERIC_MAX_PHOTOS}
        photos={photos[GENERIC_KEY] || []}
        onChange={(next) => updateSlot(GENERIC_KEY, next)}
        uploadFolder={uploadFolder}
        disabled={disabled}
      />
    )
  }

  const totalUploaded = requirements.reduce(
    (sum, r) => sum + (photos[r.id]?.length || 0),
    0,
  )
  const totalRequired = requirements.filter((r) => r.required !== false).length
  const completedRequired = requirements.filter(
    (r) => r.required !== false && (photos[r.id]?.length || 0) >= 1,
  ).length

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium flex items-center gap-1.5">
          <Camera className="h-4 w-4" />
          Photos Required
        </Label>
        <Badge
          variant={completedRequired === totalRequired ? "success" : "outline"}
          className="text-[10px]"
        >
          {completedRequired}/{totalRequired} completed
        </Badge>
      </div>
      <p className="text-[11px] text-muted-foreground">
        One photo required per item. You can upload up to {MAX_PHOTOS_PER_REQUIREMENT} per slot.
      </p>
      <div className="space-y-2">
        {requirements.map((req) => (
          <SingleRequirementSlot
            key={req.id}
            requirementId={req.id}
            label={req.label}
            description={req.description}
            required={req.required !== false}
            max={MAX_PHOTOS_PER_REQUIREMENT}
            photos={photos[req.id] || []}
            onChange={(next) => updateSlot(req.id, next)}
            uploadFolder={uploadFolder}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  )
}
