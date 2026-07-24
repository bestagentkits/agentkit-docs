import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSkillBrief,
  flagsFromArgumentHint,
  subcommandsFromArgumentHint,
  extractFlagDescriptions,
  extractRelatedSlugs,
  buildInvocation,
} from './lib/kit-prose.mjs';
import { resolveBriefLocale } from './lib/kit-brief.mjs';
import { renderSkillCheatsheet } from './lib/kit-catalog.mjs';

test('flagsFromArgumentHint collects --tokens', () => {
  const flags = flagsFromArgumentHint(
    '[task] [--fast|--hard|--deep] [--html] [--wiki]',
  );
  assert.deepEqual(flags, ['--fast', '--hard', '--deep', '--html', '--wiki']);
});

test('subcommandsFromArgumentHint keeps OR lists, skips free-form placeholders', () => {
  const subs = subcommandsFromArgumentHint(
    '[audit|keywords|pseo|optimize|schema] [target]',
  );
  assert.deepEqual(subs, ['audit', 'keywords', 'pseo', 'optimize', 'schema']);

  const verbs = subcommandsFromArgumentHint('cm|cp|pr|merge|merge-pr [args]');
  assert.deepEqual(verbs, ['cm', 'cp', 'pr', 'merge', 'merge-pr']);
});

test('extractFlagDescriptions reads bullets and tables', () => {
  const body = `
## Flags
- \`--fast\`: Skip research, scout→plan→code
- \`--auto\` — Auto-approve all steps

| Subcommand | Description |
| --- | --- |
| \`audit\` | Technical SEO audit |
| \`keywords\` | Keyword research |
`;
  const map = extractFlagDescriptions(body);
  assert.equal(map.get('--fast'), 'Skip research, scout→plan→code');
  assert.equal(map.get('--auto'), 'Auto-approve all steps');
  assert.equal(map.get('audit'), 'Technical SEO audit');
});

test('extractRelatedSlugs finds adapter forms, excludes self', () => {
  const body = 'Hand off to `/ak:plan` then `$ak:cook`. Also `ak:test`. Self `/ak:brainstorm`.';
  assert.deepEqual(extractRelatedSlugs(body, 'ak-brainstorm'), [
    'ak-plan',
    'ak-cook',
    'ak-test',
  ]);
});

test('buildInvocation uses slash and dollar forms', () => {
  assert.deepEqual(buildInvocation('ak:cook', '[task] [--fast]'), {
    'claude-code': '/ak:cook [task] [--fast]',
    codex: '$ak:cook [task] [--fast]',
  });
});

test('buildSkillBrief is FAITHFUL and compact for thin skills', () => {
  const brief = buildSkillBrief({
    skill: {
      slug: 'ak-seo',
      name: 'ak:seo',
      slash: '/ak:seo',
      descriptionRaw: 'SEO audits and keyword research.',
      whenToUseRaw: '',
      contentHash: 'abc',
    },
    source: {
      descriptionRaw: 'SEO audits and keyword research.',
      whenToUseRaw: '',
      argumentHint: '[audit|keywords] [target]',
      body: `# SEO\n\nTechnical SEO tooling.\n\n| Subcommand | Description |\n| --- | --- |\n| \`audit\` | Technical SEO audit |\n`,
    },
    train: '2.5.0-beta.5',
  });

  assert.equal(brief.schemaVersion, 1);
  assert.equal(brief.slug, 'ak-seo');
  assert.equal(brief.overview, 'SEO audits and keyword research.');
  assert.equal(brief.invocation['claude-code'], '/ak:seo [audit|keywords] [target]');
  assert.equal(brief.invocation.codex, '$ak:seo [audit|keywords] [target]');
  assert.deepEqual(
    brief.subcommands.map((s) => s.name),
    ['audit', 'keywords'],
  );
  assert.equal(brief.subcommands[0].desc, 'Technical SEO audit');
  assert.equal(brief.provenance.contentHash, 'abc');
  assert.equal(brief.guide, null);
});

test('resolveBriefLocale falls back to EN and overlays VI prose', () => {
  const entry = {
    en: {
      overview: 'EN overview',
      whenToUse: 'EN when',
      flags: [{ name: '--fast', desc: 'EN fast' }],
      subcommands: [],
      invocation: { 'claude-code': '/ak:x', codex: '$ak:x' },
    },
    vi: {
      overview: 'VI overview',
      flags: [{ name: '--fast', desc: 'VI nhanh' }],
    },
  };
  const vi = resolveBriefLocale(entry, 'vi');
  assert.equal(vi.overview, 'VI overview');
  assert.equal(vi.whenToUse, 'EN when');
  assert.equal(vi.flags[0].desc, 'VI nhanh');
  assert.equal(resolveBriefLocale(entry, 'en').overview, 'EN overview');
});

test('renderSkillCheatsheet includes both adapters and flags', () => {
  const mdx = renderSkillCheatsheet(
    {
      slug: 'ak-cook',
      name: 'ak:cook',
      slash: '/ak:cook',
      descriptionRaw: 'Implement features.',
      whenToUseRaw: 'When scope is clear.',
    },
    {
      en: {
        overview: 'Implement features.',
        whenToUse: 'When scope is clear.',
        invocation: {
          'claude-code': '/ak:cook [task] [--fast]',
          codex: '$ak:cook [task] [--fast]',
        },
        flags: [{ name: '--fast', desc: 'Skip research' }],
        subcommands: [],
        related: ['ak-plan'],
        guide: null,
      },
      vi: null,
    },
    'en',
  );
  assert.match(mdx, /Claude Code/);
  assert.match(mdx, /Codex/);
  assert.match(mdx, /\$ak:cook/);
  assert.match(mdx, /`--fast` — Skip research/);
  assert.match(mdx, /See also/);
  assert.match(mdx, /\/ak:plan/);
});
