import { createElement, type ComponentProps } from 'react';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import { resolveDocsRelativeHref } from '@/lib/relative-href';

/**
 * Like fumadocs `createRelativeLink`, but also resolves extensionless
 * `./path` links that would otherwise 404 on non-trailing-slash URLs.
 */
export function createDocsRelativeLink(
  // Fumadocs LoaderOutput — keep loose so we don't couple to its Page generics.
  source: { resolveHref: (href: string, parent: never) => string },
  page: { path: string; locale?: string },
) {
  const Link = defaultMdxComponents.a;
  return function DocsRelativeLink({ href, ...props }: ComponentProps<'a'>) {
    const resolved = resolveDocsRelativeHref(
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
