import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiRequestError } from './api/client';
import { AuthProvider } from './auth/AuthContext';
import { RequireAdmin, RequireAuth } from './auth/guards';
import { Layout } from './components/Layout';
import { ConfirmProvider } from './components/Modal';
import { ToastProvider } from './components/Toast';
import { SkeletonBlock } from './components/ui';
import { I18nProvider } from './i18n';
import { LoginPage } from './pages/Login';

const DashboardPage = lazy(() => import('./pages/Dashboard'));
const ModerationPage = lazy(() => import('./pages/Moderation'));
const ListingsPage = lazy(() => import('./pages/Listings'));
const ListingDetailPage = lazy(() => import('./pages/ListingDetail'));
const UsersPage = lazy(() => import('./pages/Users'));
const UserDetailPage = lazy(() => import('./pages/UserDetail'));
const AgenciesPage = lazy(() => import('./pages/Agencies'));
const PaymentsPage = lazy(() => import('./pages/Payments'));
const BookingsPage = lazy(() => import('./pages/Bookings'));
const SubscriptionsPage = lazy(() => import('./pages/Subscriptions'));
const ReportsPage = lazy(() => import('./pages/Reports'));
const CatalogPage = lazy(() => import('./pages/Catalog'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const BannersPage = lazy(() => import('./pages/Banners'));
const CmsPagesPage = lazy(() => import('./pages/CmsPages'));
const CmsPageEditor = lazy(() => import('./pages/CmsPageEditor'));
const MortgagePage = lazy(() => import('./pages/Mortgage'));
const BroadcastPage = lazy(() => import('./pages/Broadcast'));
const AuditPage = lazy(() => import('./pages/Audit'));
const NotFoundPage = lazy(() => import('./pages/NotFound'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      refetchOnWindowFocus: false,
      // don't hammer endpoints that are missing / forbidden / invalid
      retry: (count, e) => !(e instanceof ApiRequestError && e.status >= 400 && e.status < 500) && count < 2,
    },
  },
});

const page = (el: ReactNode) => (
  <Suspense fallback={<SkeletonBlock rows={6} />}>{el}</Suspense>
);
const adminPage = (el: ReactNode) => page(<RequireAdmin>{el}</RequireAdmin>);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ToastProvider>
          <ConfirmProvider>
            <BrowserRouter>
              <AuthProvider>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route
                    element={
                      <RequireAuth>
                        <Layout />
                      </RequireAuth>
                    }
                  >
                    <Route index element={page(<DashboardPage />)} />
                    <Route path="moderation" element={page(<ModerationPage />)} />
                    <Route path="listings" element={page(<ListingsPage />)} />
                    <Route path="listings/:id" element={page(<ListingDetailPage />)} />
                    <Route path="users" element={page(<UsersPage />)} />
                    <Route path="users/:id" element={page(<UserDetailPage />)} />
                    <Route path="agencies" element={page(<AgenciesPage />)} />
                    <Route path="payments" element={page(<PaymentsPage />)} />
                    <Route path="bookings" element={page(<BookingsPage />)} />
                    <Route path="subscriptions" element={page(<SubscriptionsPage />)} />
                    <Route path="reports" element={page(<ReportsPage />)} />
                    <Route path="catalog" element={page(<CatalogPage />)} />
                    <Route path="settings" element={adminPage(<SettingsPage />)} />
                    <Route path="banners" element={page(<BannersPage />)} />
                    <Route path="pages" element={page(<CmsPagesPage />)} />
                    <Route path="pages/new" element={page(<CmsPageEditor />)} />
                    <Route path="pages/:slug" element={page(<CmsPageEditor />)} />
                    <Route path="mortgage" element={page(<MortgagePage />)} />
                    <Route path="broadcast" element={adminPage(<BroadcastPage />)} />
                    <Route path="audit" element={adminPage(<AuditPage />)} />
                    <Route path="*" element={page(<NotFoundPage />)} />
                  </Route>
                </Routes>
              </AuthProvider>
            </BrowserRouter>
          </ConfirmProvider>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
