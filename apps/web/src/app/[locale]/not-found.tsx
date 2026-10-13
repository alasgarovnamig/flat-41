'use client';

import { useI18n } from '@/components/providers/I18nProvider';
import { LinkButton } from '@/components/ui/Button';
import { SearchIcon } from '@/components/ui/icons';

export default function NotFound() {
  const { t, href } = useI18n();
  return (
    <div className="container-page flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
      <div className="text-7xl font-black tracking-tight text-brand/90">404</div>
      <h1 className="mt-4 text-2xl font-bold">{t('notFound.title')}</h1>
      <p className="mt-2 max-w-md text-muted">{t('notFound.text')}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <LinkButton href={href('/')}>{t('notFound.home')}</LinkButton>
        <LinkButton href={href('/search')} variant="outline" icon={<SearchIcon size={18} />}>
          {t('notFound.search')}
        </LinkButton>
      </div>
    </div>
  );
}
