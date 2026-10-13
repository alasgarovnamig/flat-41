import type { Metadata } from 'next';
import { PlansGrid } from '@/components/business/Plans';
import { Badge, Card } from '@/components/ds';
import { BuildingIcon, ChartIcon, PlusIcon, SparklesIcon } from '@/components/ds/icons';
import { toLocale } from '@/lib/i18n';
import { getT } from '@/lib/i18n.server';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = getT(toLocale((await params).locale));
  return { title: t('business.title'), description: t('business.subtitle') };
}

export default async function BusinessPage({ params }: Props) {
  const t = getT(toLocale((await params).locale));
  const faqs = [1, 2, 3, 4].map((i) => ({ q: t(`business.faq${i}q`), a: t(`business.faq${i}a`) }));
  const icons = [<SparklesIcon key="a" size={22} />, <ChartIcon key="b" size={22} />, <BuildingIcon key="c" size={22} />];
  const benefits = [1, 2, 3].map((i) => ({ title: t(`business.benefit${i}`), text: t(`business.benefit${i}Text`) }));
  return (
    <div>
      <section className="container-page pb-10 pt-10 text-center sm:pt-16">
        <Badge tone="glass" size="md" className="shadow-pill">
          <BuildingIcon size={14} /> {t('home.businessBadge')}
        </Badge>
        <h1 className="mx-auto mt-5 max-w-3xl font-display text-[40px] font-light leading-[1.05] tracking-[-1.4px] sm:text-[56px] sm:tracking-[-2px]">{t('business.title')}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-ink-secondary sm:text-[17px]">{t('business.subtitle')}</p>
      </section>
      <section className="container-page" aria-label={t('business.choosePlan')}>
        <PlansGrid />
      </section>
      <section className="container-page mt-12 grid gap-4 md:grid-cols-3">
        {benefits.map((b, i) => (
          <Card key={b.title} className="flex flex-col gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-sunken">{icons[i]}</span>
            <h2 className="text-h3">{b.title}</h2>
            <p className="text-label font-normal text-ink-secondary">{b.text}</p>
          </Card>
        ))}
      </section>
      <section className="container-page mt-12 max-w-3xl" aria-labelledby="faq-h">
        <h2 id="faq-h" className="mb-5 text-h1">
          {t('business.faq')}
        </h2>
        <div className="flex flex-col gap-2">
          {faqs.map((f) => (
            <details key={f.q} className="group rounded-lg bg-surface shadow-card">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 font-medium marker:hidden [&::-webkit-details-marker]:hidden">
                {f.q}
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-sunken transition-transform group-open:rotate-45" aria-hidden>
                  <PlusIcon size={16} />
                </span>
              </summary>
              <p className="px-5 pb-5 text-label font-normal text-ink-secondary">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
