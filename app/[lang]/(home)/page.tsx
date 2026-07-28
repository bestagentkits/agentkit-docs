import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { i18n } from '@/lib/i18n';
import { localeAlternates, localePath } from '@/lib/locale-path';
import { HomeTerminal, type TerminalLine } from '@/components/home-terminal';
import { chakraPetch } from './font';
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
  { kind: 'cmd', text: 'ak kit init engineer --target claude-code --global' },
  { kind: 'comment', text: '# then in Claude Code: /ak:brainstorm' },
];

// Real skill invocations from the kit cheatsheets — the same /ak: names
// readers type in their assistant. Engineer and marketing skills alternate.
const marqueeSkills = [
  '/ak:brainstorm',
  '/ak:campaign',
  '/ak:scout',
  '/ak:seo',
  '/ak:plan',
  '/ak:copywriting',
  '/ak:cook',
  '/ak:email',
  '/ak:test',
  '/ak:analytics',
  '/ak:review-pr',
  '/ak:design',
  '/ak:ship',
  '/ak:research',
  '/ak:debug',
  '/ak:handoff',
  '/ak:deploy',
  '/ak:retro',
];

const cliDir = path.join(process.cwd(), 'content/docs/stable/reference/cli');

function cliHref(group: string): string | null {
  const file = path.join(cliDir, `ak_${group}.mdx`);
  return existsSync(file) ? `ak_${group}` : null;
}

// Curated operator map — real command groups from the released CLI reference,
// grouped by job instead of dumping the full alphabetical warehouse.
const operateLanes = [
  {
    id: 'lifecycle',
    groups: [
      'kit',
      'login',
      'whoami',
      'licenses',
      'self-update',
      'doctor',
      'backups',
      'recover',
    ],
  },
  {
    id: 'workspace',
    groups: ['plan', 'run', 'sessions', 'projects', 'watch', 'activity'],
  },
  {
    id: 'extend',
    groups: ['skill', 'skills', 'agents', 'commands', 'mcp'],
  },
] as const;

const commandCount = readdirSync(cliDir).filter(
  (f) => f.startsWith('ak_') && f.endsWith('.mdx'),
).length;

const copy = {
  en: {
    brand: 'AgentKit',
    titleA: 'From unclear intent',
    titleB: 'to reviewed work.',
    body: 'ak installs and runs specialist kits: bundles of skills for Claude Code, Codex, and more. Brainstorm the outcome first, then deliver with a managed lifecycle: authenticate, init a kit, update, diagnose, and recover without silent overwrites.',
    cta: 'Quickstart',
    ctaSecondary: 'Browse docs',
    copyLabel: 'Copy install command',
    copiedLabel: 'Copied',
    terminalContext: 'ak / quickstart',
    marqueeLabel: 'Skill invocations installed by the kits',
    statsLabel: 'AgentKit in numbers',
    statsCommands: 'CLI commands',
    statsKits: 'Specialist kits',
    statsChannels: 'Release channels',
    statsLocales: 'Locales',
    kitsLabel: 'Kits',
    kitsTitle: 'Two specialist kits. One shared core.',
    kitsDesc:
      'A kit is a bundle of skills for your coding assistant. Core composition stays internal; you install a child kit into a runtime.',
    kits: [
      {
        name: 'engineer',
        title: 'Engineer',
        desc: 'Software delivery and technical maintenance: scout, plan, cook, verify, and ship with engineer-unique skills.',
        meta: '98 skills · 16 agents',
        cmd: 'ak kit init engineer --target claude-code --global',
        href: 'beta/kits/engineer',
      },
      {
        name: 'marketing',
        title: 'Marketing',
        desc: 'Marketing planning and execution: campaign workflows that inherit the same lifecycle and review posture.',
        meta: '78 skills · 32 agents',
        cmd: 'ak kit init marketing --target claude-code --global',
        href: 'beta/kits/marketing',
      },
    ],
    kitLink: 'Kit cheatsheet',
    loopLabel: 'Delivery loop',
    loopTitle: 'Brainstorm first. Finish with evidence.',
    loopDesc:
      'Every kit reinforces the same sequence inside your assistant. ak owns install, inspect, update, and recovery around that work.',
    loop: [
      {
        title: 'Brainstorm',
        desc: 'Lock the outcome, constraints, options, and acceptance criteria before anything mutates the workspace.',
        skill: '/ak:brainstorm',
      },
      {
        title: 'Inspect & plan',
        desc: 'Scout the repo and plan when coordination or risk requires it.',
        skill: '/ak:scout · /ak:plan',
      },
      {
        title: 'Implement & verify',
        desc: 'Ship the smallest complete change, then prove behavior and safety.',
        skill: '/ak:cook · /ak:test',
      },
      {
        title: 'Review & finish',
        desc: 'Check the result against intent and leave clear, recoverable state.',
        skill: '/ak:git · ak doctor',
      },
    ],
    operateLabel: 'Operate with ak',
    operateTitle: 'Lifecycle around the kit, not another agent chat.',
    operateDesc: (n: number) =>
      `Curated command lanes from the ${n}-command CLI reference. Full syntax stays generated from the released binary.`,
    lanes: {
      lifecycle: {
        title: 'Lifecycle',
        desc: 'Auth, kit install, health, updates, backups, recovery.',
      },
      workspace: {
        title: 'Workspace',
        desc: 'Plans, runs, sessions, projects, and live activity.',
      },
      extend: {
        title: 'Extend',
        desc: 'Skills, agents, slash commands, and MCP surfaces.',
      },
    },
    operateAll: 'Full CLI reference',
    startLabel: 'Start here',
    links: [
      {
        title: 'Installation',
        desc: 'Install and verify ak on macOS, Linux, or Windows.',
        href: 'stable/getting-started/installation',
      },
      {
        title: 'Quickstart',
        desc: 'Authenticate, init a kit, invoke a skill.',
        href: 'stable/getting-started/quickstart',
      },
      {
        title: 'Kits',
        desc: 'Engineer and Marketing cheatsheets.',
        href: 'beta/kits',
      },
      {
        title: 'Installing kits',
        desc: 'Targets, skill selection, refresh, uninstall.',
        href: 'stable/guides/installing-kits',
      },
      {
        title: 'Updating ak',
        desc: 'Channels, changelog, rollback.',
        href: 'stable/guides/updating',
      },
      {
        title: 'CLI commands',
        desc: 'Every command and flag from the released binary.',
        href: 'stable/reference/cli',
      },
    ],
    closeTitle: 'Install once. Work inside your assistant.',
    closeDesc: 'Signed binary, verified artifacts, managed updates.',
  },
  vi: {
    brand: 'AgentKit',
    titleA: 'Từ ý định chưa rõ đến',
    titleB: 'kết quả đã review.',
    body: 'ak cài và chạy các kit chuyên biệt: gói skill cho Claude Code, Codex, and more. Brainstorm kết quả trước, rồi giao việc với vòng đời được quản lý: xác thực, init kit, cập nhật, chẩn đoán và phục hồi mà không ghi đè thầm lặng.',
    cta: 'Khởi động nhanh',
    ctaSecondary: 'Duyệt tài liệu',
    copyLabel: 'Sao chép lệnh cài đặt',
    copiedLabel: 'Đã sao chép',
    terminalContext: 'ak / quickstart',
    marqueeLabel: 'Các skill invocation được cài bởi kit',
    statsLabel: 'AgentKit qua con số',
    statsCommands: 'Lệnh CLI',
    statsKits: 'Kit chuyên biệt',
    statsChannels: 'Kênh phát hành',
    statsLocales: 'Ngôn ngữ',
    kitsLabel: 'Kits',
    kitsTitle: 'Hai kit chuyên biệt. Một core dùng chung.',
    kitsDesc:
      'Kit là gói skill cho coding assistant. Core composition là nội bộ; bạn cài child kit vào một runtime.',
    kits: [
      {
        name: 'engineer',
        title: 'Engineer',
        desc: 'Giao phần mềm và bảo trì kỹ thuật: scout, plan, cook, verify, ship với skill riêng của engineer.',
        meta: '98 skills · 16 agents',
        cmd: 'ak kit init engineer --target claude-code --global',
        href: 'beta/kits/engineer',
      },
      {
        name: 'marketing',
        title: 'Marketing',
        desc: 'Lập kế hoạch và thực thi marketing: workflow chiến dịch kế thừa cùng vòng đời và tư thế review.',
        meta: '78 skills · 32 agents',
        cmd: 'ak kit init marketing --target claude-code --global',
        href: 'beta/kits/marketing',
      },
    ],
    kitLink: 'Cheatsheet kit',
    loopLabel: 'Vòng giao việc',
    loopTitle: 'Brainstorm trước. Kết thúc bằng bằng chứng.',
    loopDesc:
      'Mọi kit củng cố cùng một chuỗi bên trong assistant. ak quản lý cài đặt, kiểm tra, cập nhật và phục hồi quanh công việc đó.',
    loop: [
      {
        title: 'Brainstorm',
        desc: 'Chốt kết quả, ràng buộc, lựa chọn và tiêu chí chấp nhận trước khi workspace thay đổi.',
        skill: '/ak:brainstorm',
      },
      {
        title: 'Inspect & plan',
        desc: 'Scout repo và lập kế hoạch khi cần phối hợp hoặc có rủi ro.',
        skill: '/ak:scout · /ak:plan',
      },
      {
        title: 'Implement & verify',
        desc: 'Ship thay đổi nhỏ nhất đủ hoàn chỉnh, rồi chứng minh hành vi và an toàn.',
        skill: '/ak:cook · /ak:test',
      },
      {
        title: 'Review & finish',
        desc: 'Đối chiếu kết quả với ý định và để lại trạng thái rõ, phục hồi được.',
        skill: '/ak:git · ak doctor',
      },
    ],
    operateLabel: 'Vận hành với ak',
    operateTitle: 'Vòng đời quanh kit, không phải thêm một agent chat.',
    operateDesc: (n: number) =>
      `Các nhóm lệnh theo việc từ reference CLI ${n} lệnh. Cú pháp đầy đủ được sinh từ binary đã phát hành.`,
    lanes: {
      lifecycle: {
        title: 'Vòng đời',
        desc: 'Auth, cài kit, health, cập nhật, backup, phục hồi.',
      },
      workspace: {
        title: 'Workspace',
        desc: 'Plan, run, session, project và activity.',
      },
      extend: {
        title: 'Mở rộng',
        desc: 'Skill, agent, slash command và MCP.',
      },
    },
    operateAll: 'Toàn bộ CLI reference',
    startLabel: 'Bắt đầu từ đây',
    links: [
      {
        title: 'Cài đặt',
        desc: 'Cài và xác minh ak trên macOS, Linux hoặc Windows.',
        href: 'stable/getting-started/installation',
      },
      {
        title: 'Khởi động nhanh',
        desc: 'Xác thực, init kit, gọi skill.',
        href: 'stable/getting-started/quickstart',
      },
      {
        title: 'Kits',
        desc: 'Cheatsheet Engineer và Marketing.',
        href: 'beta/kits',
      },
      {
        title: 'Cài kit',
        desc: 'Target, chọn skill, refresh, gỡ cài.',
        href: 'stable/guides/installing-kits',
      },
      {
        title: 'Cập nhật ak',
        desc: 'Kênh, changelog, rollback.',
        href: 'stable/guides/updating',
      },
      {
        title: 'Lệnh CLI',
        desc: 'Mọi lệnh và flag từ binary đã phát hành.',
        href: 'stable/reference/cli',
      },
    ],
    closeTitle: 'Cài một lần. Làm việc trong assistant.',
    closeDesc: 'Binary có chữ ký, artifact được xác minh, cập nhật có quản lý.',
  },
} as const;

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="ak-eyebrow mb-4">{children}</p>;
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

  const lanes = operateLanes.map((lane) => {
    const groups: { group: string; slug: string }[] = [];
    for (const group of lane.groups) {
      const slug = cliHref(group);
      if (slug) groups.push({ group, slug });
    }
    return {
      id: lane.id,
      ...t.lanes[lane.id],
      groups,
    };
  });

  return (
    <main
      className={`ak-home relative flex flex-1 flex-col overflow-x-clip ${chakraPetch.variable}`}
    >
      <section className="ak-hero" aria-labelledby="ak-home-title">
        <div className="ak-hero-inner">
          <div className="ak-hero-copy">
            <h1
              id="ak-home-title"
              className="ak-display font-semibold tracking-tight"
            >
              {t.titleA}{' '}
              <span className="ak-display-accent">{t.titleB}</span>
            </h1>
            <p className="ak-hero-body text-fd-muted-foreground">{t.body}</p>
            <div className="ak-primary-actions flex flex-wrap items-center gap-3">
              <Link
                href={localePath(
                  lang,
                  'stable',
                  'getting-started',
                  'quickstart',
                )}
                className="ak-button-primary inline-flex min-h-11 items-center rounded-md bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground"
              >
                {t.cta}
              </Link>
              <Link
                href={localePath(lang, 'stable')}
                className="ak-button-secondary inline-flex min-h-11 items-center rounded-md border px-5 py-2.5 text-sm font-medium text-fd-foreground"
              >
                {t.ctaSecondary}
              </Link>
            </div>
          </div>

          <div className="min-w-0">
            <HomeTerminal
              lines={terminalLines}
              copyCommand={installCommand}
              copyLabel={t.copyLabel}
              copiedLabel={t.copiedLabel}
              context={t.terminalContext}
              meta={channels.stable.tag}
            />
          </div>
        </div>
      </section>

      {/* Skill ticker — real /ak: invocations from the kit cheatsheets.
          Decorative, pausable on hover. */}
      <div className="ak-marquee" aria-hidden="true">
        <div className="ak-marquee-track">
          {[0, 1].map((dup) => (
            <div className="ak-marquee-seq" key={dup}>
              {marqueeSkills.map((skill) => (
                <span key={skill} className="ak-marquee-item font-mono">
                  <span className="ak-marquee-dot" aria-hidden>
                    ◆
                  </span>
                  {skill}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="ak-home-shell">
        <section className="ak-stats" aria-label={t.statsLabel}>
          <dl className="ak-stats-grid">
            <div className="ak-stat">
              <dd className="font-mono">{commandCount}</dd>
              <dt>{t.statsCommands}</dt>
            </div>
            <div className="ak-stat">
              <dd className="font-mono">2</dd>
              <dt>{t.statsKits}</dt>
            </div>
            <div className="ak-stat">
              <dd className="font-mono">2</dd>
              <dt>{t.statsChannels}</dt>
            </div>
            <div className="ak-stat">
              <dd className="font-mono">EN · VI</dd>
              <dt>{t.statsLocales}</dt>
            </div>
          </dl>
        </section>

        <section
          className="ak-section ak-section-tint"
          aria-labelledby="ak-kits-title"
        >
          <header className="ak-section-head">
            <Eyebrow>{t.kitsLabel}</Eyebrow>
            <h2
              id="ak-kits-title"
              className="!text-2xl font-semibold tracking-tight md:!text-3xl"
            >
              {t.kitsTitle}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-fd-muted-foreground">
              {t.kitsDesc}
            </p>
          </header>
          <ul className="ak-kit-grid">
            {t.kits.map((kit) => (
              <li key={kit.name}>
                <div className="ak-kit-head">
                  <h3 className="!text-lg font-semibold tracking-tight">
                    {kit.title}
                  </h3>
                  <Link
                    href={localePath(lang, ...kit.href.split('/'))}
                    className="inline-flex min-h-11 items-center gap-1 font-mono text-xs text-fd-primary"
                  >
                    {t.kitLink}
                    <ArrowUpRight aria-hidden className="size-3.5" />
                  </Link>
                </div>
                <p className="mb-4 mt-3 text-sm leading-6 text-fd-muted-foreground">
                  {kit.desc}
                </p>
                <p className="ak-kit-meta mb-6 font-mono">{kit.meta}</p>
                <code className="ak-cmd mt-auto block overflow-x-auto whitespace-nowrap font-mono text-xs">
                  <span className="select-none" aria-hidden>
                    ${' '}
                  </span>
                  {kit.cmd}
                </code>
              </li>
            ))}
          </ul>
        </section>

        <section className="ak-section" aria-labelledby="ak-loop-title">
          <header className="ak-section-head">
            <Eyebrow>{t.loopLabel}</Eyebrow>
            <h2
              id="ak-loop-title"
              className="!text-2xl font-semibold tracking-tight md:!text-3xl"
            >
              {t.loopTitle}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-fd-muted-foreground">
              {t.loopDesc}
            </p>
          </header>
          <ol className="ak-loop-track">
            {t.loop.map((step, index) => (
              <li key={step.title}>
                <span className="ak-loop-index font-mono font-medium">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3 className="!text-base font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-fd-muted-foreground">
                  {step.desc}
                </p>
                <code className="mt-3 block font-mono text-xs text-fd-foreground">
                  {step.skill}
                </code>
              </li>
            ))}
          </ol>
        </section>

        <section
          className="ak-section ak-section-tint"
          aria-labelledby="ak-operate-title"
        >
          <header className="ak-section-head">
            <Eyebrow>{t.operateLabel}</Eyebrow>
            <h2
              id="ak-operate-title"
              className="!text-2xl font-semibold tracking-tight md:!text-3xl"
            >
              {t.operateTitle}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-fd-muted-foreground">
              {t.operateDesc(commandCount)}
            </p>
          </header>
          <div className="ak-operate-lanes">
            {lanes.map((lane) => (
              <div key={lane.id} className="ak-operate-lane">
                <div className="ak-operate-lane-head">
                  <h3 className="!text-sm font-semibold">{lane.title}</h3>
                  <p className="mt-1 text-xs leading-5 text-fd-muted-foreground">
                    {lane.desc}
                  </p>
                </div>
                <ul>
                  {lane.groups.map(({ group, slug }) => (
                    <li key={group}>
                      <Link
                        href={localePath(
                          lang,
                          'stable',
                          'reference',
                          'cli',
                          slug,
                        )}
                        className="group inline-flex min-h-11 items-center gap-1.5 font-mono text-xs text-fd-foreground transition-colors hover:text-fd-primary"
                      >
                        <span className="text-fd-muted-foreground">ak</span>
                        {group}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="ak-operate-foot">
            <Link
              href={localePath(lang, 'stable', 'reference', 'cli')}
              className="inline-flex min-h-11 items-center gap-1 font-mono text-xs text-fd-primary"
            >
              {t.operateAll}
              <ArrowUpRight aria-hidden className="size-3.5" />
            </Link>
          </div>
        </section>

        <section className="ak-section" aria-labelledby="ak-start-title">
          <header className="ak-section-head">
            <h2
              id="ak-start-title"
              className="!text-2xl font-semibold tracking-tight md:!text-3xl"
            >
              {t.startLabel}
            </h2>
          </header>
          <nav aria-label={t.startLabel} className="ak-start-links">
            {t.links.map((link) => (
              <Link
                key={link.href}
                href={localePath(lang, ...link.href.split('/'))}
                className="group flex min-h-20 items-baseline gap-4 py-5"
              >
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
        </section>
      </div>

      <section className="ak-close-band">
        <div className="ak-close-inner">
          <h2 className="ak-close-title font-semibold tracking-tight">
            {t.closeTitle}
          </h2>
          <p className="ak-close-desc text-fd-muted-foreground">
            {t.closeDesc}
          </p>
          <div className="ak-close-actions">
            <code className="ak-cmd block max-w-full overflow-x-auto whitespace-nowrap font-mono text-xs">
              <span className="select-none" aria-hidden>
                ${' '}
              </span>
              {installCommand}
            </code>
            <Link
              href={localePath(lang, 'stable', 'getting-started', 'quickstart')}
              className="ak-button-primary inline-flex min-h-11 items-center rounded-md bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground"
            >
              {t.cta}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
