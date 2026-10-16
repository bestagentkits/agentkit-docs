'use client';
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogFooter,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
} from 'fumadocs-ui/components/dialog/search';
import { useDocsSearch } from 'fumadocs-core/search/client';
import { useI18n } from 'fumadocs-ui/contexts/i18n';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import { channelRootTitle } from '@/lib/channel-metadata.mjs';
import {
  createScopedSearchClient,
  evictSearchShard,
  searchShortcutItems,
} from '@/lib/search-client.mjs';
import { searchScopeFromPathname, searchScopeKey } from '@/lib/search-scopes.mjs';

// Every reader-facing string in the dialog, per locale. Kept beside the
// component so a missing locale falls back to English instead of rendering a
// half-translated dialog.
const SEARCH_DIALOG_TEXT = {
  en: {
    inputLabel: 'Search documentation',
    shortcutsLabel: 'Shortcuts',
    loading: 'Searching…',
    noResults: 'No matching page.',
    noResultsHint: 'Try a shorter phrase, or open one of the shortcuts below.',
    unavailable: 'Search is unavailable right now.',
    unavailableHint: 'Retry the search, or open one of the shortcuts below.',
    retry: 'Retry',
    clear: 'Clear query',
  },
  vi: {
    inputLabel: 'Tìm kiếm tài liệu',
    shortcutsLabel: 'Lối tắt',
    loading: 'Đang tìm kiếm…',
    noResults: 'Không có trang phù hợp.',
    noResultsHint: 'Hãy thử cụm từ ngắn hơn, hoặc mở một lối tắt bên dưới.',
    unavailable: 'Hiện không thể tìm kiếm.',
    unavailableHint: 'Hãy thử lại, hoặc mở một lối tắt bên dưới.',
    retry: 'Thử lại',
    clear: 'Xóa từ khóa',
  },
} as const;

// Shortcuts are navigation, not search results: they stay reachable when a
// query matches nothing and when the shard cannot be loaded at all.
const SHORTCUT_LINK_CLASS =
  'rounded-md border border-fd-border bg-fd-secondary/50 px-2 py-1 text-xs font-medium text-fd-muted-foreground transition-colors hover:text-fd-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring';

function SearchShortcuts({
  label,
  items,
}: {
  label: string;
  items: { id: string; label: string; href: string }[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-[11px] font-medium uppercase tracking-wide text-fd-muted-foreground">
        {label}
      </p>
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={item.id}>
            <Link href={item.href} className={SHORTCUT_LINK_CLASS}>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SearchStatePanel({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col gap-3 px-3 py-4 text-sm text-fd-muted-foreground"
    >
      {children}
    </div>
  );
}

// The dialog is mounted in the locale layout, so it outlives navigation between
// channel and locale routes. Keying this component by the current scope gives
// every scope a fresh query and results state instead of leaving the previous
// scope's results on screen while the new shard loads.
export default function DefaultSearchDialog(props: SharedProps) {
  const { locale } = useI18n();
  const pathname = usePathname();
  const scope = useMemo(() => searchScopeFromPathname(pathname, locale), [pathname, locale]);

  return (
    <ScopedSearchDialog
      key={searchScopeKey(scope.locale, scope.channel)}
      locale={scope.locale}
      channel={scope.channel}
      {...props}
    />
  );
}

function ScopedSearchDialog({
  locale,
  channel,
  ...props
}: SharedProps & { locale: string; channel: string }) {
  const text = SEARCH_DIALOG_TEXT[locale as keyof typeof SEARCH_DIALOG_TEXT] ?? SEARCH_DIALOG_TEXT.en;
  const [retryToken, setRetryToken] = useState(0);

  // `retryToken` participates in the client's deps, so Retry re-runs the same
  // query instead of reusing a settled error state, and the shard cache entry
  // is dropped so a failed load is genuinely refetched.
  const client = useMemo(
    () => createScopedSearchClient({ locale, channel, retryToken }),
    [locale, channel, retryToken],
  );
  const { search, setSearch, query } = useDocsSearch({ client });

  const shortcuts = useMemo(() => searchShortcutItems({ locale, channel }), [locale, channel]);
  const channelLabel = channelRootTitle(channel) ?? channel;

  const retry = useCallback(() => {
    evictSearchShard({ locale, channel });
    setRetryToken((token) => token + 1);
  }, [locale, channel]);

  const hasQuery = search.trim().length > 0;
  const results = Array.isArray(query.data) ? query.data : null;
  // Never present the previous query's or scope's rows as the current answer:
  // while a query is in flight the list is replaced by an explicit status.
  const showResults = hasQuery && !query.isLoading && !query.error && results !== null && results.length > 0;

  return (
    <SearchDialog
      search={search}
      onSearchChange={setSearch}
      isLoading={query.isLoading}
      {...props}
    >
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput aria-label={text.inputLabel} autoComplete="off" />
          <SearchDialogClose />
        </SearchDialogHeader>
        {showResults ? (
          <SearchDialogList items={results} />
        ) : (
          <SearchStatePanel>
            {!hasQuery ? (
              <SearchShortcuts label={text.shortcutsLabel} items={shortcuts} />
            ) : query.isLoading ? (
              <p>{text.loading}</p>
            ) : query.error ? (
              <>
                <p className="text-fd-foreground">{text.unavailable}</p>
                <p>{text.unavailableHint}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={retry}
                    className="rounded-md border border-fd-primary px-2 py-1 text-xs font-medium text-fd-primary transition-colors hover:bg-fd-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring"
                  >
                    {text.retry}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className={SHORTCUT_LINK_CLASS}
                  >
                    {text.clear}
                  </button>
                </div>
                <SearchShortcuts label={text.shortcutsLabel} items={shortcuts} />
              </>
            ) : (
              <>
                <p className="text-fd-foreground">{text.noResults}</p>
                <p>{text.noResultsHint}</p>
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className={cn(SHORTCUT_LINK_CLASS, 'self-start')}
                >
                  {text.clear}
                </button>
                <SearchShortcuts label={text.shortcutsLabel} items={shortcuts} />
              </>
            )}
          </SearchStatePanel>
        )}
        <SearchDialogFooter className="flex items-center justify-between gap-2 border-t border-fd-border px-3 py-2 text-xs text-fd-muted-foreground">
          <span>{channelLabel}</span>
          <span className="font-mono uppercase">{locale}</span>
        </SearchDialogFooter>
      </SearchDialogContent>
    </SearchDialog>
  );
}
