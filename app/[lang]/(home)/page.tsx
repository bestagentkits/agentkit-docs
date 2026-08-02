import { i18n } from '@/lib/i18n';
import { localePath } from '@/lib/locale-path';
import { redirect } from 'next/navigation';

export function generateStaticParams() {
  return i18n.languages.map((lang) => ({ lang }));
}

export default async function LocaleRootRedirect({
  params,
}: PageProps<'/[lang]'>) {
  const { lang } = await params;
  redirect(localePath(lang, 'stable'));
}
