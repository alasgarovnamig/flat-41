'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/providers/I18nProvider';
import { CloseIcon } from './icons';
import { IconButton } from './IconButton';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Scroll lock + Escape + focus trap + focus restore for dialogs. */
function useDialog(open: boolean, onClose: () => void, ref: RefObject<HTMLElement | null>) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => {
      const el = ref.current;
      const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el;
      first?.focus();
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
      if (e.key === 'Tab' && ref.current) {
        const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
        if (!items.length) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
      prevFocus?.focus?.();
    };
  }, [open, ref]);
}

function DialogHeader({ title, titleId, onClose, sub }: { title?: ReactNode; titleId: string; onClose: () => void; sub?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="glass sticky top-0 z-10 flex items-center justify-between gap-4 rounded-t-xl border-x-0 border-t-0 px-6 py-4">
      <div className="min-w-0">
        <h2 id={titleId} className="text-h3">
          {title}
        </h2>
        {sub && <p className="mt-0.5 text-label font-normal text-muted">{sub}</p>}
      </div>
      <IconButton label={t('common.close')} onClick={onClose} size="sm">
        <CloseIcon size={18} />
      </IconButton>
    </div>
  );
}

/** Centered dialog on desktop, bottom sheet on phones. `surfaceRaised`, radius 28, scrim, glass header. */
export function Modal({ open, onClose, title, sub, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title?: ReactNode; sub?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' }) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useDialog(open, onClose, ref);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-scrim animate-fade sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={cn(
          'flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-xl bg-surface-raised shadow-raised outline-none animate-in sm:rounded-xl',
          size === 'sm' && 'sm:max-w-md',
          size === 'md' && 'sm:max-w-lg',
          size === 'lg' && 'sm:max-w-3xl',
        )}
      >
        <DialogHeader title={title} sub={sub} titleId={titleId} onClose={onClose} />
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-hairline px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Side panel on desktop (left/right), bottom sheet on phones. */
export function Sheet({ open, onClose, title, children, footer, side = 'right' }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; side?: 'left' | 'right' }) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useDialog(open, onClose, ref);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] bg-scrim animate-fade" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={cn(
          'absolute flex flex-col bg-surface-raised shadow-raised outline-none animate-in',
          'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-xl',
          'sm:inset-y-3 sm:bottom-3 sm:max-h-none sm:w-full sm:max-w-md sm:rounded-xl',
          side === 'left' ? 'sm:left-3 sm:right-auto' : 'sm:right-3 sm:left-auto',
        )}
      >
        <DialogHeader title={title} titleId={titleId} onClose={onClose} />
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="border-t border-hairline px-6 py-4">{footer}</div>}
      </aside>
    </div>,
    document.body,
  );
}

/** Lightweight anchored popover (menus, filter dropdowns). Closes on outside click / Escape. */
export function Popover({
  trigger, children, align = 'left', className, panelClassName, open: controlled, onOpenChange, width = 'w-72',
}: {
  trigger: (p: { open: boolean; toggle: () => void; id: string }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'left' | 'right';
  className?: string;
  panelClassName?: string;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  width?: string;
}) {
  const [inner, setInner] = useState(false);
  const open = controlled ?? inner;
  const set = useCallback((o: boolean) => (onOpenChange ? onOpenChange(o) : setInner(o)), [onOpenChange]);
  const ref = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number; maxH: number } | null>(null);
  // Positioned in a portal (fixed) so scroll containers (tables, filter rows) never clip it.
  useLayoutEffect(() => {
    if (!open) return setPos(null);
    const place = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const vw = window.innerWidth;
      const top = r.bottom + 8;
      const maxH = Math.max(160, window.innerHeight - top - 12);
      setPos(align === 'right' ? { top, right: Math.max(12, vw - r.right), maxH } : { top, left: Math.max(12, Math.min(r.left, vw - 12 - 280)), maxH });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || panel.current?.contains(target)) return;
      set(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      set(false);
      ref.current?.querySelector<HTMLElement>('button,a')?.focus();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, set]);
  const close = () => set(false);
  return (
    <div ref={ref} className={cn('relative', className)}>
      {trigger({ open, toggle: () => set(!open), id })}
      {open &&
        pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={panel}
            id={id}
            style={{ top: pos.top, left: pos.left, right: pos.right, maxHeight: pos.maxH }}
            className={cn('fixed z-[85] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg bg-surface-raised p-2 shadow-raised ring-1 ring-hairline animate-in', width, panelClassName)}
          >
            {typeof children === 'function' ? children(close) : children}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Row inside a Popover menu. */
export function MenuItem({ icon, children, onClick, href, danger, trailing, active }: { icon?: ReactNode; children: ReactNode; onClick?: () => void; href?: string; danger?: boolean; trailing?: ReactNode; active?: boolean }) {
  const cls = cn(
    'flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-[14px] transition-colors',
    danger ? 'text-danger hover:bg-danger-bg' : 'text-ink hover:bg-surface-sunken',
    active && 'bg-surface-sunken font-medium',
  );
  const inner = (
    <>
      {icon && <span className={danger ? 'text-danger' : 'text-ink-secondary'}>{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </>
  );
  if (href)
    return (
      <Link href={href} role="menuitem" className={cls} onClick={onClick}>
        {inner}
      </Link>
    );
  return (
    <button type="button" role="menuitem" className={cls} onClick={onClick}>
      {inner}
    </button>
  );
}
