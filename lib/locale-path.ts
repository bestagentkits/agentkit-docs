import { i18n } from './i18n';

/**
 * User-facing path for a locale + slug segments.
 * Empty segments resolve to that locale's explicit home route.
 */
export function localePath(locale: string, ...segments: string[]): string {
  const slug = segments.filter(Boolean).join('/');
  return slug ? `/${locale}/${slug}` : `/${locale}`;
}

/** Absolute canonical URL on docs.agentkit.best (production domain). */
export function canonicalUrl(locale: string, ...segments: string[]): string {
  return `https://docs.agentkit.best${localePath(locale, ...segments)}`;
}

/** hreflang alternates for en + vi from the same slug segments. */
export function localeAlternates(...segments: string[]): Record<string, string> {
  const languages = Object.fromEntries(
    i18n.languages.map((lang) => [lang, canonicalUrl(lang, ...segments)]),
  );
  return {
    ...languages,
    'x-default': canonicalUrl(i18n.defaultLanguage, ...segments),
  };
}
