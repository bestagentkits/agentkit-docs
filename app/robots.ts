import type { MetadataRoute } from 'next';

// Required for `output: 'export'` (Next.js 16.2.10) — without this, the
// build fails collecting page data for this Metadata Route.
export const dynamic = 'force-static';

// Staging and production are the same static `out/` shape deployed from two
// separate CI builds (see wrangler.toml), so a build-time env var is the only
// signal available to tell them apart — `DOCS_DEPLOY_ENV=staging` is set only
// by deploy-staging.yml's build step. Without this, staging would ship the
// production `Allow: /` + sitemap verbatim, inviting crawlers in (#118).
const isStaging = process.env.DOCS_DEPLOY_ENV === 'staging';

export default function robots(): MetadataRoute.Robots {
  if (isStaging) {
    return { rules: { userAgent: '*', disallow: '/' } };
  }
  return {
    rules: { userAgent: '*', allow: '/', disallow: '/api/' },
    sitemap: 'https://docs.agentkit.best/sitemap.xml',
  };
}
