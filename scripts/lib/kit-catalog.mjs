import { escapeText } from './normalize-reference.mjs';
import { resolveBriefLocale } from './kit-brief.mjs';

const ACCORDION_THRESHOLD = 6;

const CATEGORY_VI = {
  utilities: 'Tiện ích',
  'dev-tools': 'Công cụ dev',
  'ai-ml': 'AI / ML',
  backend: 'Backend',
  database: 'Cơ sở dữ liệu',
  frameworks: 'Framework',
  frontend: 'Frontend',
  design: 'Thiết kế',
  testing: 'Kiểm thử',
  marketing: 'Marketing',
  content: 'Nội dung',
  Other: 'Khác',
  other: 'Khác',
};

function categoryLabel(cat, locale) {
  if (locale !== 'vi') return cat;
  return CATEGORY_VI[cat] || cat;
}

function groupByCategory(skills) {
  const groups = new Map();
  for (const skill of skills) {
    const cat = skill.category || 'Other';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(skill);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function slashForSlug(slug) {
  if (!slug) return '';
  if (slug.startsWith('ak-')) return `/ak:${slug.slice(3)}`;
  return `/${slug}`;
}

function renderTokenList(items, emptySkip = true) {
  if (!items?.length) return emptySkip ? '' : '';
  const lines = items
    .filter((f) => f.name)
    .map((f) => {
      const desc = f.desc?.trim();
      return desc
        ? `- \`${escapeText(f.name)}\` — ${escapeText(desc)}`
        : `- \`${escapeText(f.name)}\``;
    });
  return lines.length ? lines.join('\n') : '';
}

/**
 * Compact cheatsheet block for one skill.
 * syntax · description · usage per adapter · flags · when-to-use · see-also
 */
export function renderSkillCheatsheet(skill, briefEntry, locale) {
  const brief = resolveBriefLocale(briefEntry, locale);
  const slash = skill.slash || slashForSlug(skill.slug);
  const overview =
    brief?.overview || skill.descriptionRaw || '';
  const whenToUse =
    brief?.whenToUse || skill.whenToUseRaw || overview;
  const whenLabel = locale === 'vi' ? 'Khi nào dùng' : 'When to use';
  const usageLabel = locale === 'vi' ? 'Cách gọi' : 'Usage';
  const flagsLabel = locale === 'vi' ? 'Cờ' : 'Flags';
  const subsLabel = locale === 'vi' ? 'Lệnh con' : 'Subcommands';
  const seeLabel = locale === 'vi' ? 'Xem thêm' : 'See also';
  const guideLabel = locale === 'vi' ? 'Hướng dẫn' : 'Guide';

  const inv = brief?.invocation ?? {
    'claude-code': slash,
    codex: skill.name?.startsWith('ak:') ? `$${skill.name}` : '',
  };

  const parts = [
    `### \`${slash}\``,
    '',
    escapeText(overview),
    '',
    `**${usageLabel}**`,
    '',
    `| | |`,
    `| --- | --- |`,
    `| Claude Code | \`${escapeText(inv['claude-code'] || slash)}\` |`,
    `| Codex | \`${escapeText(inv.codex || '')}\` |`,
    '',
  ];

  const flagBlock = renderTokenList(brief?.flags);
  if (flagBlock) {
    parts.push(`**${flagsLabel}**`, '', flagBlock, '');
  }

  const subBlock = renderTokenList(brief?.subcommands);
  if (subBlock) {
    parts.push(`**${subsLabel}**`, '', subBlock, '');
  }

  parts.push(`**${whenLabel}:** ${escapeText(whenToUse)}`, '');

  const related = brief?.related ?? [];
  if (related.length) {
    const links = related.map((slug) => `\`${slashForSlug(slug)}\``).join(', ');
    parts.push(`**${seeLabel}:** ${links}`, '');
  }

  if (brief?.guide) {
    parts.push(`**${guideLabel}:** [${escapeText(brief.guide)}](${brief.guide})`, '');
  }

  return parts.join('\n');
}

function renderCategoryBlock(title, skills, briefsBySlug, locale) {
  const body = skills
    .map((skill) => renderSkillCheatsheet(skill, briefsBySlug[skill.slug], locale))
    .join('\n');

  const label = categoryLabel(title, locale);
  if (skills.length >= ACCORDION_THRESHOLD) {
    return [
      `<Accordion title="${escapeText(label)} (${skills.length})">`,
      body,
      '</Accordion>',
    ].join('\n');
  }
  return [`## ${escapeText(label)}`, '', body].join('\n');
}

export function renderKitCatalogMdx({ skills, briefsBySlug, locale }) {
  const groups = groupByCategory(skills);
  const accordionBlocks = groups.filter(([, items]) => items.length >= ACCORDION_THRESHOLD);
  const plainBlocks = groups.filter(([, items]) => items.length < ACCORDION_THRESHOLD);

  const parts = [
    locale === 'vi'
      ? 'Bảng tra skill gọn theo thể loại. Mỗi mục: cú pháp, mô tả, cách gọi theo adapter (Claude Code `/ak:…`, Codex `$ak:…`), cờ/lệnh con (kèm giải thích khi có), khi nào dùng, và liên kết liên quan.'
      : 'Compact skill cheatsheet grouped by category. Each entry: syntax, description, adapter usage (Claude Code `/ak:…`, Codex `$ak:…`), flags/subcommands with explanations when the source provides them, when to use, and related skills.',
    '',
  ];

  for (const [cat, items] of plainBlocks) {
    parts.push(renderCategoryBlock(cat, items, briefsBySlug, locale));
    parts.push('');
  }

  if (accordionBlocks.length) {
    parts.push('<Accordions type="multiple">');
    for (const [cat, items] of accordionBlocks) {
      parts.push(renderCategoryBlock(cat, items, briefsBySlug, locale));
    }
    parts.push('</Accordions>');
  }

  return parts.join('\n').trim() + '\n';
}

export function renderKitIndexMdx({ kits, locale }) {
  const intro =
    locale === 'vi'
      ? [
          '**Kit** là gói skill cho trợ lý mã hoá. AgentKit phân phối kit qua registry; bạn cài bằng `ak kit init`.',
          '',
          'Mỗi trang kit là **bảng tra (cheatsheet)** — cú pháp, cách gọi theo adapter, cờ, và khi nào dùng. Phiên bản hiển thị là semver của kit (`kit.yaml`), không phải train beta/stable.',
          '',
          'Xem [Cài đặt kit](../guides/installing-kits) để chọn runtime và skill.',
          '',
          '## Kit có sẵn',
          '',
        ]
      : [
          'A **kit** is a bundle of skills for a coding assistant. AgentKit distributes kits through the registry; install with `ak kit init`.',
          '',
          'Each kit page is a **cheatsheet** — syntax, adapter invocations, flags, and when to use each skill. The version shown is the kit content semver from `kit.yaml`, not the beta/stable train.',
          '',
          'See [Installing kits](../guides/installing-kits) for runtime targets and skill selection.',
          '',
          '## Available kits',
          '',
        ];

  const rows = kits.map((kit) => {
    const label = locale === 'vi' ? 'skill' : 'skills';
    const agentLabel = locale === 'vi' ? 'agent' : 'agents';
    return `- [**${kit.title}**](./${kit.id}) — \`${kit.version}\` · ${kit.counts.skills} ${label}, ${kit.counts.agents} ${agentLabel}. ${escapeText(kit.description)}`;
  });

  return [...intro, ...rows, ''].join('\n');
}

export function kitPageFrontmatter({ kit, locale, page, withAccordion = false }) {
  const titles = {
    engineer: { en: 'Engineer kit', vi: 'Kit kỹ sư' },
    marketing: { en: 'Marketing kit', vi: 'Kit marketing' },
    index: { en: 'Kits', vi: 'Kits' },
  };
  const title = titles[page]?.[locale] ?? kit.name;
  const description =
    page === 'index'
      ? locale === 'vi'
        ? 'Tổng quan kit AgentKit — bảng tra Engineer và Marketing.'
        : 'AgentKit kits overview — Engineer and Marketing cheatsheets.'
      : kit.description;

  const imports = withAccordion
    ? "import { Accordion, Accordions } from 'fumadocs-ui/components/accordion';\n\n"
    : '';

  return `---
title: "${title.replace(/"/g, '\\"')}"
description: "${description.replace(/"/g, '\\"')}"
generated: true
---
${imports}`;
}

export function renderKitOverviewMdx({ kit, locale }) {
  const skillLabel = locale === 'vi' ? 'Skill' : 'Skills';
  const agentLabel = locale === 'vi' ? 'Agent' : 'Agents';
  const versionLabel = locale === 'vi' ? 'Phiên bản kit' : 'Kit version';
  const tierLabel = locale === 'vi' ? 'Gói' : 'Tier';
  const trainLabel = locale === 'vi' ? 'Giao trong train' : 'Delivered in train';

  return [
    `| | |`,
    `| --- | --- |`,
    `| ${versionLabel} | \`${kit.version}\` |`,
    `| ${trainLabel} | \`${kit.generatedFrom.train}\` |`,
    `| ${tierLabel} | ${kit.tier} |`,
    `| ${skillLabel} | ${kit.counts.skills} |`,
    `| ${agentLabel} | ${kit.counts.agents} |`,
    '',
    escapeText(kit.description),
    '',
  ].join('\n');
}
