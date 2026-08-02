'use client';

import { cn } from '@/lib/cn';
import { useSearchContext } from 'fumadocs-ui/contexts/search';
import { useI18n } from 'fumadocs-ui/contexts/i18n';
import type {
  FullSearchTriggerProps,
  SearchTriggerProps,
} from 'fumadocs-ui/layouts/shared/slots/search-trigger';
import { Search } from 'lucide-react';

function useSearchLabel() {
  const { locale } = useI18n();
  return locale === 'vi'
    ? { action: 'Mở tìm kiếm', text: 'Tìm kiếm' }
    : { action: 'Open search', text: 'Search' };
}

function searchStateProps(open: boolean) {
  return {
    'aria-controls': 'fd-search-dialog-content',
    'aria-expanded': open,
    'aria-haspopup': 'dialog' as const,
  };
}

export function AccessibleSearchTrigger({
  className,
  hideIfDisabled,
  color: _color,
  size: _size,
  ...props
}: SearchTriggerProps) {
  const { enabled, open, setOpenSearch } = useSearchContext();
  const label = useSearchLabel();

  if (hideIfDisabled && !enabled) return null;

  return (
    <button
      type="button"
      data-search=""
      {...props}
      {...searchStateProps(open)}
      aria-label={label.action}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-md text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring',
        className,
      )}
      onClick={(event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented) setOpenSearch(true);
      }}
    >
      <Search aria-hidden="true" className="size-4" />
    </button>
  );
}

export function AccessibleFullSearchTrigger({
  className,
  hideIfDisabled,
  ...props
}: FullSearchTriggerProps) {
  const { enabled, hotKey, open, setOpenSearch } = useSearchContext();
  const label = useSearchLabel();

  if (hideIfDisabled && !enabled) return null;

  return (
    <button
      type="button"
      data-search-full=""
      {...props}
      {...searchStateProps(open)}
      aria-label={label.action}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg border bg-fd-secondary/50 p-1.5 ps-2 text-sm text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring',
        className,
      )}
      onClick={(event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented) setOpenSearch(true);
      }}
    >
      <Search aria-hidden="true" className="size-4" />
      <span>{label.text}</span>
      <span aria-hidden="true" className="ms-auto inline-flex gap-0.5">
        {hotKey.map((key, index) => (
          <kbd key={index} className="rounded-md border bg-fd-background px-1.5">
            {key.display}
          </kbd>
        ))}
      </span>
    </button>
  );
}
