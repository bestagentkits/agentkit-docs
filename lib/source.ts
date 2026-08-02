import { docs } from 'collections/server';
import { loader, type LoaderPlugin } from 'fumadocs-core/source';
import { rewriteLegacyCliReferenceLinks } from './cli-reference-links';
import { i18n } from './i18n';
import { docsContentRoute, docsImageRoute, docsRoute } from './shared';

const channels = ['stable', 'beta'] as const;

function canonicalCliReference(): LoaderPlugin {
  return {
    name: 'agentkit:canonical-cli-reference',
    enforce: 'post',
    transformStorage({ storage }) {
      // Retain generated CLI files on disk for the release pipeline, but keep
      // their obsolete content out of every published source consumer.
      for (const channel of channels) {
        storage.delete(`${channel}/reference/cli`, true);
      }

      // Publish the reviewed authored collection at canonical /reference/cli
      // URLs while its human-owned source remains in cli-samples/.
      for (const path of storage.getFiles()) {
        if (!path.includes('/reference/cli-samples/')) continue;

        const file = storage.read(path);
        if (file?.format !== 'page') continue;
        file.slugs = file.slugs.map((segment) =>
          segment === 'cli-samples' ? 'cli' : segment,
        );
      }
    },
  };
}

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader({
  baseUrl: docsRoute,
  i18n,
  source: docs.toFumadocsSource(),
  plugins: [canonicalCliReference()],
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
  const markdown = rewriteLegacyCliReferenceLinks(
    processed,
    source.getPages(page.locale),
  );

  return `# ${page.data.title} (${page.url})

${markdown}`;
}
