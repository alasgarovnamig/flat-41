import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Eye, Lock, Save, Trash2 } from 'lucide-react';
import { LOCALES, cmsPageSchema, slugify, type Locale } from '@evtap/shared';
import * as api from '../api/client';
import { useAction } from '../api/queries';
import { useAuth } from '../auth/AuthContext';
import { FormField, Input, Textarea } from '../components/FormField';
import { useCrumb } from '../components/Layout';
import { useConfirm } from '../components/Modal';
import { Button, Card, EmptyState, ErrorState, PageHeader, SkeletonBlock, Tabs, cx } from '../components/ui';
import { useT } from '../i18n';
import { fmtDateTime } from '../lib/format';
import { renderMarkdown } from '../lib/markdown';

type Draft = { slug: string; title: Record<Locale, string>; body: Record<Locale, string> };
const empty = (): Draft => ({ slug: '', title: { az: '', ru: '', en: '' }, body: { az: '', ru: '', en: '' } });
const LANG_NAMES: Record<Locale, string> = { az: 'Azərbaycanca', ru: 'Русский', en: 'English' };

export default function CmsPageEditor() {
  const { slug } = useParams();
  const isNew = !slug;
  const { t } = useT();
  const nav = useNavigate();
  const { isAdmin } = useAuth();
  const { confirm } = useConfirm();
  // there is no GET /admin/pages/:slug — the list contains full pages
  const q = useQuery({ queryKey: ['admin', 'pages'], queryFn: api.listPages, enabled: !isNew });
  const page = useMemo(() => q.data?.find((p) => p.slug === slug), [q.data, slug]);
  useCrumb(isNew ? t('New page') : `/${slug}`);

  const [draft, setDraft] = useState<Draft>(empty);
  const [lang, setLang] = useState<Locale>('az');
  const [preview, setPreview] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => {
    if (page) setDraft({ slug: page.slug, title: { ...empty().title, ...page.title }, body: { ...empty().body, ...page.body } });
  }, [page]);

  const dirty = isNew ? !!(draft.slug || Object.values(draft.title).some(Boolean)) : !!page && JSON.stringify({ slug: page.slug, title: page.title, body: page.body }) !== JSON.stringify(draft);
  const save = useAction((d: Draft) => api.savePage(d.slug, d), {
    success: t('Page saved'),
    invalidate: [['admin', 'pages']],
    onSuccess: (p) => isNew && nav(`/pages/${p.slug}`, { replace: true }),
  });
  const remove = useAction(() => api.deletePage(slug!), { success: t('Page deleted'), invalidate: [['admin', 'pages']], onSuccess: () => nav('/pages') });

  const submit = () => {
    const parsed = cmsPageSchema.safeParse(draft);
    const errs: string[] = [];
    if (!parsed.success) for (const i of parsed.error.issues) errs.push(i.path.join('.') + ': ' + i.message);
    if (!draft.title.az.trim()) errs.push(t('Azerbaijani title is required (default language).'));
    setErrors(errs);
    if (!errs.length && parsed.success) save.mutate(parsed.data as Draft);
  };

  if (!isNew && q.isLoading)
    return (
      <Card>
        <SkeletonBlock rows={10} />
      </Card>
    );
  if (!isNew && q.error) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  if (!isNew && !page) return <Card><EmptyState title={t('Page not found')} hint={`/${slug}`} /></Card>;

  const readOnly = !isAdmin;
  return (
    <div>
      <PageHeader
        title={isNew ? t('New page') : draft.title.en || draft.title.az || slug}
        subtitle={page ? t('Last updated {d}', { d: fmtDateTime(page.updatedAt) }) : t('Create a static page in three languages')}
        actions={
          readOnly ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              <Lock className="size-3.5" /> {t('Read-only for moderators')}
            </span>
          ) : (
            <>
              {!isNew && (
                <Button
                  variant="danger-soft"
                  icon={<Trash2 className="size-4" />}
                  loading={remove.isPending}
                  onClick={async () => {
                    if (await confirm({ title: t('Delete page /{slug}?', { slug: slug! }), confirmLabel: t('Delete'), tone: 'danger' })) remove.mutate(undefined);
                  }}
                >
                  {t('Delete')}
                </Button>
              )}
              <Button variant="primary" icon={<Save className="size-4" />} disabled={!dirty} loading={save.isPending} onClick={submit}>
                {t('Save')}
              </Button>
            </>
          )
        }
      />
      {errors.length > 0 && (
        <div role="alert" className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto]">
          <FormField label={t('Slug (URL)')} hint={isNew ? t('Lowercase letters, digits and dashes, e.g. "terms"') : t('The slug of an existing page cannot be changed.')}>
            <Input value={draft.slug} disabled={!isNew || readOnly} onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} placeholder="about-us" />
          </FormField>
          {isNew && !readOnly && (
            <div className="flex items-end">
              <Button size="sm" variant="ghost" disabled={!draft.title.az && !draft.title.en} onClick={() => setDraft({ ...draft, slug: slugify(draft.title.en || draft.title.az) })}>
                {t('Generate from title')}
              </Button>
            </div>
          )}
        </div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Tabs
            value={lang}
            onChange={setLang}
            tabs={LOCALES.map((l) => ({ value: l, label: <span className="flex items-center gap-1.5">{l.toUpperCase()}<span className={cx('size-1.5 rounded-full', draft.title[l].trim() && draft.body[l].trim() ? 'bg-success' : 'bg-line-strong')} /></span> }))}
          />
          <Button size="sm" variant={preview ? 'primary' : 'secondary'} icon={<Eye className="size-3.5" />} onClick={() => setPreview((p) => !p)} className="xl:hidden">
            {t('Preview')}
          </Button>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <div className={cx('space-y-3', preview && 'hidden xl:block')}>
            <FormField label={`${t('Title')} · ${LANG_NAMES[lang]}`}>
              <Input value={draft.title[lang]} disabled={readOnly} onChange={(e) => setDraft({ ...draft, title: { ...draft.title, [lang]: e.target.value } })} />
            </FormField>
            <FormField label={`${t('Body (Markdown)')} · ${LANG_NAMES[lang]}`} hint={t('# Heading, **bold**, *italic*, - list, [link](https://…)')}>
              <Textarea rows={20} className="font-mono text-[13px]" value={draft.body[lang]} disabled={readOnly} onChange={(e) => setDraft({ ...draft, body: { ...draft.body, [lang]: e.target.value } })} />
            </FormField>
          </div>
          <div className={cx('min-w-0 rounded-lg border border-line p-4', !preview && 'hidden xl:block')}>
            <p className="mb-2 text-xs font-medium text-muted">{t('Preview')}</p>
            <h1 className="mb-2 text-2xl font-bold">{draft.title[lang] || <span className="text-muted">{t('Untitled')}</span>}</h1>
            <div className="prose-md text-sm" dangerouslySetInnerHTML={{ __html: renderMarkdown(draft.body[lang]) }} />
          </div>
        </div>
      </Card>
    </div>
  );
}
