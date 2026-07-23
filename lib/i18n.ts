import { defineI18n } from 'fumadocs-core/i18n';

// Bilingual EN + VI. English is authored first (matches the ak-cli English
// source); Vietnamese is a fast-follow that can land page-by-page. A VI page
// with no `.vi.mdx` file falls back to the English body via `fallbackLanguage`,
// so the two locale trees always resolve the same slugs — the tree shape stays
// identical (a promotion/whole-copy invariant) even while VI prose is partial.
//
// hideLocale 'default-locale': English URLs omit the /en prefix; Vietnamese keeps /vi.
// Prefixless en paths are rewritten to /en/… at the edge via public/_redirects
// (static export — Next.js middleware is unavailable). parser 'dot': .en.mdx / .vi.mdx.
export const i18n = defineI18n({
  defaultLanguage: 'en',
  languages: ['en', 'vi'],
  hideLocale: 'default-locale',
  parser: 'dot',
  fallbackLanguage: 'en',
});
