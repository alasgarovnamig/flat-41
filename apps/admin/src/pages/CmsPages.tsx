import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { LOCALES, type CmsPage } from '@evtap/shared';
import * as api from '../api/client';
import { useAction } from '../api/queries';
import { AdminOnly } from '../auth/guards';
import { DataTable, type Column } from '../components/DataTable';
import { useConfirm } from '../components/Modal';
import { Badge } from '../components/StatusBadge';
import { Button, PageHeader } from '../components/ui';
import { WEB_URL } from '../env';
import { useT } from '../i18n';
import { fmtDateTime } from '../lib/format';

export default function CmsPagesPage() {
  const { t } = useT();
  const nav = useNavigate();
  const { confirm } = useConfirm();
  const q = useQuery({ queryKey: ['admin', 'pages'], queryFn: api.listPages });
  const remove = useAction((slug: string) => api.deletePage(slug), { success: t('Page deleted'), invalidate: [['admin', 'pages']] });

  const columns: Column<CmsPage>[] = [
    {
      key: 'title',
      header: t('Page'),
      sortValue: (p) => p.title.az || p.title.en,
      render: (p) => (
        <div className="min-w-[200px]">
          <p className="font-medium">{p.title.en || p.title.az || p.slug}</p>
          <p className="text-xs text-muted">/{p.slug}</p>
        </div>
      ),
    },
    {
      key: 'langs',
      header: t('Translations'),
      render: (p) => (
        <span className="flex gap-1">
          {LOCALES.map((l) => (
            <Badge key={l} tone={p.title[l]?.trim() && p.body[l]?.trim() ? 'success' : 'neutral'}>
              {l.toUpperCase()}
            </Badge>
          ))}
        </span>
      ),
    },
    { key: 'updated', header: t('Updated'), sortValue: (p) => p.updatedAt, render: (p) => <span className="whitespace-nowrap">{fmtDateTime(p.updatedAt)}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (p) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <a href={`${WEB_URL}/az/pages/${p.slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-hover" aria-label={t('View on site')}>
            <ExternalLink className="size-4" />
          </a>
          <AdminOnly>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t('Delete')}
              onClick={async () => {
                if (await confirm({ title: t('Delete page /{slug}?', { slug: p.slug }), message: t('The page disappears from the site in all languages.'), confirmLabel: t('Delete'), tone: 'danger' })) remove.mutate(p.slug);
              }}
            >
              <Trash2 className="size-4 text-danger" />
            </Button>
          </AdminOnly>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('CMS pages')}
        subtitle={t('Static pages: about, terms, privacy, help…')}
        actions={
          <AdminOnly>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => nav('/pages/new')}>
              {t('New page')}
            </Button>
          </AdminOnly>
        }
      />
      <DataTable columns={columns} rows={q.data} rowKey={(p) => p.slug} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} onRowClick={(p) => nav(`/pages/${p.slug}`)} />
    </div>
  );
}
