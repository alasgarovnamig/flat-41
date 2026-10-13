import type { NextConfig } from 'next';
import type { RemotePattern } from 'next/dist/shared/lib/image-config';

const apiUrl = new URL(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000');
const isLocalApi = ['localhost', '127.0.0.1', '0.0.0.0'].includes(apiUrl.hostname);

const apiPattern: RemotePattern = {
  protocol: apiUrl.protocol.replace(':', '') as 'http' | 'https',
  hostname: apiUrl.hostname,
  ...(apiUrl.port ? { port: apiUrl.port } : {}),
  pathname: '/**',
};

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@evtap/shared'],
  poweredByHeader: false,
  experimental: { globalNotFound: true },
  images: {
    remotePatterns: [
      apiPattern,
      { protocol: 'https', hostname: 'images.unsplash.com', pathname: '/**' },
      // optional S3 / CDN bucket for uploads
      ...(process.env.NEXT_PUBLIC_UPLOADS_HOST ? [{ protocol: 'https' as const, hostname: process.env.NEXT_PUBLIC_UPLOADS_HOST, pathname: '/**' }] : []),
    ],
    // Next 16 blocks optimisation of images that resolve to private IPs; the dev API runs on localhost.
    dangerouslyAllowLocalIP: isLocalApi,
  },
};

export default nextConfig;
