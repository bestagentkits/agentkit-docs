import { resolveCliReferenceHref } from './cli-reference-routes.mjs';

type CliReferencePage = {
  data: { title?: unknown };
  path?: string;
  url: string;
};

export function resolveCanonicalCliReferenceHref(
  href: string | undefined,
  pages: CliReferencePage[],
  parentPath?: string,
): string | undefined {
  return resolveCliReferenceHref(href, pages, parentPath);
}

export function rewriteCliReferenceLinks(
  markdown: string,
  pages: CliReferencePage[],
  parentPath?: string,
  resolveRelativeHref?: (href: string) => string | undefined,
): string {
  return markdown.replace(/(\]\()([^\s)]+)([^)]*\))/g, (match, open, href, close) => {
    const resolved =
      resolveCanonicalCliReferenceHref(href, pages, parentPath) ??
      resolveRelativeHref?.(href);
    return resolved && resolved !== href ? `${open}${resolved}${close}` : match;
  });
}
