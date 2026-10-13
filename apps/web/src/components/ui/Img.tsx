'use client';

import Image, { type ImageProps } from 'next/image';
import { useState } from 'react';
import { API_URL, assetUrl } from '@/lib/config';
import { cn } from '@/lib/utils';
import { HomeIcon } from './icons';

const OPTIMIZABLE_HOSTS = new Set([new URL(API_URL).host, 'images.unsplash.com', process.env.NEXT_PUBLIC_UPLOADS_HOST].filter(Boolean));

const canOptimize = (src: string) => {
  try {
    return OPTIMIZABLE_HOSTS.has(new URL(src).host);
  } catch {
    return false;
  }
};

/** next/image wrapper: resolves API-relative URLs, falls back to a placeholder on error / missing src. */
export function Img({ src, alt, className, fallbackClassName, ...p }: Omit<ImageProps, 'src'> & { src: string | null | undefined; fallbackClassName?: string }) {
  const [failed, setFailed] = useState(false);
  const url = assetUrl(src);
  if (!url || failed) {
    return (
      <div className={cn('flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-50 to-surface text-brand/40', fallbackClassName)} aria-label={alt} role="img">
        <HomeIcon size={40} />
      </div>
    );
  }
  return <Image src={url} alt={alt} className={className} unoptimized={!canOptimize(url) || url.startsWith('blob:')} onError={() => setFailed(true)} {...p} />;
}
