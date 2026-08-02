import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { i18n } from '@/lib/i18n';
import { localeAlternates, localePath } from '@/lib/locale-path';
import { HomeTerminal, type TerminalLine } from '@/components/home-terminal';
import channels from '@/channels.json';
import { cliCommandSegmentsFromTitle } from '@/lib/cli-reference-routes.mjs';
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

// Command surface is derived from the reviewed authored reference at build
// time, so the homepage and canonical docs navigation share one inventory.
const cliDir = path.join(
  process.cwd(),
  'content/docs/stable/reference/cli-samples',
);
const cliPages = readdirSync(cliDir).filter((file) => file.endsWith('.en.mdx'));
const commandCount = cliPages.length;
const commandGroupMap = new Map<string, { count: number; slug: string }>();

for (const file of cliPages) {
  if (file === 'index.en.mdx') continue;

  const content = readFileSync(path.join(cliDir, file), 'utf8');
  const title = /^title:\s+ak(?:\s+(.+))?$/m.exec(content)?.[1];
  if (!title) throw new Error(`Missing canonical ak title in ${file}`);

  const [group] = cliCommandSegmentsFromTitle(`ak ${title}`);
  const current = commandGroupMap.get(group);
  commandGroupMap.set(group, {
    count: (current?.count ?? 0) + 1,
    slug: group,
  });
}

const commandGroups = [...commandGroupMap.entries()].sort(([a], [b]) =>
  a.localeCompare(b),
);

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
      { value: String(commandCount), label: 'authored CLI pages' },
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
    surfaceDesc: (groups: number, pages: number) =>
      `${groups} command groups, ${pages - 1} subcommand pages, plus the root ak landing.`,
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
        desc: 'Reviewed syntax, effects, output, and recovery guidance.',
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
      { value: String(commandCount), label: 'trang CLI đã biên soạn' },
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
    surfaceDesc: (groups: number, pages: number) =>
      `${groups} nhóm lệnh, ${pages - 1} trang subcommand và trang lệnh gốc ak.`,
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
        desc: 'Cú pháp, tác động, đầu ra và hướng dẫn khôi phục đã rà soát.',
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
    <main className="relative flex flex-1 flex-col overflow-x-clip">
      {/* Brand-blue glow anchored to the terminal side of the hero. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 right-[-10%] size-[36rem] rounded-full bg-fd-primary/10 blur-[120px]"
      />
      {/* Dot-grid texture fading out below the hero. */}
      <div aria-hidden className="ak-dot-grid pointer-events-none absolute inset-x-0 top-0 h-[32rem]" />

      <div className="mx-auto w-full max-w-6xl px-6 pb-24 pt-16 md:pt-24">
        {/* Asymmetric hero: pitch left, live terminal right. */}
        <div className="grid items-center gap-10 md:grid-cols-[1.1fr_1fr] md:gap-14">
          <div>
            <Eyebrow>{t.eyebrow}</Eyebrow>
            {/* Two-tone display heading: hierarchy through color, not size. */}
            <h1 className="ak-display mb-5 text-balance font-semibold tracking-tight">
              <span className="block">{t.titleA}</span>
              <span className="block text-fd-muted-foreground">{t.titleB}</span>
            </h1>
            <p className="mb-8 max-w-md text-fd-muted-foreground">{t.body}</p>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={localePath(lang, 'stable')}
                className="inline-flex items-center rounded-md bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
              >
                {t.cta}
              </Link>
              <Link
                href={localePath(lang, 'stable', 'getting-started', 'quickstart')}
                className="inline-flex items-center rounded-md border border-fd-border px-5 py-2.5 text-sm font-medium text-fd-foreground transition-colors hover:bg-fd-accent"
              >
                {t.ctaSecondary}
              </Link>
            </div>
          </div>

          <HomeTerminal
            lines={terminalLines}
            copyCommand={installCommand}
            copyLabel={t.copyLabel}
            copiedLabel={t.copiedLabel}
          />
        </div>

        {/* Stat mosaic: hairline-separated cells (gap-px over the border token). */}
        <dl className="mt-20 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-fd-border bg-fd-border md:grid-cols-4">
          {t.stats.map((stat) => (
            <div key={stat.label} className="bg-fd-background p-6">
              <dd className="font-mono text-2xl font-medium tracking-tight text-fd-foreground md:text-3xl">
                {stat.value}
              </dd>
              <dt className="mt-1.5 text-xs text-fd-muted-foreground">
                {stat.label}
              </dt>
            </div>
          ))}
        </dl>

        {/* How it works: three numbered steps, each anchored by a real command. */}
        <div className="mt-24">
          <Eyebrow>{t.howLabel}</Eyebrow>
          <ol className="grid gap-10 md:grid-cols-3 md:gap-8">
            {t.steps.map((step, i) => (
              <li key={step.title} className="border-t border-fd-border pt-6">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-sm text-fd-primary">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <h2 className="!text-base font-semibold">{step.title}</h2>
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
        </div>

        {/* Command surface: the reviewed authored CLI namespace map. Density
            is the point — this is the product. */}
        <div className="mt-24">
          <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
            <div>
              <Eyebrow>{t.surfaceLabel}</Eyebrow>
              <h2 className="!text-2xl font-semibold tracking-tight">
                {t.surfaceTitle}
              </h2>
            </div>
            <p className="font-mono text-xs text-fd-muted-foreground">
              {t.surfaceDesc(commandGroups.length, commandCount)}
            </p>
          </div>
          <ul className="mt-8 flex flex-wrap gap-2">
            {commandGroups.map(([group, commandGroup]) => (
              <li key={group}>
                <Link
                  href={localePath(
                    lang,
                    'stable',
                    'reference',
                    'cli',
                    commandGroup.slug,
                  )}
                  className="inline-flex items-baseline gap-1.5 rounded-md border border-fd-border bg-fd-card px-3 py-1.5 font-mono text-xs text-fd-foreground transition-colors hover:border-fd-primary/60 hover:text-fd-primary"
                >
                  <span className="text-fd-muted-foreground">ak</span>
                  {group}
                  {commandGroup.count > 1 && (
                    <span className="text-fd-muted-foreground">
                      {commandGroup.count}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Start-here rail: hairline-ruled rows, not cards. */}
        <div className="mt-24">
          <Eyebrow>{t.sectionLabel}</Eyebrow>
          <nav
            aria-label={t.sectionLabel}
            className="grid gap-x-14 sm:grid-cols-2"
          >
            {t.links.map((link, i) => (
              <Link
                key={link.href}
                href={localePath(lang, ...link.href.split('/'))}
                className="group flex items-baseline gap-4 border-t border-fd-border py-5 transition-colors hover:bg-fd-accent/50"
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
              </Link>
            ))}
          </nav>
        </div>

        {/* Closing band: same dark terminal material as the hero. */}
        <div className="ak-terminal relative mt-24 overflow-hidden rounded-lg border border-fd-border bg-fd-card px-8 py-12 md:px-12">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-fd-primary/15 blur-[100px]"
          />
          <div className="relative flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="!text-2xl font-semibold tracking-tight text-fd-foreground">
                {t.ctaTitle}
              </h2>
              <p className="mt-2 text-sm text-fd-muted-foreground">
                {t.ctaDesc}
              </p>
            </div>
            <div className="flex flex-col items-start gap-4 md:items-end">
              <code className="block max-w-full overflow-x-auto whitespace-nowrap font-mono text-sm text-fd-foreground">
                <span className="select-none text-fd-primary">$ </span>
                {installCommand}
              </code>
              <Link
                href={localePath(lang, 'stable')}
                className="inline-flex items-center rounded-md bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
              >
                {t.cta}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
