import type { MetadataRoute } from 'next';

// Required for a metadata route under `output: 'export'` (static export has
// no runtime to revalidate against) — see
// https://nextjs.org/docs/advanced-features/static-html-export
export const dynamic = 'force-static';

const PRODUCTION_ORIGIN = 'https://docs.agentkit.best';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // OG image PNGs, the raw `llms.mdx` source, and the sibling `.md`
      // mirrors are all deliberately crawlable — blocking them would hide
      // Twitter Card images and defeat the AI-crawler-facing Markdown
      // endpoints (issue #29). `_showcase` and any other non-`stable` route
      // rely on `<meta name="robots" content="noindex">` (lib/metadata.ts)
      // instead of a crawl block, so crawlers can still see and honor that
      // tag rather than being turned away before they reach it.
      disallow: ['/api/'], // search index endpoint, not a page
    },
    sitemap: `${PRODUCTION_ORIGIN}/sitemap.xml`,
  };
}
