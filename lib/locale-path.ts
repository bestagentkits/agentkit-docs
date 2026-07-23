import { i18n } from './i18n';

/** Whether the default locale is omitted from user-facing URLs. */
export function hidesDefaultLocale(): boolean {
  return i18n.hideLocale === 'default-locale';
}

/**
 * User-facing path for a locale + slug segments (respects hideLocale).
 * Empty segments → locale home (`/` for hidden en, `/vi` for vi).
 */
export function localePath(locale: string, ...segments: string[]): string {
  const slug = segments.filter(Boolean).join('/');
  if (hidesDefaultLocale() && locale === i18n.defaultLanguage) {
    return slug ? `/${slug}` : '/';
  }
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
