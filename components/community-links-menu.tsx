'use client';

import {
  AppWindow,
  Code2,
  Globe,
  LifeBuoy,
  Megaphone,
  Menu,
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from 'fumadocs-ui/components/ui/popover';

const links = [
  {
    href: 'https://agentkit.best',
    label: 'Website',
    icon: Globe,
    separated: false,
  },
  {
    href: 'https://agentkit.best/engineer',
    label: 'AgentKit Engineer',
    icon: Code2,
    separated: false,
  },
  {
    href: 'https://agentkit.best/marketing',
    label: 'AgentKit Marketing',
    icon: Megaphone,
    separated: false,
  },
  {
    href: 'https://agentkit.best/agentkit-app',
    label: 'AgentKit App',
    icon: AppWindow,
    separated: false,
  },
  {
    href: 'https://agentkit.best/discord',
    label: 'Discord',
    icon: DiscordIcon,
    separated: true,
  },
  {
    href: 'https://github.com/bestagentkits/agentkit-support',
    label: 'Support & Feedback',
    icon: LifeBuoy,
    separated: false,
  },
] as const;

export function CommunityLinksMenu({ locale }: { locale: string }) {
  const menuLabel = locale === 'vi' ? 'Menu liên kết nhanh' : 'Quick links menu';

  return (
    <div className="flex shrink-0 justify-end">
      <Popover>
        <PopoverTrigger
          aria-label={menuLabel}
          className="inline-flex size-[30px] items-center justify-center rounded-lg border bg-fd-secondary/50 text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground data-[popup-open]:bg-fd-accent data-[popup-open]:text-fd-accent-foreground"
        >
          <Menu className="size-4.5" aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          role="menu"
          aria-label={menuLabel}
          className="min-w-56 rounded-lg bg-fd-card p-1"
        >
          {links.map(({ href, label, icon: Icon, separated }) => (
            <div
              key={href}
              className={separated ? 'mt-1 border-t pt-1' : undefined}
            >
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                role="menuitem"
                className="flex h-10 items-center gap-3 rounded-md px-3 font-medium text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring"
              >
                <Icon className="size-5 shrink-0" aria-hidden="true" />
                <span>{label}</span>
              </a>
            </div>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function DiscordIcon(props: React.ComponentProps<'svg'>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M19.5 5.34a17.2 17.2 0 0 0-4.3-1.34l-.53 1.08a15.93 15.93 0 0 0-5.34 0L8.8 4a17.16 17.16 0 0 0-4.3 1.34C1.78 9.36 1.04 13.28 1.4 17.14a17.4 17.4 0 0 0 5.27 2.66l1.28-1.75a11.22 11.22 0 0 1-1.67-.8l.41-.32a12.3 12.3 0 0 0 10.62 0l.41.32c-.53.3-1.09.57-1.67.8l1.28 1.75A17.4 17.4 0 0 0 23 17.14c.42-4.48-.72-8.36-3.5-11.8ZM8.58 14.78c-1.03 0-1.87-.94-1.87-2.09 0-1.15.82-2.09 1.87-2.09 1.06 0 1.9.95 1.88 2.09 0 1.15-.83 2.09-1.88 2.09Zm6.84 0c-1.03 0-1.87-.94-1.87-2.09 0-1.15.82-2.09 1.87-2.09 1.06 0 1.9.95 1.88 2.09 0 1.15-.82 2.09-1.88 2.09Z" />
    </svg>
  );
}
