import type { MetadataRoute } from 'next';
import { i18n } from '@/lib/i18n';
import { source } from '@/lib/source';
import { channelFromSlug } from '@/lib/channels';
import { canonicalUrl } from '@/lib/locale-path';

// Required for `output: 'export'` (Next.js 16.2.10) — without this, the
// build fails collecting page data for this Metadata Route.
export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];
  for (const lang of i18n.languages) {
    for (const page of source.getPages(lang)) {
      if (!channelFromSlug(page.slugs)) continue; // e.g. _showcase
      entries.push({ url: canonicalUrl(lang, ...page.slugs) });
    }
  }
  return entries;
}
