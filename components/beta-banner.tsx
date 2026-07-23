import Link from 'next/link';
import { getChannelVersion } from '@/lib/channels';
import { localePath } from '@/lib/locale-path';

const copy = {
  en: {
    tag: 'Beta',
    lead: (v: string | null) =>
      v ? (
        <>
          You are reading docs for the <b>beta</b> channel (
          <code>{v}</code>) — updated automatically on every beta release.
        </>
      ) : (
        <>
          You are reading docs for the <b>beta</b> channel — updated
          automatically on every beta release.
        </>
      ),
    link: 'Switch to stable →',
  },
  vi: {
    tag: 'Beta',
    lead: (v: string | null) =>
      v ? (
        <>
          Bạn đang đọc tài liệu kênh <b>beta</b> (<code>{v}</code>) — tự động
          cập nhật theo mỗi bản phát hành beta.
        </>
      ) : (
        <>
          Bạn đang đọc tài liệu kênh <b>beta</b> — tự động cập nhật theo mỗi
          bản phát hành beta.
        </>
      ),
    link: 'Chuyển sang stable →',
  },
} as const;

/** Beta-only pages not yet promoted to stable — banner links to stable home. */
const BETA_ONLY_TOP_LEVEL = new Set(['kits', 'desktop-app']);
const BETA_ONLY_GUIDES = new Set(['migrating-from-claudekit']);

function stableChannelHref(locale: string, slug: string[]): string {
  const tail = slug.slice(1);
  if (tail.length === 0 || BETA_ONLY_TOP_LEVEL.has(tail[0])) {
    return localePath(locale, 'stable');
  }
  if (tail[0] === 'guides' && tail[1] && BETA_ONLY_GUIDES.has(tail[1])) {
    return localePath(locale, 'stable');
  }
  return localePath(locale, 'stable', ...tail);
}

export function BetaBanner({
  locale,
  slug,
}: {
  locale: string;
  slug: string[];
}) {
  const t = copy[locale as keyof typeof copy] ?? copy.en;
  const version = getChannelVersion('beta');
  const stableHref = stableChannelHref(locale, slug);

  return (
    <div className="not-prose -mx-2 mb-6 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md border border-fd-border border-l-2 border-l-fd-primary bg-fd-primary/5 px-3.5 py-2 text-sm text-fd-muted-foreground">
      <span className="rounded border border-fd-primary/45 px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-fd-primary">
        {t.tag}
      </span>
      <span>{t.lead(version)}</span>
      <Link href={stableHref} className="text-fd-primary hover:underline">
        {t.link}
      </Link>
    </div>
  );
}
