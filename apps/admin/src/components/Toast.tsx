import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { errorMessage } from '../api/client';
import { cx } from './ui';

type Kind = 'success' | 'error' | 'info';
type Item = { id: number; kind: Kind; message: string };
type ToastApi = { success: (m: string) => void; error: (m: unknown) => void; info: (m: string) => void };

const ToastCtx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (kind: Kind, message: string) => {
      const id = ++seq.current;
      setItems((xs) => [...xs.slice(-4), { id, kind, message }]);
      setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 4000);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(
    () => ({ success: (m) => push('success', m), info: (m) => push('info', m), error: (e) => push('error', errorMessage(e)) }),
    [push],
  );
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2">
        {items.map((it) => (
          <div
            key={it.id}
            role={it.kind === 'error' ? 'alert' : 'status'}
            className="animate-pop pointer-events-auto flex items-start gap-2.5 rounded-xl border border-line bg-elevated px-3.5 py-3 text-sm shadow-lg"
          >
            {it.kind === 'success' && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />}
            {it.kind === 'error' && <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />}
            {it.kind === 'info' && <Info className="mt-0.5 size-4 shrink-0 text-info" />}
            <p className={cx('flex-1 break-words', it.kind === 'error' && 'text-fg')}>{it.message}</p>
            <button onClick={() => dismiss(it.id)} className="text-muted hover:text-fg" aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx;
};
