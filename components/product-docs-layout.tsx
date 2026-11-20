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
import { useSidebar } from 'fumadocs-ui/components/sidebar/base';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useRef } from 'react';

function MobileSidebarFocus({ pathname }: { pathname: string }) {
  const { mode, open, setOpen } = useSidebar();
  const opening = useRef<{ trigger: HTMLElement; pathname: string } | null>(null);

  useEffect(() => {
    const drawer = document.getElementById('nd-sidebar-mobile');
    if (mode !== 'drawer' || !drawer) {
      opening.current = null;
      return;
    }

    const focused = document.activeElement;
    if (!open) {
      const previous = opening.current;
      opening.current = null;
      if (
        previous?.pathname === pathname &&
        previous.trigger.isConnected &&
        (focused === document.body || drawer.contains(focused))
      ) {
        previous.trigger.focus({ preventScroll: true });
      }
      return;
    }

    if (
      focused instanceof HTMLElement &&
      !drawer.contains(focused) &&
      focused.getAttribute('aria-controls') === drawer.id
    ) {
      opening.current = { trigger: focused, pathname };
      drawer.querySelector<HTMLElement>(`button[aria-controls="${drawer.id}"]`)?.focus();
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        (drawer.contains(document.activeElement) ||
          document.activeElement === opening.current?.trigger)
      ) {
        event.preventDefault();
        setOpen(false);
      }
    };

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [mode, open, pathname, setOpen]);

  return null;
}

export function ProductDocsLayout({
  children,
  locale,
  tree,
  unavailableUrls,
}: {
  children: ReactNode;
  locale: string;
  tree: SerializedPageTree;
  unavailableUrls: string[];
}) {
  const pathname = usePathname();
  const product = activeProduct(pathname);
  const channelSegment = pathname.split('/').filter(Boolean)[1];
  const channel = channelSegment === 'beta' ? 'beta' : 'stable';
  const pageTree = useMemo(() => deserializePageTree(tree), [tree]);
  const unavailableUrlSet = useMemo(
    () => new Set(unavailableUrls),
    [unavailableUrls],
  );
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
      sidebar={{
        banner: (
          <ChannelSelector
            locale={locale}
            unavailableUrls={unavailableUrlSet}
          />
        ),
      }}
      {...baseOptions(locale)}
    >
      <MobileSidebarFocus pathname={pathname} />
      {children}
    </DocsLayout>
  );
}
