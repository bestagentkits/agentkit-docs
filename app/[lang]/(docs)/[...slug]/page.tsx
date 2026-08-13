import { getPageImage, getPageMarkdownUrl, source } from '@/lib/source';
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from 'fumadocs-ui/layouts/docs/page';
import { getBreadcrumbItems } from 'fumadocs-core/breadcrumb';
import { notFound, redirect } from 'next/navigation';
import { getMDXComponents } from '@/components/mdx';
import { BetaBanner } from '@/components/beta-banner';
import { channelFromSlug } from '@/lib/channels';
import { i18n } from '@/lib/i18n';
import { localePath } from '@/lib/locale-path';
import type { Metadata } from 'next';
import { createDocsRelativeLink } from '@/lib/docs-relative-link';
import { docsPageMetadata } from '@/lib/metadata';
import { gitConfig } from '@/lib/shared';

const channels = ['stable', 'beta'] as const;

function isLegacyCliRoot(slug: string[] | undefined): boolean {
  return (
    slug?.length === 4 &&
    (slug[0] === 'stable' || slug[0] === 'beta') &&
    slug[1] === 'reference' &&
    slug[2] === 'cli' &&
    slug[3] === 'ak'
  );
}

function canonicalPageSlug(slug: string[] | undefined): string[] | undefined {
  return isLegacyCliRoot(slug) ? slug?.slice(0, -1) : slug;
}

export default async function Page(props: PageProps<'/[lang]/[...slug]'>) {
  const params = await props.params;
  if (isLegacyCliRoot(params.slug)) {
    redirect(localePath(params.lang, ...(params.slug?.slice(0, -1) ?? [])));
  }

  const page = source.getPage(params.slug, params.lang);
  if (!page) notFound();

  const MDX = page.data.body;
  const markdownUrl = getPageMarkdownUrl(page).url;

  // Eyebrow = the page's parent section label (e.g. "Getting started"), matching
  // the approved design. Root folders (the Stable/Beta channel tabs) and the page
  // itself are excluded, so the last remaining breadcrumb item is the section.
  const breadcrumb = getBreadcrumbItems(page.url, source.getPageTree(params.lang));
  const eyebrow = breadcrumb.at(-1)?.name;

  const channel = channelFromSlug(params.slug);
  const stableRouteExists = channel === 'beta' && params.slug
    ? source.getPage(['stable', ...params.slug.slice(1)], params.lang) !== undefined
    : false;

  return (
    <main className="contents">
      <DocsPage
        toc={page.data.toc}
        full={page.data.full}
        // Section label is the custom mono eyebrow below; Fumadocs breadcrumb
        // would repeat the same parent folder name (e.g. "Bắt đầu" twice).
        breadcrumb={{ enabled: false }}
      >
        {channel === 'beta' && (
          <BetaBanner
            locale={params.lang}
            slug={params.slug ?? []}
            stableRouteExists={stableRouteExists}
          />
        )}
        {eyebrow && (
          <p className="mb-3 font-mono text-xs font-medium uppercase tracking-[0.09em] text-fd-primary">
            {eyebrow}
          </p>
        )}
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
        <div className="flex flex-row gap-2 items-center border-b pb-6">
          <MarkdownCopyButton markdownUrl={markdownUrl} />
          <ViewOptionsPopover
            markdownUrl={markdownUrl}
            githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/content/docs/${page.path}`}
          />
        </div>
        <DocsBody>
          <MDX
            components={getMDXComponents({
              // Relative MDX links (including extensionless ./path) → locale URLs
              a: createDocsRelativeLink(source, page),
            })}
          />
        </DocsBody>
      </DocsPage>
    </main>
  );
}

export async function generateStaticParams() {
  return [
    ...source.generateParams(),
    ...i18n.languages.flatMap((lang) =>
      channels.map((channel) => ({
        lang,
        slug: [channel, 'reference', 'cli', 'ak'],
      })),
    ),
  ];
}

export async function generateMetadata(
  props: PageProps<'/[lang]/[...slug]'>,
): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(canonicalPageSlug(params.slug), params.lang);
  if (!page) notFound();

  return docsPageMetadata(params.lang, page.slugs, {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      images: getPageImage(page).url,
    },
  });
}
