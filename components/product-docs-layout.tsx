'use client';

import { ChannelSelector } from '@/components/channel-selector';
import { baseOptions } from '@/lib/layout.shared';
import {
  activeProduct,
  filterTreeByProduct,
  productTabs,
} from '@/lib/product-navigation';
import {
  deserializePageTree,
  type SerializedPageTree,
} from 'fumadocs-core/source/client';
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
  tree: SerializedPageTree;
}) {
  const pathname = usePathname();
  const product = activeProduct(pathname);
  const channelSegment = pathname.split('/').filter(Boolean)[1];
  const channel = channelSegment === 'beta' ? 'beta' : 'stable';
  const pageTree = useMemo(() => deserializePageTree(tree), [tree]);
  const filteredTree = useMemo(
    () => filterTreeByProduct(pageTree, product),
    [pageTree, product],
  );
  const tabs = useMemo(
    () => productTabs(pageTree, locale, channel),
    [channel, locale, pageTree],
  );

  return (
    <DocsLayout
      tree={filteredTree}
      tabs={tabs}
      tabMode="top"
      containerProps={{ className: 'ak-product-docs-layout' }}
      sidebar={{ banner: <ChannelSelector locale={locale} /> }}
      {...baseOptions(locale)}
    >
      {children}
    </DocsLayout>
  );
}
