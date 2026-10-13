'use client';

import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/providers/I18nProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Button, Img } from '@/components/ds';
import { ChevronLeft, ChevronRight, TrashIcon, UploadIcon } from '@/components/ds/icons';

export interface Photo {
  key: string;
  id?: string; // upload id once uploaded
  url: string; // remote url or local blob preview
  thumbUrl?: string;
  progress?: number; // 0..100 while uploading
  error?: string;
}

const MAX_FILES = 30;
const MAX_SIZE = 10 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function PhotoUploader({ photos, onChange, error }: { photos: Photo[]; onChange: (fn: (prev: Photo[]) => Photo[]) => void; error?: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);

  const update = (key: string, patch: Partial<Photo>) => onChange((l) => l.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const addFiles = (files: FileList | File[]) => {
    const list = Array.from(files);
    const room = MAX_FILES - photos.length;
    if (room <= 0) return toast.error(t('wizard.photos.max', { n: MAX_FILES }));
    const accepted: { file: File; key: string }[] = [];
    for (const f of list.slice(0, room)) {
      if (!TYPES.includes(f.type)) {
        toast.error(t('errors.UNSUPPORTED_FILE_TYPE'));
        continue;
      }
      if (f.size > MAX_SIZE) {
        toast.error(t('errors.FILE_TOO_LARGE'));
        continue;
      }
      accepted.push({ file: f, key: `${Date.now()}-${Math.random().toString(36).slice(2)}` });
    }
    if (list.length > room) toast.error(t('wizard.photos.max', { n: MAX_FILES }));
    onChange((l) => [...l, ...accepted.map(({ file, key }) => ({ key, url: URL.createObjectURL(file), progress: 0 }))]);
    for (const { file, key } of accepted) {
      api
        .upload(file, (pct) => update(key, { progress: pct }))
        .then((u) => update(key, { id: u.id, url: u.url, thumbUrl: u.thumbUrl, progress: undefined, error: undefined }))
        .catch((e) => update(key, { progress: undefined, error: errorMessage(e, t) }));
    }
  };

  const move = (from: number, to: number) =>
    onChange((l) => {
      if (to < 0 || to >= l.length) return l;
      const c = [...l];
      const [x] = c.splice(from, 1);
      c.splice(to, 0, x!);
      return c;
    });

  return (
    <div>
      <div
        onDragOver={(e) => {
          if (dragKey) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          if (dragKey) return;
          e.preventDefault();
          setOver(false);
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
        className={cn('flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors', over ? 'border-ink bg-surface-sunken' : error ? 'border-danger bg-danger-bg/40' : 'border-subtle bg-surface-raised')}
      >
        <div className="flex h-18 w-18 items-center justify-center rounded-full bg-surface-sunken text-ink">
          <UploadIcon size={28} />
        </div>
        <p className="mt-4 text-h3">{t('wizard.photos.drop')}</p>
        <p className="mt-1 text-label font-normal text-ink-secondary">{t('wizard.photos.hint', { n: MAX_FILES })}</p>
        <Button className="mt-5" icon={<UploadIcon size={18} />} onClick={() => input.current?.click()}>
          {t('wizard.photos.choose')}
        </Button>
        <input
          ref={input}
          type="file"
          accept={TYPES.join(',')}
          multiple
          className="sr-only"
          aria-label={t('wizard.photos.choose')}
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {error && <p className="mt-2 text-caption font-medium text-danger" role="alert">{error}</p>}

      {photos.length > 0 && (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((p, i) => (
            <li
              key={p.key}
              draggable
              onDragStart={() => setDragKey(p.key)}
              onDragEnd={() => setDragKey(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!dragKey || dragKey === p.key) return;
                const from = photos.findIndex((x) => x.key === dragKey);
                move(from, i);
                setDragKey(null);
              }}
              className={cn('group relative aspect-[4/3] cursor-grab overflow-hidden rounded-lg bg-surface-sunken shadow-pill', dragKey === p.key ? 'opacity-40' : '', i === 0 && 'ring-2 ring-ink', p.error && 'ring-2 ring-danger')}
            >
              <Img src={p.thumbUrl || p.url} alt={t('wizard.photos.photoN', { n: i + 1 })} fill sizes="200px" className="object-cover" />
              {i === 0 && <span className="absolute left-2 top-2 rounded-pill bg-ink px-2.5 py-1 text-[11px] font-medium text-on-ink">{t('wizard.photos.cover')}</span>}
              {p.progress !== undefined && (
                <div className="glass absolute inset-0 flex flex-col items-center justify-center text-ink">
                  <span className="tabular text-label font-medium">{p.progress}%</span>
                  <div className="mt-2 h-1.5 w-2/3 overflow-hidden rounded-full bg-pill">
                    <div className="h-full bg-ink transition-all" style={{ width: `${p.progress}%` }} />
                  </div>
                </div>
              )}
              {p.error && <div className="absolute inset-x-2 bottom-2 rounded-md bg-danger-bg px-2 py-1 text-[11px] font-medium text-danger">{p.error}</div>}
              <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={t('wizard.photos.left')} className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-raised shadow-pill disabled:opacity-40">
                  <ChevronLeft size={16} />
                </button>
                <button type="button" onClick={() => move(i, i + 1)} disabled={i === photos.length - 1} aria-label={t('wizard.photos.right')} className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-raised shadow-pill disabled:opacity-40">
                  <ChevronRight size={16} />
                </button>
                <button type="button" onClick={() => onChange((l) => l.filter((x) => x.key !== p.key))} aria-label={t('common.delete')} className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-raised shadow-pill disabled:opacity-40 text-danger">
                  <TrashIcon size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
