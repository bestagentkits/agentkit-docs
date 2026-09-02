import type { Metadata } from 'next';
import { localeAlternates, localePath } from './locale-path';
import { i18n } from './i18n';
import { channelFromSlug } from './channels';
import { contentLocales, isCanonicalContent } from './route-variant';
import { appName } from './shared';

const OG_LOCALE: Record<string, string> = { en: 'en_US', vi: 'vi_VN' };

function firstOgImage(openGraph: Metadata['openGraph']): string | undefined {
  if (!openGraph || !('images' in openGraph)) return undefined;
  const images = openGraph.images;
  return typeof images === 'string' ? images : undefined;
}

/** Canonical + hreflang + OG/Twitter for a docs page slug (channel-inclusive segments). */
export function docsPageMetadata(locale: string, slug: string[], base: Metadata): Metadata {
  const segments = slug;
  const channel = channelFromSlug(segments);
  const isCanonicalLocale = isCanonicalContent(segments, locale);
  // A locale with no authored content at this slug silently renders the
  // `fallbackLanguage` body (lib/i18n.ts) — canonicalize to that real page
  // instead of asserting a distinct translation exists (issue #61).
  const canonicalLocale = isCanonicalLocale ? locale : i18n.defaultLanguage;
  const availableLocales = contentLocales(segments, i18n.languages);
  const image = firstOgImage(base.openGraph);

  return {
    ...base,
    alternates: {
      canonical: localePath(canonicalLocale, ...segments),
      // Only advertise hreflang from a page that itself has real content —
      // a fallback page has nothing distinct to offer as an "alternate".
      ...(isCanonicalLocale && availableLocales.length > 1
        ? { languages: localeAlternates(segments, availableLocales) }
        : {}),
    },
    // `beta` documents in-flight/unreleased behavior (CLAUDE.md: Stable is a
    // reviewed snapshot of Beta), so only `stable` is indexable. A fallback
    // locale relies on `alternates.canonical` alone to consolidate into the
    // English URL above — pairing that with `noindex` is a contradictory
    // signal (Google treats noindex + cross-page canonical as unreliable),
    // so it stays un-noindexed here. Both stay crawlable (no robots.txt
    // block) so internal links resolve and canonical is honored by crawlers
    // that do see the page.
    robots: channel === 'stable' ? undefined : { index: false, follow: true },
    openGraph: {
      type: 'article',
      siteName: `${appName} Docs`,
      locale: OG_LOCALE[locale] ?? locale,
      url: localePath(locale, ...segments),
      title: base.title ?? undefined,
      description: base.description ?? undefined,
      images: image,
    },
    twitter: {
      card: 'summary_large_image',
      title: base.title ?? undefined,
      description: base.description ?? undefined,
      images: image,
    },
  };
}
