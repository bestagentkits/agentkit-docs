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
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/components/mdx';
import { BetaBanner } from '@/components/beta-banner';
import { channelFromSlug } from '@/lib/channels';
import type { Metadata } from 'next';
import { createRelativeLink } from 'fumadocs-ui/mdx';

export default async function Page(props: PageProps<'/[lang]/docs/[[...slug]]'>) {
  const params = await props.params;
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

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      {channel === 'beta' && (
        <BetaBanner locale={params.lang} slug={params.slug ?? []} />
      )}
      {eyebrow && (
        <p className="mb-3 font-mono text-xs font-medium uppercase tracking-[0.09em] text-fd-primary">
          {eyebrow}
        </p>
      )}
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
      <div className="flex flex-row gap-2 items-center border-b pb-6">
        {/* No "view/edit on GitHub" link: the docs source repo is private, so a
            source link would 404 for readers. Only the site's own raw Markdown
            (public) is offered. */}
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover markdownUrl={markdownUrl} />
      </div>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            // this allows you to link to other pages with relative file paths
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(
  props: PageProps<'/[lang]/docs/[[...slug]]'>,
): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug, params.lang);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      images: getPageImage(page).url,
    },
  };
}
