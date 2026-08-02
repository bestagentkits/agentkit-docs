// Compile the CLI reference index into a grouped table of contents, derived
// purely from the raw pages' frontmatter (title + description). Commands are
// grouped by family (`ak kit …`, `ak mcp …`); families without subcommands
// collapse into one standalone table. Deterministic: sorted input → stable
// output, so the regenerate-and-diff CI check keeps holding.

import { escapeCell, escapeText } from './normalize-reference.mjs';

/** @param {string} title e.g. "ak kit install" → family "kit" ("" for root) */
function familyOf(title) {
  return title.split(' ')[1] ?? '';
}

function tableOf(rows) {
  const out = ['| Command | Description |', '| --- | --- |'];
  for (const { slug, title, description } of rows) {
    out.push(`| [\`${title}\`](./${slug}) | ${escapeCell(description)} |`);
  }
  return out.join('\n');
}

/**
 * @param {Array<{slug: string, title: string, description: string}>} pages
 *   one entry per derived command page (the root `ak` page included)
 * @returns {string} MDX body for the index page (no frontmatter)
 */
export function buildIndexBody(pages) {
  const sorted = [...pages].sort((a, b) => a.title.localeCompare(b.title, 'en'));

  const byFamily = new Map();
  for (const p of sorted) {
    const fam = familyOf(p.title);
    if (!byFamily.has(fam)) byFamily.set(fam, []);
    byFamily.get(fam).push(p);
  }

  const standalone = [];
  const groups = [];
  for (const [fam, members] of byFamily) {
    if (fam === '' || members.length === 1) standalone.push(...members);
    else groups.push({ fam, members });
  }
  standalone.sort((a, b) => a.title.localeCompare(b.title, 'en'));

  const parts = [
    'Generated reference for every `ak` command and flag, produced from the released',
    "binary's command tree — so it never drifts from what you run. Global flags,",
    'output modes, and standard exit codes are documented once in',
    '[CLI conventions](../cli-conventions).',
  ].join('\n');

  const sections = [parts];
  if (standalone.length) sections.push('## Commands', tableOf(standalone));
  for (const { members } of groups) {
    // the family parent (e.g. `ak kit`) leads its own section
    const parent = members.find((m) => m.title.split(' ').length === 2) ?? members[0];
    sections.push(`## \`${parent.title}\` — ${escapeText(parent.description)}`, tableOf(members));
  }
  return sections.join('\n\n') + '\n';
}
