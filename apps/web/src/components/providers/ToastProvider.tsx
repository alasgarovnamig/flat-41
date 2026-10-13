'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { CheckIcon, CloseIcon, InfoIcon, WarningIcon } from '@/components/ds/icons';

type Kind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: Kind; text: string }
interface ToastApi {
  show: (text: string, kind?: Kind) => void;
  success: (text: string) => void;
  error: (text: string) => void;
  info: (text: string) => void;
}

const Ctx = createContext<ToastApi | null>(null);

const ICON: Record<Kind, ReactNode> = {
  success: <CheckIcon size={16} strokeWidth={2.2} />,
  error: <WarningIcon size={16} />,
  info: <InfoIcon size={16} />,
};

/** Toasts: ink pills bottom-center (bottom-right on desktop), status icon in a small circle. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((x) => x.id !== id)), []);
  const show = useCallback(
    (text: string, kind: Kind = 'info') => {
      const id = ++seq.current;
      setItems((l) => [...l.slice(-3), { id, kind, text }]);
      setTimeout(() => dismiss(id), kind === 'error' ? 6000 : 3500);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(() => ({ show, success: (t) => show(t, 'success'), error: (t) => show(t, 'error'), info: (t) => show(t, 'info') }), [show]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end sm:pr-6">
        {items.map((t) => (
          <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-pill bg-ink py-2 pl-2 pr-3 text-[14px] text-on-ink shadow-raised animate-in">
            <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', t.kind === 'success' && 'bg-success-bg text-success', t.kind === 'error' && 'bg-danger-bg text-danger', t.kind === 'info' && 'bg-on-ink/15 text-on-ink')}>
              {ICON[t.kind]}
            </span>
            <span className="flex-1 py-1">{t.text}</span>
            <button type="button" onClick={() => dismiss(t.id)} className="flex h-8 w-8 items-center justify-center rounded-full opacity-70 hover:opacity-100" aria-label="×">
              <CloseIcon size={16} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToast must be used inside <ToastProvider>');
  return v;
}
