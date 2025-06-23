import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, CheckCircle, Info, XCircle } from 'lucide-react';
import React, { createContext, ReactNode, useContext, useState } from 'react';

type AlertType = 'info' | 'success' | 'warning' | 'error';

interface AlertOptions {
  title?: string;
  description: string;
  type?: AlertType;
  confirmText?: string;
  cancelText?: string;
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

export const CustomAlertsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [alertState, setAlertState] = useState<AlertState>({ isOpen: false, options: null });
  const [confirmState, setConfirmState] = useState<ConfirmState>({ isOpen: false, options: null });
  const [promptState, setPromptState] = useState<PromptState>({ isOpen: false, options: null, value: '' });

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

  const getAlertIcon = (type: AlertType) => {
    switch (type) {
      case 'success':
        return <CheckCircle className="h-6 w-6 text-green-600" />;
      case 'warning':
        return <AlertTriangle className="h-6 w-6 text-amber-600" />;
      case 'error':
        return <XCircle className="h-6 w-6 text-red-600" />;
      default:
        return <Info className="h-6 w-6 text-blue-600" />;
    }
  };

  const getAlertStyles = (type: AlertType) => {
    switch (type) {
      case 'success':
        return 'border-green-200 bg-green-50';
      case 'warning':
        return 'border-amber-200 bg-amber-50';
      case 'error':
        return 'border-red-200 bg-red-50';
      default:
        return 'border-blue-200 bg-blue-50';
    }
  };

  return (
    <CustomAlertsContext.Provider value={{ showAlert, showConfirm, showPrompt }}>
      {children}

      {/* Alert Dialog */}
      <AlertDialog open={alertState.isOpen} onOpenChange={(open) => !open && closeAlert()}>
        <AlertDialogContent className={`max-w-md ${alertState.options ? getAlertStyles(alertState.options.type || 'info') : ''}`}>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-3">
              {alertState.options && getAlertIcon(alertState.options.type || 'info')}
              {alertState.options?.title || 'Alert'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-gray-700">
              {alertState.options?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={closeAlert} className="rounded-xl">
              {alertState.options?.confirmText || 'OK'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm Dialog */}
      <AlertDialog open={confirmState.isOpen} onOpenChange={(open) => !open && closeConfirm()}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-3">
              <AlertTriangle className="h-6 w-6 text-amber-600" />
              {confirmState.options?.title || 'Confirm Action'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-gray-700">
              {confirmState.options?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel 
              onClick={() => {
                confirmState.options?.onCancel?.();
                closeConfirm();
              }}
              className="rounded-xl"
            >
              {confirmState.options?.cancelText || 'Cancel'}
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => {
                confirmState.options?.onConfirm();
                closeConfirm();
              }}
              className="rounded-xl"
            >
              {confirmState.options?.confirmText || 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Prompt Dialog */}
      <AlertDialog open={promptState.isOpen} onOpenChange={(open) => !open && closePrompt()}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-3">
              <Info className="h-6 w-6 text-blue-600" />
              {promptState.options?.title || 'Input Required'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-gray-700">
              {promptState.options?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
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
          <AlertDialogFooter>
            <AlertDialogCancel 
              onClick={() => {
                promptState.options?.onCancel?.();
                closePrompt();
              }}
              className="rounded-xl"
            >
              {promptState.options?.cancelText || 'Cancel'}
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => {
                promptState.options?.onConfirm(promptState.value);
                closePrompt();
              }}
              className="rounded-xl"
            >
              {promptState.options?.confirmText || 'OK'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CustomAlertsContext.Provider>
  );
};

export const showEmailPrompt = (): Promise<string | null> => {
  return new Promise((resolve) => {
    const handleConfirm = (value: string) => {
      resolve(value || null);
    };
    
    const handleCancel = () => {
      resolve(null);
    };

    // This is a temporary fallback - in a real app, you'd want to integrate this with the provider
    const email = window.prompt('Please provide your email for confirmation') || '';
    resolve(email);
  });
}; 