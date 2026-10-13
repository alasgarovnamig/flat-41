'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { BannerPlacement } from '@evtap/shared';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import { Img } from '@/components/ds';

/** Ad / promo banners managed in admin (GET /banners?placement=…). Renders nothing when empty or on error. */
export function BannerSlot({ placement, className, aspect = 'aspect-[16/5] sm:aspect-[16/3]' }: { placement: BannerPlacement; className?: string; aspect?: string }) {
  const q = useQuery({ queryKey: qk.banners(placement), queryFn: () => api.ref.banners(placement), staleTime: 5 * 60_000, retry: false });
  const items = (q.data ?? []).filter((b) => b.active !== false).sort((a, b) => a.sortOrder - b.sortOrder);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (items.length < 2) return;
    const id = setInterval(() => setI((x) => (x + 1) % items.length), 6000);
    return () => clearInterval(id);
  }, [items.length]);
  if (!items.length) return null;
  const b = items[i % items.length]!;
  return (
    <div className={cn('relative overflow-hidden rounded-xl bg-surface-sunken shadow-card', aspect, className)}>
      <a href={b.linkUrl} target="_blank" rel="noopener sponsored" onClick={() => void api.ref.bannerClick(b.id).catch(() => undefined)} className="absolute inset-0">
        <Img src={b.imageUrl} alt={b.title} fill sizes="(min-width: 1280px) 1280px, 100vw" className="object-cover" />
        <span className="glass absolute right-3 top-3 rounded-pill px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink">Ad</span>
      </a>
      {items.length > 1 && (
        <div className="glass absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-pill px-2 py-1.5">
          {items.map((x, k) => (
            <button key={x.id} type="button" aria-label={x.title} onClick={() => setI(k)} className={cn('h-1.5 rounded-full transition-all', k === i % items.length ? 'w-5 bg-ink' : 'w-1.5 bg-subtle')} />
          ))}
        </div>
      )}
    </div>
  );
}
