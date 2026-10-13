import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useT } from '../i18n';
import { FormField, Textarea } from './FormField';
import { Button, cx } from './ui';

/** Esc to close + focus the first focusable element when opened. */
function useDialogBehaviour(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement | null>) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const id = requestAnimationFrame(() => {
      const el = ref.current?.querySelector<HTMLElement>('[data-autofocus], input:not([type=hidden]), textarea, select, button:not([data-close])');
      el?.focus();
    });
    return () => {
      window.removeEventListener('keydown', onKey, true);
      cancelAnimationFrame(id);
      prev?.focus?.();
    };
  }, [open, ref]);
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogBehaviour(open, onClose, ref);
  if (!open) return null;
  return createPortal(
    <div className="animate-fade fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className={cx(
          'animate-pop my-8 w-full rounded-xl border border-line bg-elevated shadow-2xl',
          size === 'sm' && 'max-w-sm',
          size === 'md' && 'max-w-lg',
          size === 'lg' && 'max-w-3xl',
        )}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-base font-semibold">{title}</h2>
          <button data-close onClick={onClose} className="rounded-md p-1 text-muted hover:bg-hover hover:text-fg" aria-label="Close">
            <X className="size-4" />
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'max-w-2xl',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogBehaviour(open, onClose, ref);
  if (!open) return null;
  return createPortal(
    <div className="animate-fade fixed inset-0 z-40 flex justify-end bg-black/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside ref={ref} role="dialog" aria-modal="true" className={cx('animate-drawer flex h-full w-full flex-col border-l border-line bg-elevated shadow-2xl', width)}>
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{title}</h2>
            {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
          </div>
          <button data-close onClick={onClose} className="rounded-md p-1 text-muted hover:bg-hover hover:text-fg" aria-label="Close">
            <X className="size-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </aside>
    </div>,
    document.body,
  );
}

// ─────────────────────────── Confirm / reason prompt ───────────────────────────
type ConfirmOpts = {
  title: ReactNode;
  message?: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
};
type AskOpts = ConfirmOpts & { label?: string; placeholder?: string; presets?: string[]; minLength?: number; initial?: string };
type Pending = { kind: 'confirm'; opts: ConfirmOpts; resolve: (v: boolean) => void } | { kind: 'ask'; opts: AskOpts; resolve: (v: string | null) => void };

const ConfirmCtx = createContext<{ confirm: (o: ConfirmOpts) => Promise<boolean>; ask: (o: AskOpts) => Promise<string | null> } | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState('');
  const { t } = useT();

  const confirm = useCallback((opts: ConfirmOpts) => new Promise<boolean>((resolve) => setPending({ kind: 'confirm', opts, resolve })), []);
  const ask = useCallback(
    (opts: AskOpts) =>
      new Promise<string | null>((resolve) => {
        setValue(opts.initial ?? '');
        setPending({ kind: 'ask', opts, resolve });
      }),
    [],
  );

  const close = (ok: boolean) => {
    if (!pending) return;
    if (pending.kind === 'confirm') pending.resolve(ok);
    else pending.resolve(ok ? value.trim() : null);
    setPending(null);
  };

  const minLen = pending?.kind === 'ask' ? (pending.opts.minLength ?? 3) : 0;
  const valid = pending?.kind !== 'ask' || value.trim().length >= minLen;
  const opts = pending?.opts;

  return (
    <ConfirmCtx.Provider value={{ confirm, ask }}>
      {children}
      <Modal
        open={!!pending}
        onClose={() => close(false)}
        title={opts?.title}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              {t('Cancel')}
            </Button>
            <Button data-autofocus={pending?.kind === 'confirm' ? true : undefined} variant={opts?.tone === 'danger' ? 'danger' : 'primary'} disabled={!valid} onClick={() => close(true)}>
              {opts?.confirmLabel ?? t('Confirm')}
            </Button>
          </>
        }
      >
        {opts?.message && <div className="mb-3 text-sm text-muted">{opts.message}</div>}
        {pending?.kind === 'ask' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) close(true);
            }}
            className="space-y-3"
          >
            {pending.opts.presets && (
              <div className="flex flex-wrap gap-1.5">
                {pending.opts.presets.map((p) => (
                  <button
                    type="button"
                    key={p}
                    onClick={() => setValue(p)}
                    className={cx('rounded-full border px-2.5 py-1 text-xs', value === p ? 'border-brand bg-brand-soft text-brand-fg' : 'border-line-strong hover:bg-hover')}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
            <FormField label={pending.opts.label ?? t('Reason')} hint={minLen ? t('At least {n} characters', { n: minLen }) : undefined}>
              <Textarea
                data-autofocus
                value={value}
                placeholder={pending.opts.placeholder}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && valid) close(true);
                }}
              />
            </FormField>
          </form>
        )}
      </Modal>
    </ConfirmCtx.Provider>
  );
}

export const useConfirm = () => {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error('useConfirm outside ConfirmProvider');
  return ctx;
};
