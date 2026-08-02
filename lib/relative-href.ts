/**
 * Fumadocs `resolveHref` only matches relative links that point at a virtual
 * file path (e.g. `./installation.mdx`). Extensionless `./installation` is left
 * unresolved, so on `/…/stable` (no trailing slash) the browser resolves it to
 * `/…/getting-started/installation` and 404s.
 *
 * Try the authored href first, then `.mdx` and `/index.mdx` candidates.
 */
export function resolveDocsRelativeHref(
  source: {
    resolveHref: (href: string, parent: { path: string; locale?: string }) => string;
  },
  page: { path: string; locale?: string },
  href: string | undefined,
): string | undefined {
  if (!href) return href;
  if (!(href.startsWith('./') || href.startsWith('../'))) return href;

  const resolved = (candidate: string) => {
    const out = source.resolveHref(candidate, page);
    return out !== candidate && !out.startsWith('./') && !out.startsWith('../')
      ? out
      : null;
  };

  const direct = resolved(href);
  if (direct) return direct;

  const hashIdx = href.indexOf('#');
  const path = hashIdx === -1 ? href : href.slice(0, hashIdx);
  const hash = hashIdx === -1 ? '' : href.slice(hashIdx);
  if (/\.mdx?$/i.test(path)) return href;

  for (const suffix of ['.mdx', '/index.mdx'] as const) {
    const hit = resolved(`${path}${suffix}${hash}`);
    if (hit) return hit;
  }
  return href;
}
