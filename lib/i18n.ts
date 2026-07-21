import { defineI18n } from 'fumadocs-core/i18n';

// Bilingual EN + VI. English is authored first (matches the ak-cli English
// source); Vietnamese is a fast-follow that can land page-by-page. A VI page
// with no `.vi.mdx` file falls back to the English body via `fallbackLanguage`,
// so the two locale trees always resolve the same slugs — the tree shape stays
// identical (a promotion/whole-copy invariant) even while VI prose is partial.
//
// hideLocale 'never': both locales carry an explicit URL prefix (/en, /vi).
// parser 'dot': content files use `.en.mdx` / `.vi.mdx` suffixes.
export const i18n = defineI18n({
  defaultLanguage: 'en',
  languages: ['en', 'vi'],
  hideLocale: 'never',
  parser: 'dot',
  fallbackLanguage: 'en',
});
