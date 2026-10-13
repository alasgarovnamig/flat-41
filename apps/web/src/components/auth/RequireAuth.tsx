'use client';

import type { ReactNode } from 'react';
import { useRequireAuth } from '@/components/providers/AuthProvider';
import { PageSpinner } from '@/components/ui/feedback';

/** Renders children only for logged-in users; anonymous users are redirected to /login?next=… */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useRequireAuth();
  if (status !== 'authenticated') return <PageSpinner />;
  return <>{children}</>;
}
