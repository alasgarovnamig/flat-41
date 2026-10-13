'use client';

import { usePathname, useRouter } from 'next/navigation';
import { LOCALES, type Locale } from '@evtap/shared';
import { LOCALE_NAMES, LOCALE_SHORT, switchLocalePath } from '@/lib/i18n';
import { useTheme, type ThemePref } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { Popover, Segmented, iconButtonClass } from '@/components/ds';
import { CheckIcon, MonitorIcon, MoonIcon, SettingsIcon, SunIcon } from '@/components/ds/icons';
import { useI18n } from '@/components/providers/I18nProvider';

export function useSwitchLocale() {
  const pathname = usePathname();
  const router = useRouter();
  return (l: Locale) => {
    document.cookie = `NEXT_LOCALE=${l}; path=/; max-age=31536000; samesite=lax`;
    const qs = window.location.search.replace(/^\?/, '');
    router.push(switchLocalePath(pathname, l) + (qs ? `?${qs}` : ''));
  };
}

/** Language pills (AZ / RU / EN). */
export function LanguageOptions({ onDone }: { onDone?: () => void }) {
  const { locale, t } = useI18n();
  const go = useSwitchLocale();
  return (
    <div role="radiogroup" aria-label={t('header.language')} className="flex flex-col">
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={l === locale}
          onClick={() => {
            onDone?.();
            if (l !== locale) go(l);
          }}
          className={cn('flex min-h-11 items-center justify-between gap-3 rounded-md px-3 text-[14px] hover:bg-surface-sunken', l === locale && 'font-medium')}
        >
          <span className="flex items-center gap-3">
            <span className="flex h-7 w-9 items-center justify-center rounded-pill bg-pill text-[11px] font-semibold">{LOCALE_SHORT[l]}</span>
            {LOCALE_NAMES[l]}
          </span>
          {l === locale && <CheckIcon size={16} />}
        </button>
      ))}
    </div>
  );
}

export function ThemeOptions() {
  const { t } = useI18n();
  const { pref, setPref } = useTheme();
  return (
    <Segmented<ThemePref>
      block
      ariaLabel={t('theme.title')}
      value={pref}
      onChange={setPref}
      options={[
        { value: 'light', label: <><SunIcon size={15} /> {t('theme.light')}</> },
        { value: 'dark', label: <><MoonIcon size={15} /> {t('theme.dark')}</> },
        { value: 'system', label: <><MonitorIcon size={15} /> {t('theme.system')}</> },
      ]}
      size="sm"
    />
  );
}

/** Settings icon button → popover with language + theme. */
export function SettingsMenu() {
  const { t } = useI18n();
  return (
    <Popover
      align="right"
      width="w-80"
      panelClassName="p-3"
      trigger={({ open, toggle, id }) => (
        <button type="button" onClick={toggle} aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog" aria-label={t('settings.title')} title={t('settings.title')} className={iconButtonClass('sunken')}>
          <SettingsIcon size={20} />
        </button>
      )}
    >
      {(close) => (
        <div className="flex flex-col gap-3">
          <div>
            <div className="mb-2 px-1 text-caption text-muted">{t('theme.title')}</div>
            <ThemeOptions />
          </div>
          <div>
            <div className="mb-1 px-1 text-caption text-muted">{t('header.language')}</div>
            <LanguageOptions onDone={close} />
          </div>
        </div>
      )}
    </Popover>
  );
}
