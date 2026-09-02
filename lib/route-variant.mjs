// Shared between the Next app (lib/route-variant.ts) and pipeline scripts
// (scripts/release-quality-shape.mjs) so the dot-locale classification rule
// is defined once. A bare `route.mdx` is the locale-agnostic ("shared")
// default, `route.en.mdx` / `route.vi.mdx` are locale-specific overrides, and
// `dir/index.mdx` is the folder's own route.
export function parseVariant(path) {
  const match = path.match(/^(.*)\.(en|vi)\.mdx$/);
  const sourceRoute = match ? match[1] : path.slice(0, -'.mdx'.length);
  const route =
    sourceRoute === 'index'
      ? ''
      : sourceRoute.endsWith('/index')
        ? sourceRoute.slice(0, -'/index'.length)
        : sourceRoute;
  return { route, variant: match ? match[2] : 'shared' };
}

export function resolveVariant(variants, locale) {
  if (variants.has(locale)) return 'native';
  if (locale === 'en' && variants.has('shared')) return 'shared-default';
  if (locale === 'vi' && variants.has('en')) return 'english-fallback';
  if (variants.has('shared')) return 'shared-fallback';
  return null;
}
