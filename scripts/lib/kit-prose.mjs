import { readFile } from 'node:fs/promises';
import { splitFrontmatter, frontmatterValue } from './normalize-reference.mjs';

/** First non-empty paragraph after frontmatter — faithful excerpt only. */
export function firstBodyParagraph(body) {
  const lines = body.split('\n');
  const buf = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (buf.length) break;
      continue;
    }
    if (t.startsWith('#') || t.startsWith('```') || t.startsWith('<')) {
      if (buf.length) break;
      continue;
    }
    buf.push(t);
  }
  return buf.join(' ').replace(/\s+/g, ' ').trim();
}

export function buildFaithfulProse({ descriptionRaw, whenToUseRaw, body }) {
  const overview =
    descriptionRaw.trim() ||
    firstBodyParagraph(body) ||
    'Skill documentation is available in the kit source.';

  let whenToUse = whenToUseRaw.trim();
  if (!whenToUse) {
    const excerpt = firstBodyParagraph(body);
    if (excerpt && excerpt !== overview) whenToUse = excerpt;
    else whenToUse = `Use when ${overview.charAt(0).toLowerCase()}${overview.slice(1)}`;
  }

  return { overview, whenToUse };
}

/**
 * Collect flag tokens from an argument-hint string.
 * Example: "[task] [--fast|--hard] [--html]" → ["--fast","--hard","--html"]
 */
export function flagsFromArgumentHint(hint) {
  if (!hint) return [];
  const seen = new Set();
  const out = [];
  for (const m of hint.matchAll(/--[\w-]+/g)) {
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    out.push(m[0]);
  }
  return out;
}

const PLACEHOLDER_TOKEN =
  /^(task|topic|problem|path|plan-path|target|args?|prompt|url|file-path|concept|natural)$/i;
const SCRIPT_TOKEN = /\.(py|js|cjs|mjs|ts|sh|rb|go)$/i;

function pushToken(out, seen, tok) {
  const t = tok.trim().split(/\s+/)[0];
  if (!t || t.startsWith('<') || t.startsWith('--')) return;
  if (PLACEHOLDER_TOKEN.test(t)) return;
  if (SCRIPT_TOKEN.test(t)) return;
  if (seen.has(t)) return;
  seen.add(t);
  out.push(t);
}

/**
 * Positional / subcommand tokens from argument-hint.
 * Skips placeholder-like single words (task, topic) when they are clearly
 * free-form; keeps OR-lists and known CLI verbs when the hint uses them.
 */
export function subcommandsFromArgumentHint(hint) {
  if (!hint) return [];
  const seen = new Set();
  const out = [];
  // Groups like [audit|keywords|pseo] or bare audit|keywords outside flags
  for (const group of hint.matchAll(/\[([^\]\[]+)\]/g)) {
    const inner = group[1];
    // Flag groups: [--fast|--hard] — skip; but allow [--mode search|creative]
    if (/^--[\w-]+(?:\||$)/.test(inner.trim()) && !/\s/.test(inner.trim().split('|')[0])) {
      // pure flag-or list
      if (!inner.includes(' ')) continue;
    }
    if (inner.includes('--')) {
      // Only promote --mode/--command/--action value lists to subcommands
      // (not --provider auto|google|… which is a flag enum, not a verb).
      const modeVals = inner.match(/--(?:mode|command|action)\s+([\w|-]+)/);
      if (modeVals?.[1]?.includes('|')) {
        for (const part of modeVals[1].split('|')) pushToken(out, seen, part);
      }
      continue;
    }
    if (inner.includes('|')) {
      for (const part of inner.split('|')) pushToken(out, seen, part);
    }
  }
  // Leading verb list: "cm|cp|pr|merge|merge-pr [args]"
  const lead = hint.trim().match(/^([\w|-]+)(?:\s|$)/);
  if (lead && lead[1].includes('|')) {
    for (const part of lead[1].split('|')) pushToken(out, seen, part);
  }
  return out;
}

/** True when desc is just the flag name restated (e.g. `--fast` → "Fast"). */
export function isTrivialFlagDesc(name, desc) {
  const norm = (s) => s.replace(/^--?/, '').replace(/[\s_-]+/g, '').toLowerCase();
  return norm(name) === norm(desc);
}

function splitMdRow(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

function cellCode(cell) {
  const m = cell.match(/^`([^`]+)`$/);
  return m ? m[1].trim() : null;
}

/**
 * Map of flag/subcommand name → description extracted from SKILL.md body.
 * Prefers bullet/definition prose over multi-column mode matrices.
 */
export function extractFlagDescriptions(body) {
  const map = new Map();

  const record = (name, desc, { prefer = false } = {}) => {
    const n = name.trim();
    let d = desc.replace(/\s+/g, ' ').trim();
    // Strip trailing table cells accidentally captured
    d = d.replace(/\s*\|.*$/, '').trim();
    if (!n || !d) return;
    if (isTrivialFlagDesc(n, d)) return;
    if (/^-+$/.test(d)) return;
    if (!map.has(n) || prefer) map.set(n, d);
  };

  // Bullet: - `--fast`: desc  |  - `--fast` — desc  |  - **`--fast`**: desc
  for (const m of body.matchAll(
    /^[ \t]*[-*][ \t]+\*{0,2}`(--?[\w-]+|\w[\w-]*)`\*{0,2}\s*[:—–-]\s*(.+)$/gm,
  )) {
    record(m[1], m[2], { prefer: true });
  }

  // Definition-style: `cm`: Stage files…
  for (const m of body.matchAll(
    /^[ \t]*`(--?[\w-]+|\w[\w-]*)`\s*:\s+(.+)$/gm,
  )) {
    record(m[1], m[2], { prefer: true });
  }

  // Inline label (non-table): **`--fast`**: desc
  for (const m of body.matchAll(
    /(?:^|[^|])\*{0,2}`(--?[\w-]+)`\*{0,2}\s*[:—–-]\s*([^\n|]+)/g,
  )) {
    record(m[1], m[2]);
  }

  // Markdown tables: use Description/Purpose column when present; else 2nd cell
  // only when it is a real sentence-like explanation (not a mode matrix label).
  const lines = body.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^\|/.test(lines[i]) || !/^\|?\s*:?-+:?\s*\|/.test(lines[i + 1])) continue;
    const headers = splitMdRow(lines[i]).map((h) =>
      h.replace(/\*+/g, '').replace(/`/g, '').trim().toLowerCase(),
    );
    let descIdx = headers.findIndex((h) =>
      /^(description|purpose|meaning|summary|what it does)$/.test(h),
    );
    if (descIdx < 0) {
      // Subcommand tables often: | Subcommand | Description | Reference |
      descIdx = headers.findIndex((h) => h.includes('description') || h.includes('purpose'));
    }
    let j = i + 2;
    while (j < lines.length && /^\|/.test(lines[j])) {
      const cells = splitMdRow(lines[j]);
      j++;
      if (!cells.length) continue;
      const code = cellCode(cells[0]);
      if (!code) continue;
      if (code.startsWith('http') || code.includes('/')) continue;
      if (/^(name|flag|option|subcommand|command)$/i.test(code)) continue;

      let desc = '';
      if (descIdx > 0 && cells[descIdx]) {
        desc = cells[descIdx].replace(/`/g, '').trim();
      } else if (cells[1]) {
        desc = cells[1].replace(/`/g, '').trim();
        // Mode-matrix second column is usually a short label ("Fast", "Hard") —
        // keep only if it looks explanatory (multiple words or long).
        if (desc.split(/\s+/).length < 2 && desc.length < 12) desc = '';
      }
      if (desc) record(code, desc);
    }
    i = j - 1;
  }

  return map;
}

/** Related skill slugs mentioned as /ak:x or $ak:x or `ak:x` in the body. */
export function extractRelatedSlugs(body, selfSlug) {
  const seen = new Set();
  const out = [];
  for (const m of body.matchAll(/(?:\/|\$|`)ak:([\w-]+)/g)) {
    const slug = `ak-${m[1]}`;
    if (slug === selfSlug) continue;
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

export function buildInvocation(skillName, syntaxSuffix) {
  const slash = skillName.startsWith('ak:') ? `/${skillName}` : skillName ? `/${skillName}` : '';
  const codex = skillName.startsWith('ak:') ? `$${skillName}` : skillName ? `$${skillName}` : '';
  const suffix = syntaxSuffix?.trim() ? ` ${syntaxSuffix.trim()}` : '';
  return {
    'claude-code': `${slash}${suffix}`.trim(),
    codex: `${codex}${suffix}`.trim(),
  };
}

/**
 * Build a schemaVersion-1 brief from kits-raw skill facts + full SKILL.md source.
 * FAITHFUL: only what the source supports.
 */
export function buildSkillBrief({ skill, source, train }) {
  const { overview, whenToUse } = buildFaithfulProse({
    descriptionRaw: skill.descriptionRaw ?? source.descriptionRaw ?? '',
    whenToUseRaw: skill.whenToUseRaw ?? source.whenToUseRaw ?? '',
    body: source.body,
  });

  const hint = source.argumentHint ?? '';
  const descs = extractFlagDescriptions(source.body);
  const flagNames = flagsFromArgumentHint(hint);
  const subNames = subcommandsFromArgumentHint(hint);

  // Include body-only flags that have a non-trivial explanation in the body
  for (const [name, desc] of descs) {
    if (!name.startsWith('--')) continue;
    if (flagNames.includes(name)) continue;
    if (!desc || isTrivialFlagDesc(name, desc)) continue;
    flagNames.push(name);
  }

  const flags = flagNames.map((name) => ({
    name,
    desc: descs.get(name) ?? '',
  }));

  // Prefer hint-listed subcommands; add table-described non-flag tokens when hint empty
  if (!subNames.length) {
    for (const [name, desc] of descs) {
      if (name.startsWith('-')) continue;
      if (SCRIPT_TOKEN.test(name)) continue;
      if (/^(usage|example|option|flag|name|subcommand|script|purpose)$/i.test(name)) continue;
      if (desc) subNames.push(name);
    }
  }

  const subcommands = subNames.map((name) => ({
    name,
    desc: descs.get(name) ?? '',
  }));

  const name = skill.name || source.name || '';
  const slash = skill.slash || (name.startsWith('ak:') ? `/${name}` : '');
  const syntax = hint ? `${slash} ${hint}`.trim() : slash;

  return {
    schemaVersion: 1,
    slug: skill.slug,
    name,
    syntax,
    overview,
    whenToUse,
    invocation: buildInvocation(name, hint),
    flags,
    subcommands,
    related: extractRelatedSlugs(source.body, skill.slug),
    guide: null,
    provenance: {
      contentHash: skill.contentHash || source.contentHash || '',
      train: train || '',
    },
  };
}

export async function readSkillSource(skillPath) {
  const text = await readFile(skillPath, 'utf8');
  const { frontmatter, body } = splitFrontmatter(text);
  return {
    name: frontmatterValue(frontmatter, 'name') ?? '',
    descriptionRaw: frontmatterValue(frontmatter, 'description') ?? '',
    whenToUseRaw: frontmatterValue(frontmatter, 'when_to_use') ?? '',
    argumentHint: frontmatterValue(frontmatter, 'argument-hint') ?? '',
    body,
  };
}
