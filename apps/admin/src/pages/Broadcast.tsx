import { useState } from 'react';
import { Bell, Megaphone, Send } from 'lucide-react';
import { broadcastSchema } from '@evtap/shared';
import * as api from '../api/client';
import type { BroadcastAudience } from '../api/client';
import { useAction, useOverview } from '../api/queries';
import { FormField, Input, Textarea } from '../components/FormField';
import { useConfirm } from '../components/Modal';
import { Button, Card, PageHeader, cx } from '../components/ui';
import { useT } from '../i18n';
import { fmtDateTime, fmtNumber } from '../lib/format';

type Sent = { title: string; audience: BroadcastAudience; sent: number; at: string };

export default function BroadcastPage() {
  const { t } = useT();
  const { confirm } = useConfirm();
  const overview = useOverview();
  const [form, setForm] = useState<{ title: string; body: string; audience: BroadcastAudience }>({ title: '', body: '', audience: 'ALL' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Sent[]>([]);

  const audiences: { value: BroadcastAudience; label: string; hint: string; count?: number }[] = [
    { value: 'ALL', label: t('Everyone'), hint: t('All active users'), count: overview.data?.users.total },
    { value: 'INDIVIDUAL', label: t('Individuals'), hint: t('Private owners & seekers'), count: overview.data ? overview.data.users.total - overview.data.users.business : undefined },
    { value: 'BUSINESS', label: t('Business'), hint: t('Agencies & developers'), count: overview.data?.users.business },
  ];

  const send = useAction(api.broadcast, {
    success: (r) => t('Sent to {n} users', { n: fmtNumber(r.sent) }),
    onSuccess: (r, v) => {
      setHistory((h) => [{ title: v.title, audience: v.audience, sent: r.sent, at: new Date().toISOString() }, ...h]);
      setForm((f) => ({ ...f, title: '', body: '' }));
    },
  });

  const submit = async () => {
    const parsed = broadcastSchema.safeParse(form);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0])] = i.message;
      return setErrors(errs);
    }
    setErrors({});
    const aud = audiences.find((a) => a.value === form.audience)!;
    const ok = await confirm({
      title: t('Send to {a}?', { a: aud.label.toLowerCase() }),
      message: aud.count != null ? t('About {n} users will receive an in-app and push notification. This cannot be undone.', { n: fmtNumber(aud.count) }) : t('All matching users will receive an in-app and push notification. This cannot be undone.'),
      confirmLabel: t('Send now'),
    });
    if (ok) send.mutate(parsed.data);
  };

  return (
    <div>
      <PageHeader title={t('Broadcast notification')} subtitle={t('Push + in-app notification to a user segment')} />
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted">{t('Audience')}</p>
              <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
                {audiences.map((a) => (
                  <button
                    key={a.value}
                    role="radio"
                    aria-checked={form.audience === a.value}
                    onClick={() => setForm({ ...form, audience: a.value })}
                    className={cx('rounded-lg border p-3 text-left', form.audience === a.value ? 'border-brand bg-brand-soft' : 'border-line hover:bg-hover')}
                  >
                    <p className="font-medium">{a.label}</p>
                    <p className="text-xs text-muted">{a.hint}</p>
                    {a.count != null && <p className="mt-1 text-xs font-medium tabular-nums">≈ {fmtNumber(a.count)}</p>}
                  </button>
                ))}
              </div>
            </div>
            <FormField label={t('Title')} error={errors.title} hint={`${form.title.length}/120`}>
              <Input value={form.title} maxLength={120} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t('e.g. New: online booking for daily rentals')} />
            </FormField>
            <FormField label={t('Message')} error={errors.body} hint={`${form.body.length}/1000`}>
              <Textarea rows={5} value={form.body} maxLength={1000} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            </FormField>
            <div className="flex justify-end">
              <Button variant="primary" icon={<Send className="size-4" />} loading={send.isPending} onClick={submit}>
                {t('Send broadcast')}
              </Button>
            </div>
          </div>
        </Card>
        <div className="space-y-4">
          <Card title={t('Preview')}>
            <div className="flex gap-3 rounded-xl bg-hover p-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand text-white">
                <Bell className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="flex justify-between gap-2 text-xs text-muted">
                  <span>EvTap</span>
                  <span>{t('now')}</span>
                </p>
                <p className="truncate font-semibold">{form.title || t('Notification title')}</p>
                <p className="line-clamp-3 text-sm text-muted">{form.body || t('Message text appears here.')}</p>
              </div>
            </div>
          </Card>
          {history.length > 0 && (
            <Card title={t('Sent this session')}>
              <ul className="space-y-2 text-sm">
                {history.map((h, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Megaphone className="mt-0.5 size-4 shrink-0 text-brand-fg" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{h.title}</span>
                      <span className="text-xs text-muted">
                        {h.audience} · {t('{n} recipients', { n: fmtNumber(h.sent) })} · {fmtDateTime(h.at)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
