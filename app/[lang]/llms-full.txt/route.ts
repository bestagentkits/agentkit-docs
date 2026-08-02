import { getLLMText, source } from '@/lib/source';
import { i18n } from '@/lib/i18n';
import { filterPublicDiscoveryPages } from '@/lib/public-discovery.mjs';

export const revalidate = false;

export async function GET(
  _req: Request,
  { params }: RouteContext<'/[lang]/llms-full.txt'>,
) {
  const { lang } = await params;
  const scan = filterPublicDiscoveryPages(source.getPages(lang)).map(getLLMText);
  const scanned = await Promise.all(scan);

  return new Response(scanned.join('\n\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export function generateStaticParams() {
  return i18n.languages.map((lang) => ({ lang }));
}
