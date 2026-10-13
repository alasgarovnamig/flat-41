import type { Metadata } from 'next';
import { PlansGrid } from '@/components/business/Plans';
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
  const benefits = [1, 2, 3].map((i) => ({ title: t(`business.benefit${i}`), text: t(`business.benefit${i}Text`) }));
  return (
    <div>
      <section className="bg-gradient-to-b from-brand-50 to-surface py-12 sm:py-16">
        <div className="container-page text-center">
          <span className="text-sm font-semibold uppercase tracking-wide text-brand">{t('home.businessBadge')}</span>
          <h1 className="mx-auto mt-2 max-w-3xl text-3xl font-extrabold tracking-tight sm:text-5xl">{t('business.title')}</h1>
          <p className="mx-auto mt-3 max-w-2xl text-muted sm:text-lg">{t('business.subtitle')}</p>
        </div>
      </section>
      <section className="container-page -mt-4">
        <PlansGrid />
      </section>
      <section className="container-page mt-14 grid gap-4 md:grid-cols-3">
        {benefits.map((b) => (
          <div key={b.title} className="rounded-card border border-line bg-white p-5">
            <h2 className="font-semibold">{b.title}</h2>
            <p className="mt-1 text-sm text-muted">{b.text}</p>
          </div>
        ))}
      </section>
      <section className="container-page mt-14 max-w-3xl">
        <h2 className="mb-4 text-2xl font-bold">{t('business.faq')}</h2>
        <div className="divide-y divide-line rounded-card border border-line bg-white">
          {faqs.map((f) => (
            <details key={f.q} className="group p-5">
              <summary className="cursor-pointer list-none font-semibold marker:hidden">
                <span className="flex items-center justify-between gap-3">
                  {f.q}
                  <span className="text-muted transition group-open:rotate-45">+</span>
                </span>
              </summary>
              <p className="mt-2 text-sm text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
