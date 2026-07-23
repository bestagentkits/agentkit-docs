import { escapeText } from './normalize-reference.mjs';

const ACCORDION_THRESHOLD = 6;

function pickProse(proseEntry, skill, locale) {
  if (!proseEntry) {
    return {
      overview: skill.descriptionRaw,
      whenToUse: skill.whenToUseRaw || skill.descriptionRaw,
    };
  }
  if (locale === 'vi') {
    return {
      overview: proseEntry.overviewVi || proseEntry.overview || skill.descriptionRaw,
      whenToUse: proseEntry.whenToUseVi || proseEntry.whenToUse || skill.whenToUseRaw || skill.descriptionRaw,
    };
  }
  return {
    overview: proseEntry.overview || skill.descriptionRaw,
    whenToUse: proseEntry.whenToUse || skill.whenToUseRaw || skill.descriptionRaw,
  };
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

function renderSkillRow(skill, proseEntry, locale) {
  const { overview, whenToUse } = pickProse(proseEntry, skill, locale);
  const whenLabel = locale === 'vi' ? 'Khi nào dùng' : 'When to use';
  return [
    `### \`${skill.slash}\``,
    '',
    escapeText(overview),
    '',
    `**${whenLabel}:** ${escapeText(whenToUse)}`,
    '',
  ].join('\n');
}

function renderCategoryBlock(title, skills, proseBySlug, locale) {
  const body = skills
    .map((skill) => renderSkillRow(skill, proseBySlug[skill.slug], locale))
    .join('\n');

  if (skills.length >= ACCORDION_THRESHOLD) {
    return [`<Accordion title="${escapeText(title)} (${skills.length})">`, body, '</Accordion>'].join('\n');
  }
  return [`## ${title}`, '', body].join('\n');
}

export function renderKitCatalogMdx({ kit, skills, proseBySlug, locale }) {
  const groups = groupByCategory(skills);
  const accordionBlocks = groups.filter(([, items]) => items.length >= ACCORDION_THRESHOLD);
  const plainBlocks = groups.filter(([, items]) => items.length < ACCORDION_THRESHOLD);

  const parts = [
    locale === 'vi'
      ? 'Danh mục skill theo thể loại. Mỗi mục ghi lệnh slash, tóm tắt và gợi ý khi nào dùng.'
      : 'Skill catalog grouped by category. Each entry lists the slash command, a short overview, and when to use it.',
    '',
  ];

  for (const [cat, items] of plainBlocks) {
    parts.push(renderCategoryBlock(cat, items, proseBySlug, locale));
    parts.push('');
  }

  if (accordionBlocks.length) {
    parts.push('<Accordions type="multiple">');
    for (const [cat, items] of accordionBlocks) {
      parts.push(renderCategoryBlock(cat, items, proseBySlug, locale));
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
          'Xem [Cài đặt kit](./guides/installing-kits) để chọn runtime và skill.',
          '',
          '## Kit có sẵn',
          '',
        ]
      : [
          'A **kit** is a bundle of skills for a coding assistant. AgentKit distributes kits through the registry; install with `ak kit init`.',
          '',
          'See [Installing kits](./guides/installing-kits) for runtime targets and skill selection.',
          '',
          '## Available kits',
          '',
        ];

  const rows = kits.map((kit) => {
    const label = locale === 'vi' ? 'skill' : 'skills';
    const agentLabel = locale === 'vi' ? 'agent' : 'agents';
    return `- [**${kit.title}**](./${kit.id}) — ${kit.counts.skills} ${label}, ${kit.counts.agents} ${agentLabel}. ${escapeText(kit.description)}`;
  });

  return [...intro, ...rows, ''].join('\n');
}

export function kitPageFrontmatter({ kit, locale, page, withAccordion = false }) {
  const titles = {
    engineer: { en: 'Engineer kit', vi: 'Kit Engineer' },
    marketing: { en: 'Marketing kit', vi: 'Kit Marketing' },
    index: { en: 'Kits', vi: 'Kit' },
  };
  const title = titles[page]?.[locale] ?? kit.name;
  const description =
    page === 'index'
      ? locale === 'vi'
        ? 'Tổng quan kit AgentKit — Engineer và Marketing.'
        : 'AgentKit kits overview — Engineer and Marketing.'
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
  const trainLabel = locale === 'vi' ? 'Train' : 'Train';

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
