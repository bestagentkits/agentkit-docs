import type { Metadata } from 'next';
import { localeAlternates, localePath } from './locale-path';

/** Canonical + hreflang for a docs page slug (channel-relative segments). */
export function docsPageMetadata(
  locale: string,
  slug: string[],
  base: Metadata,
): Metadata {
  const segments = slug;
  return {
    ...base,
    alternates: {
      canonical: localePath(locale, ...segments),
      languages: localeAlternates(...segments),
    },
  };
}
