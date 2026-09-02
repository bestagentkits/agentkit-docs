import type { MetadataRoute } from 'next';
import { source } from '@/lib/source';
import { i18n } from '@/lib/i18n';
import { canonicalUrl } from '@/lib/locale-path';
import { channelFromSlug, type ChannelId } from '@/lib/channels';
import { contentLocales } from '@/lib/route-variant';

// Required for a metadata route under `output: 'export'` (static export has
// no runtime to revalidate against) — see
// https://nextjs.org/docs/advanced-features/static-html-export
export const dynamic = 'force-static';

// Only `stable` is canonical for search: `beta` documents in-flight,
// unreleased behavior (CLAUDE.md — Stable is a reviewed snapshot of Beta)
// and is served `noindex` (see lib/metadata.ts), so listing it here would
// offer crawlers pages they've been told to skip.
const SITEMAP_CHANNEL: ChannelId = 'stable';

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

  // English is authored first and owns the channel-neutral default file
  // (lib/route-variant.ts), so it's the complete, authoritative slug list for
  // the stable channel.
  for (const page of source.getPages(i18n.defaultLanguage)) {
    if (channelFromSlug(page.slugs) !== SITEMAP_CHANNEL) continue;

    // Locales without real content at this slug fall back to English and are
    // `noindex` + self-canonicalized to the English URL (lib/metadata.ts) —
    // they don't belong in the sitemap as if they were distinct pages.
    const locales = contentLocales(page.slugs, i18n.languages);
    if (locales.length === 0) continue;

    // Every real locale (including the entry's own) plus `x-default` per
    // Google's hreflang guidance: a self-referencing entry is required, and
    // `x-default` names the page to serve a locale with no dedicated match.
    const languages = Object.fromEntries([
      ...locales.map((lang) => [lang, canonicalUrl(lang, ...page.slugs)]),
      ['x-default', canonicalUrl(i18n.defaultLanguage, ...page.slugs)],
    ]);

    for (const lang of locales) {
      entries.push({
        url: canonicalUrl(lang, ...page.slugs),
        alternates: locales.length > 1 ? { languages } : undefined,
      });
    }
  }

  // Deterministic output: a stable diff/order across builds, not a function
  // of `source.getPages()` traversal order.
  entries.sort((a, b) => a.url.localeCompare(b.url));

  return entries;
}
