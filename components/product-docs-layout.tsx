'use client';

import { ChannelSelector } from '@/components/channel-selector';
import { baseOptions } from '@/lib/layout.shared';
import {
  activeProduct,
  filterTreeByProduct,
  productTabs,
} from '@/lib/product-navigation';
import type * as PageTree from 'fumadocs-core/page-tree';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { usePathname } from 'next/navigation';
import { type ReactNode, useMemo } from 'react';

export function ProductDocsLayout({
  children,
  locale,
  tree,
}: {
  children: ReactNode;
  locale: string;
  tree: PageTree.Root;
}) {
  const pathname = usePathname();
  const product = activeProduct(pathname);
  const channelSegment = pathname.split('/').filter(Boolean)[1];
  const channel = channelSegment === 'beta' ? 'beta' : 'stable';
  const filteredTree = useMemo(
    () => filterTreeByProduct(tree, product),
    [product, tree],
  );
  const tabs = useMemo(
    () => productTabs(tree, locale, channel),
    [channel, locale, tree],
  );

  return (
    <DocsLayout
      tree={filteredTree}
      tabs={tabs}
      tabMode="top"
      sidebar={{ banner: <ChannelSelector locale={locale} /> }}
      {...baseOptions(locale)}
    >
      {children}
    </DocsLayout>
  );
}
