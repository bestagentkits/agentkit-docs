import Link from 'next/link';
import { getChannelVersion } from '@/lib/channels';
import { localePath } from '@/lib/locale-path';

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
    link: 'Chuyển sang stable →',
  },
} as const;

export function BetaBanner({
  locale,
  slug,
}: {
  locale: string;
  slug: string[];
}) {
  const t = copy[locale as keyof typeof copy] ?? copy.en;
  const version = getChannelVersion('beta');
  // Same page on the stable channel = swap the leading `beta` segment.
  // Static params retain percent-encoded spaces; pass decoded segments to
  // Next's Link so it applies URL encoding exactly once.
  const stableHref = localePath(
    locale,
    'stable',
    ...slug.slice(1).map((segment) => decodeURI(segment)),
  );

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
