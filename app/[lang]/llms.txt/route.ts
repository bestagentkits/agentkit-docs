import { source } from '@/lib/source';
import { i18n } from '@/lib/i18n';
import { llms } from 'fumadocs-core/source';

export const revalidate = false;

export async function GET(
  _req: Request,
  { params }: RouteContext<'/[lang]/llms.txt'>,
) {
  const { lang } = await params;
  return new Response(llms(source).index(lang), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export function generateStaticParams() {
  return i18n.languages.map((lang) => ({ lang }));
}
