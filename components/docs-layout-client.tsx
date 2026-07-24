'use client';

import { useMemo } from 'react';
import { usePathname } from 'fumadocs-core/framework';
import type * as PageTree from 'fumadocs-core/page-tree';
import { DocsLayout } from 'fumadocs-ui/layouts/notebook';
import {
  buildAreaNav,
  docsSlugFromPathname,
  filterPageTreeBySection,
  getActiveChannel,
  getDocsSection,
  transformChannelTab,
} from '@/lib/docs-nav';
import { baseOptions } from '@/lib/layout.shared';

const channelTabs = { transform: transformChannelTab };
const topNav = { mode: 'top' as const };

export function DocsLayoutClient({
  tree,
  locale,
  children,
}: {
  tree: PageTree.Root;
  locale: string;
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

  const options = useMemo(() => baseOptions(locale), [locale]);

  // Visible area tabs (Docs · Kits · CLI Reference) in the navbar; the channel
  // (stable/beta) stays a sidebar dropdown showing the release train version.
  const links = useMemo(
    () => [...buildAreaNav(locale, channel), ...(options.links ?? [])],
    [locale, channel, options.links],
  );

  return (
    <DocsLayout
      tree={filteredTree}
      tabMode="sidebar"
      nav={topNav}
      tabs={channelTabs}
      {...options}
      links={links}
    >
      {children}
    </DocsLayout>
  );
}
