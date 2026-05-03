import { createContext, useCallback, useContext, useRef, useState, ReactNode } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type ConfirmOpts = {
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
};

type Ctx = (opts?: ConfirmOpts) => Promise<boolean>;
const ConfirmContext = createContext<Ctx | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmOpts>({});
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<Ctx>((o = {}) => {
    setOpts(o);
    setOpen(true);
    return new Promise<boolean>((resolve) => { resolverRef.current = resolve; });
  }, []);

  const handle = (v: boolean) => {
    setOpen(false);
    resolverRef.current?.(v);
    resolverRef.current = null;
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={open} onOpenChange={(o) => { if (!o) handle(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{opts.title || 'Confirmar exclusão'}</AlertDialogTitle>
            <AlertDialogDescription>
              {opts.description || 'Esta ação não pode ser desfeita. Deseja continuar?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => handle(false)}>{opts.cancelText || 'Cancelar'}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handle(true)}
              className={opts.destructive !== false ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
            >
              {opts.confirmText || 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}
