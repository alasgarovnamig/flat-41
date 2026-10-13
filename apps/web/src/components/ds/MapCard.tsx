'use client';

import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/providers/I18nProvider';
import { Card } from './Card';
import { CloseIcon, ExpandIcon } from './icons';
import { IconButton } from './IconButton';

/**
 * Card with title "Map" + expand icon; the map inside is rounded and monochrome (tiles desaturated via `.map-mono`).
 * Expanding turns the card into a full-viewport overlay (Escape / button collapses it).
 */
export function MapCard({ title, children, className, mapClassName, overlay, expandable = true, actions }: { title: ReactNode; children: ReactNode; className?: string; mapClassName?: string; overlay?: ReactNode; expandable?: boolean; actions?: ReactNode }) {
  const { t } = useI18n();
  const [full, setFull] = useState(false);
  return (
    <Card
      pad="none"
      className={cn('relative flex flex-col overflow-hidden', full && 'fixed inset-3 z-[70] rounded-xl shadow-raised', className)}
      onKeyDown={(e) => {
        if (full && e.key === 'Escape') setFull(false);
      }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] flex items-start justify-between gap-2 p-4">
        <h2 className="glass pointer-events-auto rounded-pill px-4 py-2 text-h3 shadow-pill">{title}</h2>
        <div className="pointer-events-auto flex items-center gap-2">
          {actions}
          {expandable && (
            <IconButton label={full ? t('common.close') : t('map.expand')} variant="raised" onClick={() => setFull((f) => !f)}>
              {full ? <CloseIcon size={18} /> : <ExpandIcon size={18} />}
            </IconButton>
          )}
        </div>
      </div>
      {overlay && <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[500] flex justify-center p-4">{overlay}</div>}
      <div className={cn('relative min-h-[320px] flex-1 overflow-hidden rounded-xl', mapClassName)}>{children}</div>
    </Card>
  );
}
