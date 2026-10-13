'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ListingImage } from '@evtap/shared';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/providers/I18nProvider';
import { CameraIcon, ChevronLeft, ChevronRight, CloseIcon, ExpandIcon } from '@/components/ui/icons';
import { Img } from '@/components/ui/Img';

function Lightbox({ images, index, onClose, onIndex, title }: { images: ListingImage[]; index: number; onClose: () => void; onIndex: (i: number) => void; title: string }) {
  const { t } = useI18n();
  const prev = useCallback(() => onIndex((index - 1 + images.length) % images.length), [index, images.length, onIndex]);
  const next = useCallback(() => onIndex((index + 1) % images.length), [index, images.length, onIndex]);
  useEffect(() => {
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
    };
  }, [onClose, prev, next]);
  const [touchX, setTouchX] = useState<number | null>(null);
  const img = images[index]!;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[90] flex flex-col bg-black/95 text-white">
      <div className="flex items-center justify-between p-3">
        <span className="text-sm text-white/70">
          {index + 1} / {images.length}
        </span>
        <button type="button" onClick={onClose} aria-label={t('common.close')} className="rounded-full p-2 hover:bg-white/10">
          <CloseIcon />
        </button>
      </div>
      <div
        className="relative flex-1"
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
            <button type="button" onClick={prev} aria-label={t('common.prev')} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 hover:bg-white/20 sm:left-6">
              <ChevronLeft />
            </button>
            <button type="button" onClick={next} aria-label={t('common.next')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 hover:bg-white/20 sm:right-6">
              <ChevronRight />
            </button>
          </>
        )}
      </div>
      <div className="scrollbar-none flex gap-2 overflow-x-auto p-3">
        {images.map((im, i) => (
          <button key={im.id} type="button" onClick={() => onIndex(i)} className={cn('relative h-14 w-20 shrink-0 overflow-hidden rounded-lg ring-2', i === index ? 'ring-white' : 'ring-transparent opacity-60 hover:opacity-100')}>
            <Img src={im.thumbUrl || im.url} alt="" fill sizes="80px" className="object-cover" />
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

export function Gallery({ images, title, coverUrl }: { images: ListingImage[]; title: string; coverUrl: string | null }) {
  const { t } = useI18n();
  const list = images.length ? [...images].sort((a, b) => a.order - b.order) : coverUrl ? [{ id: 'cover', uploadId: null, url: coverUrl, thumbUrl: coverUrl, order: 0 }] : [];
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  if (!list.length) {
    return (
      <div className="relative aspect-[16/10] overflow-hidden rounded-card">
        <Img src={null} alt={title} />
      </div>
    );
  }
  const side = list.slice(1, 5);
  return (
    <>
      <div className="relative grid gap-2 overflow-hidden rounded-card md:grid-cols-[2fr_1fr] md:grid-rows-2">
        <button type="button" onClick={() => setOpen(true)} className="relative aspect-[16/10] overflow-hidden bg-surface md:row-span-2 md:aspect-auto md:min-h-[420px]" aria-label={t('listing.openGallery')}>
          <Img src={list[index]!.url} alt={title} fill priority sizes="(min-width: 768px) 66vw, 100vw" className="object-cover transition-transform duration-300 hover:scale-[1.02]" />
        </button>
        {side.slice(0, 2).map((im, i) => (
          <button key={im.id} type="button" onClick={() => { setIndex(i + 1); setOpen(true); }} className="relative hidden overflow-hidden bg-surface md:block">
            <Img src={im.thumbUrl || im.url} alt={`${title} — ${i + 2}`} fill sizes="33vw" className="object-cover transition-transform duration-300 hover:scale-[1.03]" />
          </button>
        ))}
        <div className="absolute bottom-3 right-3 flex gap-2">
          <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1.5 rounded-lg bg-white/95 px-3 py-1.5 text-sm font-semibold shadow hover:bg-white">
            <CameraIcon size={16} /> {list.length}
            <ExpandIcon size={14} className="ml-1" />
          </button>
        </div>
        {list.length > 1 && (
          <>
            <button type="button" onClick={() => setIndex((index - 1 + list.length) % list.length)} aria-label={t('common.prev')} className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 shadow md:hidden">
              <ChevronLeft size={18} />
            </button>
            <button type="button" onClick={() => setIndex((index + 1) % list.length)} aria-label={t('common.next')} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 shadow md:hidden">
              <ChevronRight size={18} />
            </button>
          </>
        )}
      </div>
      {list.length > 1 && (
        <div className="scrollbar-none mt-2 flex gap-2 overflow-x-auto">
          {list.map((im, i) => (
            <button key={im.id} type="button" onClick={() => setIndex(i)} className={cn('relative h-16 w-24 shrink-0 overflow-hidden rounded-lg ring-2 transition', i === index ? 'ring-brand' : 'ring-transparent opacity-80 hover:opacity-100')} aria-label={`${i + 1}`}>
              <Img src={im.thumbUrl || im.url} alt="" fill sizes="96px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
      {open && <Lightbox images={list} index={index} onIndex={setIndex} onClose={() => setOpen(false)} title={title} />}
    </>
  );
}
