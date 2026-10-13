'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ListingImage } from '@evtap/shared';
import { cn } from '@/lib/utils';
import { IconButton, Img } from '@/components/ds';
import { CameraIcon, ChevronLeft, ChevronRight, CloseIcon, ExpandIcon } from '@/components/ds/icons';
import { useI18n } from '@/components/providers/I18nProvider';

function Lightbox({ images, index, onClose, onIndex, title }: { images: ListingImage[]; index: number; onClose: () => void; onIndex: (i: number) => void; title: string }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const prev = useCallback(() => onIndex((index - 1 + images.length) % images.length), [index, images.length, onIndex]);
  const next = useCallback(() => onIndex((index + 1) % images.length), [index, images.length, onIndex]);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    const o = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = o;
      before?.focus?.();
    };
  }, [onClose, prev, next]);
  const [touchX, setTouchX] = useState<number | null>(null);
  const img = images[index]!;
  return createPortal(
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[90] flex flex-col bg-canvas outline-none animate-fade">
      <div className="flex items-center justify-between gap-3 p-4">
        <span className="glass tabular rounded-pill px-4 py-2 text-label">
          {index + 1} / {images.length}
        </span>
        <span className="hidden min-w-0 flex-1 truncate text-center text-label text-ink-secondary sm:block">{title}</span>
        <IconButton label={t('common.close')} variant="raised" onClick={onClose}>
          <CloseIcon size={20} />
        </IconButton>
      </div>
      <div
        className="relative mx-3 flex-1 overflow-hidden rounded-xl bg-surface-sunken sm:mx-6"
        onTouchStart={(e) => setTouchX(e.touches[0]!.clientX)}
        onTouchEnd={(e) => {
          if (touchX == null) return;
          const dx = e.changedTouches[0]!.clientX - touchX;
          if (Math.abs(dx) > 40) (dx > 0 ? prev : next)();
          setTouchX(null);
        }}
      >
        <Img key={img.id} src={img.url} alt={`${title} — ${index + 1}`} fill sizes="100vw" className="object-contain" priority />
        {images.length > 1 && (
          <>
            <IconButton label={t('common.prev')} variant="raised" onClick={prev} className="absolute left-3 top-1/2 -translate-y-1/2 sm:left-6">
              <ChevronLeft size={20} />
            </IconButton>
            <IconButton label={t('common.next')} variant="raised" onClick={next} className="absolute right-3 top-1/2 -translate-y-1/2 sm:right-6">
              <ChevronRight size={20} />
            </IconButton>
          </>
        )}
      </div>
      <div className="scrollbar-none flex gap-2 overflow-x-auto p-4 sm:px-6">
        {images.map((im, i) => (
          <button key={im.id} type="button" onClick={() => onIndex(i)} aria-label={`${i + 1}`} aria-current={i === index} className={cn('relative h-16 w-24 shrink-0 overflow-hidden rounded-sm ring-2 ring-offset-2 ring-offset-canvas', i === index ? 'ring-ink' : 'ring-transparent opacity-60 hover:opacity-100')}>
            <Img src={im.thumbUrl || im.url} alt="" fill sizes="96px" className="object-cover" />
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

/** Large rounded photo + two stacked side photos (desktop), swipe arrows (mobile), glass "N photos" pill, thumbnails. */
export function Gallery({ images, title, coverUrl }: { images: ListingImage[]; title: string; coverUrl: string | null }) {
  const { t } = useI18n();
  const list = images.length ? [...images].sort((a, b) => a.order - b.order) : coverUrl ? [{ id: 'cover', uploadId: null, url: coverUrl, thumbUrl: coverUrl, order: 0 }] : [];
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  if (!list.length) {
    return (
      <div className="relative aspect-[16/9] overflow-hidden rounded-xl">
        <Img src={null} alt={title} />
      </div>
    );
  }
  const side = list.slice(1, 3);
  return (
    <>
      <div className={cn('relative grid gap-3', side.length && 'md:grid-cols-[2fr_1fr] md:grid-rows-2')}>
        <button type="button" onClick={() => setOpen(true)} className="group relative aspect-[4/3] overflow-hidden rounded-xl bg-surface-sunken sm:aspect-[16/10] md:row-span-2 md:aspect-auto md:min-h-[460px]" aria-label={t('listing.openGallery')}>
          <Img src={list[index]!.url} alt={title} fill priority sizes="(min-width: 768px) 66vw, 100vw" className="object-cover transition-transform duration-500 motion-safe:group-hover:scale-[1.02]" />
        </button>
        {side.map((im, i) => (
          <button key={im.id} type="button" onClick={() => { setIndex(i + 1); setOpen(true); }} className="group relative hidden overflow-hidden rounded-xl bg-surface-sunken md:block" aria-label={`${t('listing.openGallery')} — ${i + 2}`}>
            <Img src={im.thumbUrl || im.url} alt="" fill sizes="33vw" className="object-cover transition-transform duration-500 motion-safe:group-hover:scale-[1.03]" />
          </button>
        ))}
        <button type="button" onClick={() => setOpen(true)} className="glass press absolute bottom-4 right-4 inline-flex h-11 items-center gap-2 rounded-pill px-4 text-[14px] font-medium shadow-pill">
          <CameraIcon size={18} /> {list.length}
          <ExpandIcon size={16} />
        </button>
        {list.length > 1 && (
          <>
            <IconButton label={t('common.prev')} variant="raised" onClick={() => setIndex((index - 1 + list.length) % list.length)} className="absolute left-3 top-1/2 -translate-y-1/2 md:hidden">
              <ChevronLeft size={20} />
            </IconButton>
            <IconButton label={t('common.next')} variant="raised" onClick={() => setIndex((index + 1) % list.length)} className="absolute right-3 top-1/2 -translate-y-1/2 md:hidden">
              <ChevronRight size={20} />
            </IconButton>
          </>
        )}
      </div>
      {list.length > 1 && (
        <div className="scrollbar-none mt-3 flex gap-2 overflow-x-auto p-1">
          {list.map((im, i) => (
            <button key={im.id} type="button" onClick={() => setIndex(i)} className={cn('relative h-16 w-24 shrink-0 overflow-hidden rounded-sm ring-2 ring-offset-2 ring-offset-frame transition', i === index ? 'ring-ink' : 'ring-transparent opacity-75 hover:opacity-100')} aria-label={`${i + 1}`} aria-current={i === index}>
              <Img src={im.thumbUrl || im.url} alt="" fill sizes="96px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
      {open && <Lightbox images={list} index={index} onIndex={setIndex} onClose={() => setOpen(false)} title={title} />}
    </>
  );
}
