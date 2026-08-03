import { docs } from 'collections/server';
import { loader, type LoaderPlugin } from 'fumadocs-core/source';
import { rewriteCliReferenceLinks } from './cli-reference-links';
import { resolveDocsRelativeHref } from './relative-href';
import { i18n } from './i18n';
import { docsContentRoute, docsImageRoute, docsRoute } from './shared';

function hideUnapprovedGeneratedContent(): LoaderPlugin {
  return {
    name: 'agentkit:hide-unapproved-generated-content',
    enforce: 'post',
    transformStorage({ storage }) {
      storage.delete('stable/changelog', true);
      storage.delete('beta/changelog', true);
      storage.delete('stable/reference/release-notes.mdx');
      storage.delete('stable/reference/release-notes.vi.mdx');
      storage.delete('beta/reference/release-notes.mdx');
      storage.delete('beta/reference/release-notes.vi.mdx');
    },
  };
}

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader({
  baseUrl: docsRoute,
  i18n,
  source: docs.toFumadocsSource(),
  plugins: [hideUnapprovedGeneratedContent()],
});

// The OG-image and raw-markdown route handlers live under the `[lang]` segment,
// so their URLs carry the page's locale prefix (`/en/og/docs/...`).
export function getPageImage(page: (typeof source)['$inferPage']) {
  const segments = [...page.slugs, 'image.png'];

  return {
    segments,
    url: `/${page.locale}${docsImageRoute}/${segments.join('/')}`,
  };
}

export function getPageMarkdownUrl(page: (typeof source)['$inferPage']) {
  const segments = [...page.slugs, 'content.md'];

  return {
    segments,
    url: `/${page.locale}${docsContentRoute}/${segments.join('/')}`,
  };
}

export async function getLLMText(page: (typeof source)['$inferPage']) {
  const processed = await page.data.getText('processed');
  const markdown = rewriteCliReferenceLinks(
    processed,
    source.getPages(page.locale),
    page.path,
    (href) =>
      resolveDocsRelativeHref(
        { resolveHref: (candidate) => source.resolveHref(candidate, page) },
        page,
        href,
      ),
  );

  return `# ${page.data.title} (${page.url})

${markdown}`;
}
