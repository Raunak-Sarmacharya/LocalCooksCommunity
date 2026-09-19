import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import React, { createContext, ReactNode, useContext, useRef, useState } from 'react';

type AlertType = 'info' | 'success' | 'warning' | 'error';

interface AlertOptions {
  title?: string;
  description: string;
  type?: AlertType;
  confirmText?: string;
  cancelText?: string;
  /**
   * Optional second, dismissive choice rendered to the LEFT of the primary one.
   * Material's dialog guidance caps a dialog at two actions — one confirming and
   * one dismissing — so a dialog that tells the user to go elsewhere has to give
   * them the control rather than printing a destination into the body text.
   */
  secondaryText?: string;
  onSecondary?: () => void;
}

interface ConfirmOptions extends AlertOptions {
  onConfirm: () => void;
  onCancel?: () => void;
}

interface PromptOptions {
  title?: string;
  description: string;
  placeholder?: string;
  defaultValue?: string;
  onConfirm: (value: string) => void;
  onCancel?: () => void;
  confirmText?: string;
  cancelText?: string;
}

interface CustomAlertsContextType {
  showAlert: (options: AlertOptions) => void;
  showConfirm: (options: ConfirmOptions) => void;
  showPrompt: (options: PromptOptions) => void;
}

const CustomAlertsContext = createContext<CustomAlertsContextType | undefined>(undefined);

export const useCustomAlerts = () => {
  const context = useContext(CustomAlertsContext);
  if (!context) {
    throw new Error('useCustomAlerts must be used within a CustomAlertsProvider');
  }
  return context;
};

interface AlertState {
  isOpen: boolean;
  options: AlertOptions | null;
}

interface ConfirmState {
  isOpen: boolean;
  options: ConfirmOptions | null;
}

interface PromptState {
  isOpen: boolean;
  options: PromptOptions | null;
  value: string;
}

/**
 * Tone lives in a small tinted icon chip, never in the dialog surface.
 *
 * Painting the whole panel (`bg-amber-50 border-amber-200`) is what made these
 * read as a framework default rather than part of the product: every other
 * surface in the app is the neutral card colour, so a fully tinted panel looks
 * like a debug alert. Material's dialog anatomy is a container plus an OPTIONAL
 * icon — the surface stays a normal elevated surface and the tone is carried by
 * the icon alone.
 */
const ALERT_TONES: Record<AlertType, { chip: string; icon: ReactNode }> = {
  info: { chip: 'bg-blue-100 text-blue-700', icon: <Info className="h-5 w-5" /> },
  success: { chip: 'bg-emerald-100 text-emerald-700', icon: <CheckCircle2 className="h-5 w-5" /> },
  warning: { chip: 'bg-amber-100 text-amber-700', icon: <AlertTriangle className="h-5 w-5" /> },
  error: { chip: 'bg-red-100 text-red-700', icon: <XCircle className="h-5 w-5" /> },
};

/** Shared shell so alert / confirm / prompt are one visual family. */
const DIALOG_SHELL =
  'max-w-md gap-0 rounded-2xl border-border bg-background p-6 shadow-xl ' +
  // Never let the panel outgrow the viewport: at 400% zoom a fixed height puts
  // the actions out of reach (WCAG 1.4.10 Reflow, 2.4.11 Focus Not Obscured).
  'max-h-[min(80vh,40rem)] overflow-y-auto';

/**
 * Dialog heading block: tinted chip, then title and description stacked beside
 * it. Left-aligned at every breakpoint — the base header centres on mobile,
 * which reads wrong once the icon is a chip rather than an inline glyph.
 */
function DialogHeading({
  tone,
  title,
  description,
}: {
  tone: AlertType;
  title: string;
  description: ReactNode;
}) {
  return (
    <AlertDialogHeader className="space-y-0 text-left">
      <div className="flex items-start gap-3.5">
        <span
          aria-hidden
          className={`flex h-10 w-10 flex-none items-center justify-center rounded-full ${ALERT_TONES[tone].chip}`}
        >
          {ALERT_TONES[tone].icon}
        </span>
        <div className="min-w-0 space-y-1.5 pt-0.5">
          <AlertDialogTitle className="text-base font-semibold leading-6 text-foreground">
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm leading-relaxed text-muted-foreground">
            {description}
          </AlertDialogDescription>
        </div>
      </div>
    </AlertDialogHeader>
  );
}

/**
 * The confirming action. Deliberately NOT the brand red.
 *
 * `buttonVariants()` defaults to the primary variant, which the Button component
 * dresses in the chef primary CTA — brand red, red glow, and a lift on hover.
 * On a message dialog that reads as a destructive, brand-shouting button, which
 * is exactly the wrong signal for "acknowledge this and carry on". A neutral
 * near-black keeps the dialog feeling like the product talking rather than
 * selling. The `!` prefixes are required: `chefPrimaryCtaClass` sets these same
 * utilities and CSS source order, not class-attribute order, decides the winner.
 */
const DIALOG_PRIMARY_ACTION =
  'rounded-xl !bg-slate-900 !text-white shadow-none hover:!bg-slate-800 hover:shadow-none hover:translate-y-0 active:translate-y-0';

const DIALOG_DISMISS_ACTION =
  'mt-0 rounded-xl border-border shadow-none hover:shadow-none hover:translate-y-0 active:translate-y-0';

export const CustomAlertsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [alertState, setAlertState] = useState<AlertState>({ isOpen: false, options: null });
  const [confirmState, setConfirmState] = useState<ConfirmState>({ isOpen: false, options: null });
  const [promptState, setPromptState] = useState<PromptState>({ isOpen: false, options: null, value: '' });
  const alertPrimaryRef = useRef<HTMLButtonElement>(null);

  const showAlert = (options: AlertOptions) => {
    setAlertState({ isOpen: true, options });
  };

  const showConfirm = (options: ConfirmOptions) => {
    setConfirmState({ isOpen: true, options });
  };

  const showPrompt = (options: PromptOptions) => {
    setPromptState({ isOpen: true, options, value: options.defaultValue || '' });
  };

  const closeAlert = () => {
    setAlertState({ isOpen: false, options: null });
  };

  const closeConfirm = () => {
    setConfirmState({ isOpen: false, options: null });
  };

  const closePrompt = () => {
    setPromptState({ isOpen: false, options: null, value: '' });
  };

  return (
    <CustomAlertsContext.Provider value={{ showAlert, showConfirm, showPrompt }}>
      {children}

      {/* Alert Dialog */}
      <AlertDialog open={alertState.isOpen} onOpenChange={(open) => !open && closeAlert()}>
        <AlertDialogContent
          className={DIALOG_SHELL}
          onOpenAutoFocus={(event) => {
            // Radix's AlertDialog focuses the *dismissive* action on open and
            // calls preventDefault to suppress its own fallback. With no
            // secondary action there is nothing to focus, so focus stayed on
            // <body> and the dialog was announced to nobody — a WCAG 2.4.3
            // failure that hit every single-action alert in the app. Focus the
            // confirming action instead, which the APG prescribes for a simple
            // acknowledgement dialog.
            if (!alertState.options?.secondaryText) {
              event.preventDefault();
              alertPrimaryRef.current?.focus();
            }
          }}
        >
          <DialogHeading
            tone={alertState.options?.type || 'info'}
            title={alertState.options?.title || 'Alert'}
            description={alertState.options?.description}
          />
          <AlertDialogFooter className="mt-6 flex-col-reverse gap-2.5 sm:flex-row sm:justify-end sm:space-x-0">
            {alertState.options?.secondaryText ? (
              <AlertDialogCancel
                onClick={() => {
                  alertState.options?.onSecondary?.();
                  closeAlert();
                }}
                className={DIALOG_DISMISS_ACTION}
              >
                {alertState.options.secondaryText}
              </AlertDialogCancel>
            ) : null}
            <AlertDialogAction ref={alertPrimaryRef} onClick={closeAlert} className={DIALOG_PRIMARY_ACTION}>
              {alertState.options?.confirmText || 'OK'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm Dialog */}
      <AlertDialog open={confirmState.isOpen} onOpenChange={(open) => !open && closeConfirm()}>
        <AlertDialogContent className={DIALOG_SHELL}>
          <DialogHeading
            tone="warning"
            title={confirmState.options?.title || 'Confirm Action'}
            description={confirmState.options?.description}
          />
          <AlertDialogFooter className="mt-6 flex-col-reverse gap-2.5 sm:flex-row sm:justify-end sm:space-x-0">
            <AlertDialogCancel
              onClick={() => {
                confirmState.options?.onCancel?.();
                closeConfirm();
              }}
              className={DIALOG_DISMISS_ACTION}
            >
              {confirmState.options?.cancelText || 'Cancel'}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                confirmState.options?.onConfirm();
                closeConfirm();
              }}
              className={DIALOG_PRIMARY_ACTION}
            >
              {confirmState.options?.confirmText || 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Prompt Dialog */}
      <AlertDialog open={promptState.isOpen} onOpenChange={(open) => !open && closePrompt()}>
        <AlertDialogContent className={DIALOG_SHELL}>
          <DialogHeading
            tone="info"
            title={promptState.options?.title || 'Input Required'}
            description={promptState.options?.description}
          />
          <div className="pt-4">
            <Label htmlFor="prompt-input" className="sr-only">
              Input value
            </Label>
            <Input
              id="prompt-input"
              placeholder={promptState.options?.placeholder || 'Enter value...'}
              value={promptState.value}
              onChange={(e) => setPromptState(prev => ({ ...prev, value: e.target.value }))}
              className="rounded-xl"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  promptState.options?.onConfirm(promptState.value);
                  closePrompt();
                }
              }}
              autoFocus
            />
          </div>
          <AlertDialogFooter className="mt-6 flex-col-reverse gap-2.5 sm:flex-row sm:justify-end sm:space-x-0">
            <AlertDialogCancel
              onClick={() => {
                promptState.options?.onCancel?.();
                closePrompt();
              }}
              className={DIALOG_DISMISS_ACTION}
            >
              {promptState.options?.cancelText || 'Cancel'}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                promptState.options?.onConfirm(promptState.value);
                closePrompt();
              }}
              className={DIALOG_PRIMARY_ACTION}
            >
              {promptState.options?.confirmText || 'OK'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CustomAlertsContext.Provider>
  );
};
