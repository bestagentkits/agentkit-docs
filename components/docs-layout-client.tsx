'use client';

import { useMemo } from 'react';
import { usePathname } from 'fumadocs-core/framework';
import type * as PageTree from 'fumadocs-core/page-tree';
import { DocsLayout } from 'fumadocs-ui/layouts/notebook';
import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import {
  buildSectionNavLinks,
  docsSlugFromPathname,
  filterPageTreeBySection,
  getActiveChannel,
  getDocsSection,
  transformChannelTab,
} from '@/lib/docs-nav';

export function DocsLayoutClient({
  tree,
  locale,
  baseOptions,
  children,
}: {
  tree: PageTree.Root;
  locale: string;
  baseOptions: BaseLayoutProps;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const slug = docsSlugFromPathname(pathname);
  const section = getDocsSection(slug);
  const channel = getActiveChannel(slug);

  const filteredTree = useMemo(
    () => filterPageTreeBySection(tree, section),
    [tree, section],
  );

  const links = useMemo(
    () => [...buildSectionNavLinks(locale, channel), ...(baseOptions.links ?? [])],
    [locale, channel, baseOptions.links],
  );

  return (
    <DocsLayout
      tree={filteredTree}
      tabMode="sidebar"
      nav={{ mode: 'top' }}
      tabs={{ transform: transformChannelTab }}
      {...baseOptions}
      links={links}
    >
      {children}
    </DocsLayout>
  );
}
