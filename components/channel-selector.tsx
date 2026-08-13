'use client';

import { channelRouteHref } from '@/lib/channel-route-href.mjs';
import { cn } from '@/lib/cn';
import { getChannelVersion } from '@/lib/channels';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const channels = ['stable', 'beta'] as const;

export function ChannelSelector({
  locale,
  unavailableUrls,
}: {
  locale: string;
  unavailableUrls: Set<string>;
}) {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  const activeChannel = channels.find((channel) => segments[1] === channel) ?? 'stable';
  const remainder = segments.slice(2);

  return (
    <nav aria-label={locale === 'vi' ? 'Kênh phát hành' : 'Release channel'}>
      <div className="grid grid-cols-2 rounded-lg border bg-fd-secondary/50 p-1">
        {channels.map((channel) => {
          const active = channel === activeChannel;
          const targetPath = `/${locale}/${channel}${remainder.length > 0 ? `/${remainder.join('/')}` : ''}`;
          const href = channelRouteHref(
            locale,
            channel,
            remainder,
            !unavailableUrls.has(targetPath),
          );
          const version = getChannelVersion(channel);

          return (
            <Link
              key={channel}
              href={href}
              aria-current={active ? 'page' : undefined}
              data-active={active}
              className={cn(
                'rounded-md px-2 py-1.5 text-center text-sm font-medium text-fd-muted-foreground transition-colors hover:text-fd-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring',
                active && 'bg-fd-background text-fd-primary shadow-sm',
              )}
            >
              <span className="block capitalize">{channel}</span>
              {version && (
                <span className="block font-mono text-[11px] font-normal">
                  {version}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
