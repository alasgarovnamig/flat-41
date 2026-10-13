import type { MetadataRoute } from 'next';
import { WEB_URL } from '@/lib/config';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/*/account', '/*/login', '/*/payment/', '/*/listings/new', '/*/listings/*/edit', '/*/listings/*/promote', '/*/listings/*/pay', '/*/listings/*/stats'],
      },
    ],
    sitemap: `${WEB_URL}/sitemap.xml`,
    host: WEB_URL,
  };
}
