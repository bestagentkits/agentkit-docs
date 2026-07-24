import { readdirSync } from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { i18n } from '@/lib/i18n';
import { localeAlternates, localePath } from '@/lib/locale-path';
import { HomeTerminal, type TerminalLine } from '@/components/home-terminal';
import channels from '@/channels.json';
import type { Metadata } from 'next';

const installCommand = 'curl -fsSL https://agentkit.best/install.sh | sh';

// Real quickstart session: commands mirror the Quickstart doc; the only
// invented output is the released version string from channels.json.
const terminalLines: TerminalLine[] = [
  { kind: 'cmd', text: installCommand },
  { kind: 'cmd', text: 'ak --version' },
  { kind: 'out', text: `ak ${channels.stable.version}` },
  { kind: 'cmd', text: 'ak login' },
  { kind: 'cmd', text: 'ak kit init engineer --target claude-code' },
];

// Command surface is derived from the generated CLI reference at build time,
// so counts and groups always match the released binary.
const cliDir = path.join(process.cwd(), 'content/docs/stable/reference/cli');
const cliPages = readdirSync(cliDir).filter(
  (f) => f.startsWith('ak_') && f.endsWith('.mdx'),
);
const commandCount = cliPages.length;
const commandGroups = [
  ...cliPages
    .reduce((map, file) => {
      const group = file.slice(3, -4).split('_')[0];
      map.set(group, (map.get(group) ?? 0) + 1);
      return map;
    }, new Map<string, number>())
    .entries(),
].sort(([a], [b]) => a.localeCompare(b));

// Link titles/descriptions mirror the frontmatter of the target pages.
const copy = {
  en: {
    eyebrow: 'AgentKit CLI',
    titleA: 'One binary.',
    titleB: 'Every agent kit.',
    body: 'ak installs and runs AI agent kits — bundles of skills for Claude Code and Codex. Signed releases, verified artifacts, managed updates.',
    cta: 'Read the docs',
    ctaSecondary: 'Quickstart',
    copyLabel: 'Copy install command',
    copiedLabel: 'Copied',
    stats: [
      { value: String(commandCount), label: 'commands documented' },
      { value: String(commandGroups.length), label: 'command groups' },
      { value: channels.stable.tag, label: 'stable channel' },
      { value: channels.beta.tag, label: 'beta channel' },
    ],
    howLabel: 'How it works',
    steps: [
      {
        title: 'Install',
        desc: 'One command installs the signed binary.',
        cmd: installCommand,
      },
      {
        title: 'Authenticate',
        desc: 'Log in once with your account.',
        cmd: 'ak login',
      },
      {
        title: 'Run a kit',
        desc: 'Install a kit into Claude Code or Codex.',
        cmd: 'ak kit init engineer --target claude-code',
      },
    ],
    surfaceLabel: 'Command surface',
    surfaceTitle: 'Every workflow, one prefix.',
    surfaceDesc: (groups: number, commands: number) =>
      `${groups} command groups, ${commands} documented commands — generated from the released binary.`,
    sectionLabel: 'Start here',
    links: [
      {
        title: 'Installation',
        desc: 'Install and verify ak on macOS, Linux, or Windows.',
        href: 'stable/getting-started/installation',
      },
      {
        title: 'Quickstart',
        desc: 'Authenticate, install your first kit, and invoke its skills.',
        href: 'stable/getting-started/quickstart',
      },
      {
        title: 'Installing kits',
        desc: 'Install kits into one or more assistant runtimes.',
        href: 'stable/guides/installing-kits',
      },
      {
        title: 'CLI commands',
        desc: 'Every command and flag, generated from the released binary.',
        href: 'stable/reference/cli',
      },
    ],
    ctaTitle: 'Ship your first kit today.',
    ctaDesc: 'From install to a running kit in minutes.',
  },
  vi: {
    eyebrow: 'AgentKit CLI',
    titleA: 'Một binary.',
    titleB: 'Mọi agent kit.',
    body: 'ak cài đặt và chạy các kit AI agent — gói skill cho Claude Code và Codex. Bản phát hành có chữ ký, artifact được xác minh, cập nhật có quản lý.',
    cta: 'Đọc tài liệu',
    ctaSecondary: 'Khởi động nhanh',
    copyLabel: 'Sao chép lệnh cài đặt',
    copiedLabel: 'Đã sao chép',
    stats: [
      { value: String(commandCount), label: 'lệnh được tài liệu hoá' },
      { value: String(commandGroups.length), label: 'nhóm lệnh' },
      { value: channels.stable.tag, label: 'kênh stable' },
      { value: channels.beta.tag, label: 'kênh beta' },
    ],
    howLabel: 'Cách hoạt động',
    steps: [
      {
        title: 'Cài đặt',
        desc: 'Một lệnh cài binary đã ký.',
        cmd: installCommand,
      },
      {
        title: 'Xác thực',
        desc: 'Đăng nhập một lần với tài khoản của bạn.',
        cmd: 'ak login',
      },
      {
        title: 'Chạy kit',
        desc: 'Cài kit vào Claude Code hoặc Codex.',
        cmd: 'ak kit init engineer --target claude-code',
      },
    ],
    surfaceLabel: 'Bề mặt lệnh',
    surfaceTitle: 'Mọi workflow, một tiền tố.',
    surfaceDesc: (groups: number, commands: number) =>
      `${groups} nhóm lệnh, ${commands} lệnh được tài liệu hoá — sinh từ binary đã phát hành.`,
    sectionLabel: 'Bắt đầu từ đây',
    links: [
      {
        title: 'Cài đặt',
        desc: 'Cài và xác minh ak trên macOS, Linux hoặc Windows.',
        href: 'stable/getting-started/installation',
      },
      {
        title: 'Khởi động nhanh',
        desc: 'Xác thực, cài kit đầu tiên và gọi skill.',
        href: 'stable/getting-started/quickstart',
      },
      {
        title: 'Cài kit',
        desc: 'Cài kit vào một hoặc nhiều runtime trợ lý.',
        href: 'stable/guides/installing-kits',
      },
      {
        title: 'Lệnh CLI',
        desc: 'Mọi lệnh và flag, sinh từ binary đã phát hành.',
        href: 'stable/reference/cli',
      },
    ],
    ctaTitle: 'Chạy kit đầu tiên ngay hôm nay.',
    ctaDesc: 'Từ cài đặt đến kit chạy được trong vài phút.',
  },
} as const;

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 font-mono text-xs font-medium uppercase tracking-[0.09em] text-fd-primary">
      {children}
    </p>
  );
}

export function generateStaticParams() {
  return i18n.languages.map((lang) => ({ lang }));
}

export async function generateMetadata({
  params,
}: PageProps<'/[lang]'>): Promise<Metadata> {
  const { lang } = await params;
  return {
    alternates: {
      canonical: localePath(lang),
      languages: localeAlternates(),
    },
  };
}

export default async function HomePage({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  const t = copy[lang as keyof typeof copy] ?? copy.en;

  return (
    <main className="ak-home relative flex flex-1 flex-col overflow-x-clip">
      <div
        aria-hidden
        className="ak-dot-grid pointer-events-none absolute inset-x-0 top-0 h-[42rem]"
      />
      <div className="ak-ambient-field pointer-events-none" aria-hidden>
        <span className="ak-ambient-orbit ak-ambient-orbit-a" />
        <span className="ak-ambient-orbit ak-ambient-orbit-b" />
        <span className="ak-ambient-beam" />
      </div>

      <div className="ak-home-shell">
        <section className="ak-breakout-hero" aria-labelledby="ak-home-title">
          <div className="ak-command-spine" aria-hidden>
            <span>ak</span>
            <i />
            <span>01</span>
          </div>

          <div className="ak-hero-status" aria-hidden>
            <span>
              <i className="ak-status-dot" />
              {channels.stable.tag}
            </span>
            <span>
              {commandGroups.length} groups / {commandCount} commands
            </span>
            <span>EN · VI</span>
          </div>

          <header className="ak-hero-copy">
            <Eyebrow>{t.eyebrow}</Eyebrow>
            <h1
              id="ak-home-title"
              className="ak-display mb-5 text-balance font-semibold tracking-tight"
            >
              <span className="block">{t.titleA}</span>
              <span className="ak-title-indent block text-fd-muted-foreground">
                {t.titleB}
              </span>
            </h1>
            <p className="ak-hero-body mb-8 max-w-md text-fd-muted-foreground">
              {t.body}
            </p>
            <div className="ak-primary-actions flex flex-wrap items-center gap-3">
              <Link
                href={localePath(lang, 'stable')}
                className="ak-button-primary inline-flex min-h-11 items-center rounded-md bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground"
              >
                {t.cta}
                <ArrowUpRight aria-hidden className="ml-2 size-4" />
              </Link>
              <Link
                href={localePath(lang, 'stable', 'getting-started', 'quickstart')}
                className="ak-button-secondary inline-flex min-h-11 items-center rounded-md border border-fd-border px-5 py-2.5 text-sm font-medium text-fd-foreground"
              >
                {t.ctaSecondary}
              </Link>
            </div>
          </header>

          <div className="ak-hero-proof min-w-0">
            <div className="ak-proof-frame">
              <div className="ak-proof-frame-label" aria-hidden>
                <span>AK / QUICKSTART</span>
                <span>01 — 05</span>
              </div>
              <HomeTerminal
                lines={terminalLines}
                copyCommand={installCommand}
                copyLabel={t.copyLabel}
                copiedLabel={t.copiedLabel}
              />
            </div>
          </div>

          <dl className="ak-proof-strip">
            {t.stats.map((stat, index) => (
              <div key={stat.label} data-index={String(index + 1).padStart(2, '0')}>
                <dd className="font-mono text-2xl font-medium tracking-tight text-fd-foreground md:text-3xl">
                  {stat.value}
                </dd>
                <dt className="mt-1.5 text-xs text-fd-muted-foreground">
                  {stat.label}
                </dt>
              </div>
            ))}
          </dl>
        </section>

        <section className="ak-route-section" aria-labelledby="ak-route-title">
          <div className="ak-section-marker" aria-hidden>
            <span>02</span>
          </div>
          <header className="ak-route-intro">
            <Eyebrow>{t.howLabel}</Eyebrow>
            <h2 id="ak-route-title" className="ak-route-title">
              {t.steps.map((step) => (
                <span key={step.title}>{step.title}</span>
              ))}
            </h2>
          </header>
          <ol className="ak-step-route">
            {t.steps.map((step, i) => (
              <li key={step.title}>
                <div className="ak-step-heading">
                  <span className="font-mono text-sm text-fd-primary" aria-hidden>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <h3 className="!text-base font-semibold">{step.title}</h3>
                </div>
                <p className="mt-2 text-sm text-fd-muted-foreground">
                  {step.desc}
                </p>
                <code className="mt-4 block overflow-x-auto whitespace-nowrap rounded-md border border-fd-border bg-fd-secondary px-3 py-2 font-mono text-xs text-fd-secondary-foreground">
                  $ {step.cmd}
                </code>
              </li>
            ))}
          </ol>
        </section>

        <section className="ak-surface-grid" aria-labelledby="ak-surface-title">
          <div className="ak-section-marker" aria-hidden>
            <span>03</span>
          </div>
          <header className="ak-surface-heading">
            <Eyebrow>{t.surfaceLabel}</Eyebrow>
            <h2
              id="ak-surface-title"
              className="!text-2xl font-semibold tracking-tight"
            >
              {t.surfaceTitle}
            </h2>
            <p className="mt-4 max-w-sm font-mono text-xs leading-5 text-fd-muted-foreground">
              {t.surfaceDesc(commandGroups.length, commandCount)}
            </p>
          </header>
          <div className="ak-command-console">
            <div className="ak-console-bar" aria-hidden>
              <span>ak://commands</span>
              <span>{commandGroups.length} namespaces</span>
            </div>
            <ul className="ak-command-index">
              {commandGroups.map(([group, count]) => (
                <li key={group}>
                  <Link
                    href={localePath(
                      lang,
                      'stable',
                      'reference',
                      'cli',
                      `ak_${group}`,
                    )}
                    className="group inline-flex min-h-11 items-center gap-1.5 font-mono text-xs text-fd-foreground transition-colors hover:text-fd-primary"
                  >
                    <span className="text-fd-muted-foreground">ak</span>
                    {group}
                    {count > 1 && (
                      <sup className="text-[10px] text-fd-muted-foreground">
                        {count}
                      </sup>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="ak-start-grid" aria-labelledby="ak-start-title">
          <div className="ak-section-marker" aria-hidden>
            <span>04</span>
          </div>
          <header className="ak-start-heading">
            <Eyebrow>{t.sectionLabel}</Eyebrow>
            <h2 id="ak-start-title" className="sr-only">
              {t.sectionLabel}
            </h2>
          </header>
          <nav aria-label={t.sectionLabel} className="ak-start-links">
            {t.links.map((link, i) => (
              <Link
                key={link.href}
                href={localePath(lang, ...link.href.split('/'))}
                className="group flex min-h-24 items-baseline gap-4 py-5"
              >
                <span className="font-mono text-xs text-fd-muted-foreground">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="flex-1">
                  <span className="flex items-center justify-between font-medium">
                    {link.title}
                    <ArrowUpRight
                      aria-hidden
                      className="size-4 text-fd-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-fd-primary motion-reduce:transform-none"
                    />
                  </span>
                  <span className="mt-1 block text-sm text-fd-muted-foreground">
                    {link.desc}
                  </span>
                </span>
                <i className="ak-link-signal" aria-hidden />
              </Link>
            ))}
          </nav>
        </section>

        <section className="ak-final-route ak-terminal">
          <div className="ak-final-marker font-mono text-fd-primary" aria-hidden>
            <span>ak</span>
            <i />
          </div>
          <div className="ak-final-copy">
            <div>
              <h2 className="!text-2xl font-semibold tracking-tight text-fd-foreground">
                {t.ctaTitle}
              </h2>
              <p className="mt-2 text-sm text-fd-muted-foreground">
                {t.ctaDesc}
              </p>
            </div>
            <div className="flex min-w-0 flex-col items-start gap-4 md:items-end">
              <code className="block max-w-full overflow-x-auto whitespace-nowrap font-mono text-sm text-fd-foreground">
                <span className="select-none text-fd-primary">$ </span>
                {installCommand}
              </code>
              <Link
                href={localePath(lang, 'stable')}
                className="ak-button-primary inline-flex min-h-11 items-center rounded-md bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground"
              >
                {t.cta}
                <ArrowUpRight aria-hidden className="ml-2 size-4" />
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
