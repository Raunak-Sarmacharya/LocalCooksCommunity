import { AlertTriangle, Loader2 } from "@/components/ui/manager-icons";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { mt } from "@/i18n/manager";

interface UnsavedChangesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** One line naming what is unsaved, in the page's own words. */
  description: string;
  /** Continue and lose the edits. */
  onDiscard: () => void;
  /**
   * Persist, then continue. Omit on surfaces whose only way to save *is*
   * navigating — the dialog then offers just Keep editing / Discard.
   */
  onSave?: () => void | Promise<void>;
  /** True while `onSave` is in flight. */
  isSaving?: boolean;
}

/**
 * The three-way unsaved-changes confirmation: keep editing, discard, or save.
 *
 * Every surface that can hold edits uses this one component — the manager
 * dashboard's settings tabs and the onboarding wizard alike — so the choice a
 * manager is offered never depends on which page they happen to be on.
 *
 * Hierarchy is the whole point of the styling here. One filled action (Save),
 * and two quiet ones. The primitives alone would give three competing buttons:
 * `AlertDialogAction` is a flat primary pill, `AlertDialogCancel` is an outline
 * whose hover is invisible (`--accent` is white in this theme), and a
 * `variant="outline"` Button picks up the raised marketing CTA shadow. Those
 * three treatments together are what made this read as unpolished, so each
 * action below cancels its inherited treatment explicitly.
 */
export function UnsavedChangesDialog({
  open,
  onOpenChange,
  description,
  onDiscard,
  onSave,
  isSaving = false,
}: UnsavedChangesDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md gap-0 overflow-hidden p-0">
        {/* A muted glyph anchors the dialog without a coloured badge — the
            house style reserves colour for the primary action. */}
        <AlertDialogHeader className="flex-row items-start gap-3.5 space-y-0 p-5 text-left">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
          >
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <AlertDialogTitle className="text-base font-semibold leading-6 text-foreground">
              {mt("unsavedChanges")}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed">
              {description}
            </AlertDialogDescription>
          </div>
        </AlertDialogHeader>

        {/* Footer is separated by a hairline and a faint wash so the actions
            read as a distinct band rather than a third paragraph. */}
        <AlertDialogFooter className="flex-row flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3.5 sm:space-x-0">
          {/* The Cancel role — quiet, and never the thing that loses work. */}
          <AlertDialogCancel className="mt-0 h-9 !min-h-0 rounded-full border-0 bg-transparent px-3.5 text-sm font-medium text-muted-foreground shadow-none hover:bg-muted hover:text-foreground">
            {mt("keepEditing")}
          </AlertDialogCancel>

          {/* Destructive but deliberately understated: it must be findable,
              not tempting, and it never takes focus. */}
          <Button
            type="button"
            variant="ghost"
            onClick={onDiscard}
            disabled={isSaving}
            className="h-9 !min-h-0 rounded-full px-3.5 text-sm font-medium text-destructive shadow-none hover:translate-y-0 hover:bg-destructive/10 hover:text-destructive hover:shadow-none"
          >
            {mt("discardChanges")}
          </Button>

          {onSave && (
            <AlertDialogAction
              disabled={isSaving}
              onClick={(event) => {
                // Keep the dialog mounted through the save; the caller closes it.
                event.preventDefault();
                void onSave();
              }}
              className="h-9 !min-h-0 rounded-full px-4 text-sm font-medium"
            >
              {isSaving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {mt("saveChanges")}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default UnsavedChangesDialog;
