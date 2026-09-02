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

/**
 * hreflang alternates from the same slug segments, restricted to `locales`
 * (default: every configured language). Callers exclude a locale here when it
 * has no real translation at this slug — see `lib/route-variant.ts` — so a
 * silent `fallbackLanguage` copy is never asserted as a distinct translation.
 */
export function localeAlternates(
  segments: string[],
  locales: readonly string[] = i18n.languages,
): Record<string, string> {
  const languages = Object.fromEntries(
    locales.map((lang) => [lang, canonicalUrl(lang, ...segments)]),
  );
  return {
    ...languages,
    'x-default': canonicalUrl(i18n.defaultLanguage, ...segments),
  };
}
