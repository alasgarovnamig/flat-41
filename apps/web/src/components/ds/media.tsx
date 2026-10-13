'use client';

import Image, { type ImageProps } from 'next/image';
import { useState } from 'react';
import { API_URL, assetUrl } from '@/lib/config';
import { cn, initials } from '@/lib/utils';
import { HomeIcon } from './icons';

const OPTIMIZABLE_HOSTS = new Set([new URL(API_URL).host, 'images.unsplash.com', process.env.NEXT_PUBLIC_UPLOADS_HOST].filter(Boolean));

const canOptimize = (src: string) => {
  try {
    return OPTIMIZABLE_HOSTS.has(new URL(src).host);
  } catch {
    return false;
  }
};

/** next/image wrapper: resolves API-relative URLs; monochrome placeholder on error / missing src. */
export function Img({ src, alt, className, fallbackClassName, ...p }: Omit<ImageProps, 'src'> & { src: string | null | undefined; fallbackClassName?: string }) {
  const [failed, setFailed] = useState(false);
  const url = assetUrl(src);
  if (!url || failed) {
    return (
      <div className={cn('flex h-full w-full items-center justify-center bg-surface-sunken text-subtle', fallbackClassName)} aria-label={alt} role="img">
        <HomeIcon size={40} strokeWidth={1.2} />
      </div>
    );
  }
  return <Image src={url} alt={alt} className={className} unoptimized={!canOptimize(url) || url.startsWith('blob:')} onError={() => setFailed(true)} {...p} />;
}

/** Round avatar (photo or initials on `pill`). */
export function Avatar({ name, url, size = 44, className, square }: { name?: string | null; url?: string | null; size?: number; className?: string; square?: boolean }) {
  const src = assetUrl(url);
  const [failed, setFailed] = useState(false);
  const shape = square ? 'rounded-md' : 'rounded-full';
  if (src && !failed)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" width={size} height={size} onError={() => setFailed(true)} className={cn('shrink-0 bg-surface-sunken object-cover', shape, className)} style={{ width: size, height: size }} />
    );
  return (
    <span className={cn('flex shrink-0 items-center justify-center bg-pill font-display font-medium text-ink', shape, className)} style={{ width: size, height: size, fontSize: Math.max(11, size * 0.36) }} aria-hidden>
      {initials(name)}
    </span>
  );
}
