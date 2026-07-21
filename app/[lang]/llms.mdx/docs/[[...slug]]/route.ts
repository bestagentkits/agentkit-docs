import { getLLMText, getPageMarkdownUrl, source } from '@/lib/source';
import { i18n } from '@/lib/i18n';
import { notFound } from 'next/navigation';

export const revalidate = false;

export async function GET(
  _req: Request,
  { params }: RouteContext<'/[lang]/llms.mdx/docs/[[...slug]]'>,
) {
  const { lang, slug } = await params;
  // remove the appended "content.md"
  const page = source.getPage(slug?.slice(0, -1), lang);
  if (!page) notFound();

  return new Response(await getLLMText(page), {
    headers: {
      'Content-Type': 'text/markdown',
    },
  });
}

export function generateStaticParams() {
  return i18n.languages.flatMap((lang) =>
    source.getPages(lang).map((page) => ({
      lang,
      slug: getPageMarkdownUrl(page).segments,
    })),
  );
}
