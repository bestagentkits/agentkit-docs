import Link from 'next/link';
import { channelRouteHref } from '@/lib/channel-route-href.mjs';
import { getChannelVersion } from '@/lib/channels';

// Persistent beta-channel notice. Rendered on every `beta/` docs page (keyed on
// the slug's channel prefix by the caller). The version is read from
// `channels.json` and is null-safe: before the first beta sync it simply omits
// the version clause rather than printing an empty parenthesis.
const copy = {
  en: {
    tag: 'Beta',
    lead: (v: string | null) =>
      v ? (
        <>
          You are reading docs for the <b>beta</b> channel (
          <code>{v}</code>). Features may change before the next stable release.
        </>
      ) : (
        <>
          You are reading docs for the <b>beta</b> channel. Features may change
          before the next stable release.
        </>
      ),
    mirrored: (v: string) => (
      <>
        The <b>beta</b> channel currently mirrors stable (<code>{v}</code>)
        while the next beta is prepared.
      </>
    ),
    link: 'Switch to stable →',
  },
  vi: {
    tag: 'Beta',
    lead: (v: string | null) =>
      v ? (
        <>
          Bạn đang đọc tài liệu kênh <b>beta</b> (<code>{v}</code>). Tính năng
          có thể thay đổi trước bản stable tiếp theo.
        </>
      ) : (
        <>
          Bạn đang đọc tài liệu kênh <b>beta</b>. Tính năng có thể thay đổi
          trước bản stable tiếp theo.
        </>
      ),
    mirrored: (v: string) => (
      <>
        Kênh <b>beta</b> hiện đang giống stable (<code>{v}</code>) trong khi
        bản beta tiếp theo được chuẩn bị.
      </>
    ),
    link: 'Chuyển sang stable →',
  },
} as const;

export function BetaBanner({
  locale,
  slug,
  stableRouteExists,
}: {
  locale: string;
  slug: string[];
  stableRouteExists: boolean;
}) {
  const t = copy[locale as keyof typeof copy] ?? copy.en;
  const version = getChannelVersion('beta');
  const stableVersion = getChannelVersion('stable');
  const mirrorsStable = version !== null && version === stableVersion;
  const stableHref = channelRouteHref(
    locale,
    'stable',
    slug.slice(1),
    stableRouteExists,
  );

  return (
    <div className="not-prose mx-0 mt-4 mb-6 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md border border-fd-border border-l-2 border-l-fd-primary bg-fd-primary/5 px-3.5 py-2 text-sm text-fd-muted-foreground sm:-mx-2">
      <span className="rounded border border-fd-primary/45 px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-fd-primary">
        {t.tag}
      </span>
      <span>{mirrorsStable ? t.mirrored(version) : t.lead(version)}</span>
      <Link href={stableHref} className="text-fd-primary hover:underline">
        {t.link}
      </Link>
    </div>
  );
}
