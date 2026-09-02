import type { MetadataRoute } from 'next';

// Required for `output: 'export'` (Next.js 16.2.10) — without this, the
// build fails collecting page data for this Metadata Route.
export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: '/api/' },
    sitemap: 'https://docs.agentkit.best/sitemap.xml',
  };
}
