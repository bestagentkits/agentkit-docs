import type { MetadataRoute } from 'next';

// Required for `output: 'export'` (Next.js 16.2.10) — without this, the
// build fails collecting page data for this Metadata Route.
export const dynamic = 'force-static';

// staging.docs.agentkit.best and docs.agentkit.best are separate Cloudflare
// Workers built from separate CI jobs (deploy-staging.yml / deploy-production.yml),
// each running its own `pnpm build` before `wrangler deploy`. Under
// `output: 'export'` this file only runs at build time, so DOCS_DEPLOY_ENV is
// the build-time signal distinguishing the two — see issue #118. Only the
// staging workflow sets it; production stays on the default (unset) path.
const IS_STAGING = process.env.DOCS_DEPLOY_ENV === 'staging';

export default function robots(): MetadataRoute.Robots {
  if (IS_STAGING) {
    // Crawl hint only (see #61's non-goals) — not access control. Omits the
    // Sitemap line rather than pointing crawlers at production's.
    return { rules: { userAgent: '*', disallow: '/' } };
  }
  return {
    rules: { userAgent: '*', allow: '/', disallow: '/api/' },
    sitemap: 'https://docs.agentkit.best/sitemap.xml',
  };
}
