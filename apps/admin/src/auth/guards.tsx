import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Lock } from 'lucide-react';
import { useT } from '../i18n';
import { Spinner } from '../components/ui';
import { useAuth } from './AuthContext';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const loc = useLocation();
  if (status === 'loading')
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner className="size-7" />
      </div>
    );
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <>{children}</>;
}

/** Route-level guard for [ADMIN]-only screens. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  const { t } = useT();
  if (!isAdmin)
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
        <div className="rounded-full bg-warning-soft p-3 text-warning">
          <Lock className="size-6" />
        </div>
        <p className="font-medium">{t('Administrators only')}</p>
        <p className="max-w-sm text-sm text-muted">{t('This section is available to the ADMIN role. Ask an administrator if you need access.')}</p>
      </div>
    );
  return <>{children}</>;
}

/** Renders children only for ADMIN (hides ADMIN-only actions from moderators). */
export function AdminOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const { isAdmin } = useAuth();
  return <>{isAdmin ? children : fallback}</>;
}
