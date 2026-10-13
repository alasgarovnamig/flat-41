'use client';

import { useRef } from 'react';
import type { ListingCard as Card } from '@evtap/shared';
import { useI18n } from '@/components/providers/I18nProvider';
import { ChevronLeft, ChevronRight } from '@/components/ui/icons';
import { ListingCard, ListingCardSkeleton } from './ListingCard';

/** Horizontal scroll-snap carousel of listing cards with arrow buttons. */
export function ListingCarousel({ items, loading }: { items: Card[]; loading?: boolean }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: 'smooth' });
  return (
    <div className="relative">
      <div ref={ref} className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-4 px-4 pb-2 sm:-mx-1 sm:px-1">
        {loading
          ? Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="w-[80%] shrink-0 sm:w-[46%] lg:w-[31%] xl:w-[23.5%]">
                <ListingCardSkeleton />
              </div>
            ))
          : items.map((l, i) => (
              <div key={l.id} className="w-[80%] shrink-0 snap-start sm:w-[46%] lg:w-[31%] xl:w-[23.5%]">
                <ListingCard l={l} priority={i < 2} />
              </div>
            ))}
      </div>
      {!loading && items.length > 4 && (
        <>
          <button type="button" onClick={() => scroll(-1)} aria-label={t('common.prev')} className="absolute -left-4 top-[30%] hidden h-10 w-10 items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-black/5 hover:bg-surface lg:flex">
            <ChevronLeft />
          </button>
          <button type="button" onClick={() => scroll(1)} aria-label={t('common.next')} className="absolute -right-4 top-[30%] hidden h-10 w-10 items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-black/5 hover:bg-surface lg:flex">
            <ChevronRight />
          </button>
        </>
      )}
    </div>
  );
}
