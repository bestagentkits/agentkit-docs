import { createElement, type ComponentProps } from 'react';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import { resolveCanonicalCliReferenceHref } from '@/lib/cli-reference-links';
import { resolveDocsRelativeHref } from '@/lib/relative-href';

/**
 * Like fumadocs `createRelativeLink`, but also resolves extensionless
 * `./path` links that would otherwise 404 on non-trailing-slash URLs.
 */
export function createDocsRelativeLink(
  // Fumadocs LoaderOutput — keep loose so we don't couple to its Page generics.
  source: {
    getPages: (locale?: string) => Array<{
      data: { title?: unknown };
      path?: string;
      url: string;
    }>;
    resolveHref: (href: string, parent: never) => string;
  },
  page: { path: string; locale?: string },
) {
  const Link = defaultMdxComponents.a;
  const pages = source.getPages(page.locale);
  return function DocsRelativeLink({ href, ...props }: ComponentProps<'a'>) {
    const resolved =
      resolveCanonicalCliReferenceHref(href, pages, page.path) ??
      resolveDocsRelativeHref(
        {
          resolveHref: (h, parent) =>
            source.resolveHref(h, parent as never),
        },
        page,
        href,
      );
    return createElement(Link, { href: resolved, ...props });
  };
}
