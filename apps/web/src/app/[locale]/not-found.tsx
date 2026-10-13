'use client';

import { HouseIllustration, LinkButton } from '@/components/ds';
import { ArrowUpRightIcon, SearchIcon } from '@/components/ds/icons';
import { useI18n } from '@/components/providers/I18nProvider';

export default function NotFound() {
  const { t, href } = useI18n();
  return (
    <div className="container-page flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
      <HouseIllustration className="w-full max-w-sm opacity-90" />
      <div className="-mt-2 font-display text-[96px] font-light leading-none tracking-[-4px] text-ink">404</div>
      <h1 className="mt-4 text-h2">{t('notFound.title')}</h1>
      <p className="mt-2 max-w-md text-ink-secondary">{t('notFound.text')}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <LinkButton href={href('/')} trailing={<ArrowUpRightIcon size={16} />}>
          {t('notFound.home')}
        </LinkButton>
        <LinkButton href={href('/search')} variant="secondary" icon={<SearchIcon size={18} />}>
          {t('notFound.search')}
        </LinkButton>
      </div>
    </div>
  );
}
