import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { Modal } from './Modal';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

type ConfirmApi = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmApi | null>(null);

// Port of app/index.html's confirmDialog()/Swal.fire confirm pattern, without the SweetAlert2
// dependency — same job (never let a destructive action fire on a bare click), built on the
// Modal primitive already in this package. useConfirm() returns a promise that resolves true/
// false, so call sites read the same as the original: `if (await confirm({...})) { ...destroy... }`.
export function useConfirm(): ConfirmApi {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => { setState({ ...options, resolve }); });
  }, []);

  function close(result: boolean) {
    state?.resolve(result);
    setState(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <Modal title={state.title} onClose={() => close(false)} footer={
          <>
            <button className="btn btn-ghost" onClick={() => close(false)}>Cancel</button>
            <button className={'btn ' + (state.danger ? 'btn-danger' : 'btn-primary')} onClick={() => close(true)}>
              {state.confirmLabel || 'Confirm'}
            </button>
          </>
        }>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text)' }}>{state.message}</p>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}
