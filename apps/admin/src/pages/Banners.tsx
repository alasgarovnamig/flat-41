import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, ImageOff, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { BANNER_PLACEMENTS, bannerSchema, type Banner, type BannerInput } from '@evtap/shared';
import * as api from '../api/client';
import { useAction } from '../api/queries';
import { useAuth } from '../auth/AuthContext';
import { AdminOnly } from '../auth/guards';
import { DataTable, type Column } from '../components/DataTable';
import { FormField, Input, Select, Toggle } from '../components/FormField';
import { Modal, useConfirm } from '../components/Modal';
import { useToast } from '../components/Toast';
import { Badge } from '../components/StatusBadge';
import { Button, PageHeader, Tabs } from '../components/ui';
import { useT } from '../i18n';
import { ctr, enumLabel, fmtDate, fmtNumber, fmtPercent } from '../lib/format';

const pad = (n: number) => String(n).padStart(2, '0');
const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

export default function BannersPage() {
  const { t } = useT();
  const { isAdmin } = useAuth();
  const { confirm } = useConfirm();
  const [placement, setPlacement] = useState<string>('ALL');
  const [editing, setEditing] = useState<Banner | 'new' | null>(null);
  const q = useQuery({ queryKey: ['admin', 'banners'], queryFn: api.listBanners });
  const rows = (q.data ?? []).filter((b) => placement === 'ALL' || b.placement === placement).sort((a, b) => a.placement.localeCompare(b.placement) || a.sortOrder - b.sortOrder);

  const toggle = useAction((b: Banner) => api.updateBanner(b.id, { active: !b.active }), { success: t('Banner updated'), invalidate: [['admin', 'banners']] });
  const remove = useAction((id: string) => api.deleteBanner(id), { success: t('Banner deleted'), invalidate: [['admin', 'banners']] });

  const columns: Column<Banner>[] = [
    {
      key: 'banner',
      header: t('Banner'),
      sortValue: (b) => b.title,
      render: (b) => (
        <div className="flex min-w-[240px] items-center gap-3">
          <BannerPreview url={b.imageUrl} className="h-12 w-24" />
          <div className="min-w-0">
            <p className="truncate font-medium">{b.title}</p>
            <a href={b.linkUrl} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-[220px] items-center gap-1 truncate text-xs text-muted hover:underline">
              {b.linkUrl.replace(/^https?:\/\//, '')} <ExternalLink className="size-3 shrink-0" />
            </a>
          </div>
        </div>
      ),
    },
    { key: 'placement', header: t('Placement'), sortValue: (b) => b.placement, render: (b) => <Badge tone="brand">{enumLabel(b.placement)}</Badge> },
    { key: 'dates', header: t('Schedule'), hideBelow: 'lg', render: (b) => <span className="text-xs whitespace-nowrap">{b.startsAt || b.endsAt ? `${fmtDate(b.startsAt)} – ${fmtDate(b.endsAt)}` : t('Always')}</span> },
    { key: 'sort', header: t('Sort'), align: 'right', hideBelow: 'md', sortValue: (b) => b.sortOrder, render: (b) => b.sortOrder },
    { key: 'imp', header: t('Impressions'), align: 'right', sortValue: (b) => b.impressions, render: (b) => fmtNumber(b.impressions) },
    { key: 'clicks', header: t('Clicks'), align: 'right', hideBelow: 'md', sortValue: (b) => b.clicks, render: (b) => fmtNumber(b.clicks) },
    { key: 'ctr', header: 'CTR', align: 'right', sortValue: (b) => ctr(b.clicks, b.impressions) ?? -1, render: (b) => fmtPercent(ctr(b.clicks, b.impressions), 2) },
    {
      key: 'active',
      header: t('Active'),
      render: (b) => <Toggle checked={b.active} disabled={!isAdmin || (toggle.isPending && toggle.variables?.id === b.id)} onChange={() => toggle.mutate(b)} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (b) => (
        <AdminOnly>
          <div className="flex justify-end gap-1">
            <Button size="icon" variant="ghost" aria-label={t('Edit')} onClick={() => setEditing(b)}>
              <Pencil className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t('Delete')}
              onClick={async () => {
                if (await confirm({ title: t('Delete banner "{t}"?', { t: b.title }), message: t('Statistics for this banner will be lost.'), confirmLabel: t('Delete'), tone: 'danger' })) remove.mutate(b.id);
              }}
            >
              <Trash2 className="size-4 text-danger" />
            </Button>
          </div>
        </AdminOnly>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('Banners')}
        subtitle={t('Advertising slots on web and mobile. Impressions are counted when a banner is served.')}
        actions={
          <AdminOnly>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              {t('New banner')}
            </Button>
          </AdminOnly>
        }
      />
      <div className="mb-4 overflow-x-auto">
        <Tabs value={placement} onChange={setPlacement} tabs={[{ value: 'ALL', label: t('All') }, ...BANNER_PLACEMENTS.map((p) => ({ value: p, label: enumLabel(p), count: q.data?.filter((b) => b.placement === p).length }))]} />
      </div>
      <DataTable columns={columns} rows={q.data ? rows : undefined} rowKey={(b) => b.id} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} />
      <BannerModal banner={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function BannerPreview({ url, className }: { url: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  if (!url || broken)
    return (
      <span className={`inline-flex items-center justify-center rounded-md bg-hover text-muted ${className}`}>
        <ImageOff className="size-4" />
      </span>
    );
  return <img src={url} alt="" onError={() => setBroken(true)} className={`shrink-0 rounded-md bg-hover object-cover ${className}`} />;
}

const EMPTY = { placement: 'HOME_TOP', title: '', imageUrl: '', linkUrl: '', active: true, startsAt: '', endsAt: '', sortOrder: '0' };

function BannerModal({ banner, onClose }: { banner: Banner | 'new' | null; onClose: () => void }) {
  const { t } = useT();
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const isNew = banner === 'new';
  useEffect(() => {
    setErrors({});
    if (!banner) return;
    setForm(
      banner === 'new'
        ? EMPTY
        : { placement: banner.placement, title: banner.title, imageUrl: banner.imageUrl, linkUrl: banner.linkUrl, active: banner.active, startsAt: toLocalInput(banner.startsAt), endsAt: toLocalInput(banner.endsAt), sortOrder: String(banner.sortOrder) },
    );
  }, [banner]);

  const save = useAction((body: BannerInput) => (isNew ? api.createBanner(body) : api.updateBanner((banner as Banner).id, body)), {
    success: isNew ? t('Banner created') : t('Banner saved'),
    invalidate: [['admin', 'banners']],
    onSuccess: onClose,
  });

  const submit = () => {
    const parsed = bannerSchema.safeParse({ ...form, startsAt: fromLocalInput(form.startsAt), endsAt: fromLocalInput(form.endsAt), sortOrder: Number(form.sortOrder) || 0 });
    const errs: Record<string, string> = {};
    if (!parsed.success) for (const i of parsed.error.issues) errs[String(i.path[0])] = i.path[0] === 'imageUrl' || i.path[0] === 'linkUrl' ? t('Enter a full URL (https://…)') : i.message;
    if (form.startsAt && form.endsAt && form.endsAt <= form.startsAt) errs.endsAt = t('End must be after start');
    setErrors(errs);
    if (parsed.success && !Object.keys(errs).length) save.mutate(parsed.data);
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const up = await api.uploadFile(file);
      setForm((f) => ({ ...f, imageUrl: up.url }));
    } catch (e) {
      toast.error(e);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal
      open={!!banner}
      onClose={onClose}
      size="lg"
      title={isNew ? t('New banner') : t('Edit banner')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            {isNew ? t('Create') : t('Save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <FormField label={t('Title')} error={errors.title}>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={120} />
          </FormField>
          <FormField label={t('Placement')} error={errors.placement}>
            <Select value={form.placement} onChange={(e) => setForm({ ...form, placement: e.target.value })} options={BANNER_PLACEMENTS.map((p) => ({ value: p, label: enumLabel(p) }))} />
          </FormField>
          <FormField label={t('Link URL')} error={errors.linkUrl}>
            <Input value={form.linkUrl} onChange={(e) => setForm({ ...form, linkUrl: e.target.value })} placeholder="https://" />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t('Starts')} error={errors.startsAt}>
              <Input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
            </FormField>
            <FormField label={t('Ends')} error={errors.endsAt}>
              <Input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
            </FormField>
          </div>
          <div className="flex items-end gap-4">
            <FormField label={t('Sort order')} className="w-28">
              <Input inputMode="numeric" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value.replace(/[^\d-]/g, '') })} />
            </FormField>
            <div className="pb-2">
              <Toggle checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label={t('Active')} />
            </div>
          </div>
        </div>
        <div className="space-y-3">
          <FormField label={t('Image URL')} error={errors.imageUrl}>
            <div className="flex gap-2">
              <Input value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://" />
              <Button icon={<Upload className="size-4" />} loading={uploading} onClick={() => fileRef.current?.click()}>
                {t('Upload')}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                  e.target.value = '';
                }}
              />
            </div>
          </FormField>
          <div>
            <p className="mb-1 text-xs font-medium text-muted">{t('Preview')}</p>
            <BannerPreview url={form.imageUrl} className="aspect-[3/1] w-full" />
          </div>
        </div>
      </div>
    </Modal>
  );
}
