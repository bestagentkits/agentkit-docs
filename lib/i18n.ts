import { defineI18n } from 'fumadocs-core/i18n';

// Bilingual EN + VI. English is authored first (matches the ak-cli English
// source); Vietnamese is a fast-follow that can land page-by-page. A VI page
// with no `.vi.mdx` file falls back to the English body via `fallbackLanguage`,
// so the two locale trees always resolve the same slugs — the tree shape stays
// identical (a promotion/whole-copy invariant) even while VI prose is partial.
//
// Both locales stay URL-prefixed so explicit /en and /vi routes use the same
// contract in local development and the static Cloudflare deployment. The bare
// root redirects to English Stable separately. parser 'dot': .en.mdx / .vi.mdx.
export const i18n = defineI18n({
  defaultLanguage: 'en',
  languages: ['en', 'vi'],
  hideLocale: 'never',
  parser: 'dot',
  fallbackLanguage: 'en',
});
