import { redirect } from 'next/navigation';

export default async function AccountIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/account/listings`);
}
