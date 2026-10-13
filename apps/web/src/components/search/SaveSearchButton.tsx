'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { getCity, localized } from '@evtap/shared';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { stateToQuery, type SearchState } from '@/lib/search-state';
import { Button, Input, Modal, Toggle } from '@/components/ds';
import { BookmarkIcon } from '@/components/ds/icons';
import { useAuthGate } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { useToast } from '@/components/providers/ToastProvider';

export function useSearchTitle() {
  const { t, locale } = useI18n();
  return (s: SearchState) => {
    const deal = s.dealType ? t(`enums.dealType.${s.dealType}`) : t('search.allListings');
    const type = s.propertyType?.length === 1 ? t(`enums.propertyType.${s.propertyType[0]}`) : '';
    const city = s.cityId ? localized(getCity(s.cityId)?.name, locale) : '';
    return [deal, type && type.toLowerCase(), city && `· ${city}`].filter(Boolean).join(' ');
  };
}

export function SaveSearchButton({ state }: { state: SearchState }) {
  const { t } = useI18n();
  const gate = useAuthGate();
  const toast = useToast();
  const qc = useQueryClient();
  const title = useSearchTitle();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [notify, setNotify] = useState(true);
  const save = useMutation({
    mutationFn: () => {
      const { page: _p, pageSize: _ps, sort: _s, ...rest } = stateToQuery(state);
      void _p; void _ps; void _s;
      return api.savedSearches.create({ name: name.trim() || title(state), query: rest, notify });
    },
    onSuccess: () => {
      toast.success(t('search.savedOk'));
      setOpen(false);
      void qc.invalidateQueries({ queryKey: qk.savedSearches });
    },
  });
  return (
    <>
      <Button
        variant="secondary"
        aria-label={t('search.saveSearch')}
        title={t('search.saveSearch')}
        icon={<BookmarkIcon size={18} />}
        className="px-3.5 xl:px-5"
        onClick={() =>
          gate(() => {
            setName(title(state));
            setOpen(true);
          })
        }
      >
        <span className="hidden xl:inline">{t('search.saveSearch')}</span>
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('search.saveSearch')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Input label={t('search.saveSearchName')} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} data-autofocus />
          <Toggle checked={notify} onChange={setNotify} label={t('search.notifyNew')} />
        </div>
      </Modal>
    </>
  );
}
