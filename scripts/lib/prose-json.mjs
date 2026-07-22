import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// Structured LLM/agent input for CLI reference prose overlays. JSON is the wire
// format; `compile-prose.mjs` renders `reference-prose/<slug>.md`. Regenerate
// (`generate-reference.mjs`) still merges markdown + reference-raw only.

export const PROSE_JSON_DIR = 'reference-prose-json';
export const PROSE_DIR = 'reference-prose';

const FORBIDDEN_PATTERNS = [
  { re: /^---\s/m, msg: 'frontmatter (---) is not allowed in overlay fields' },
  { re: /^##\s/m, msg: '## headings are not allowed in overlay fields' },
  { re: /^###\s/m, msg: '### headings are not allowed in overlay fields' },
  { re: /^### (Flags|Usage|Examples|Exit codes|Related commands|Output modes)\b/m, msg: 'generated sections must not appear in overlay fields' },
  { re: /^SEE ALSO\b/m, msg: 'SEE ALSO must not appear in overlay fields' },
];

/** @typedef {{ overview: string, whenToUse: string, notes?: string }} ProseOverlay */

/**
 * Validate a parsed overlay object (shape + content rules).
 * @param {unknown} value
 * @returns {string[]} human-readable errors (empty = ok)
 */
export function validateProseOverlay(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return ['overlay must be a JSON object with overview and whenToUse'];
  }

  const { overview, whenToUse, notes, ...rest } = value;
  if (Object.keys(rest).length) {
    errors.push(`unknown fields: ${Object.keys(rest).join(', ')}`);
  }

  if (typeof overview !== 'string' || !overview.trim()) {
    errors.push('overview must be a non-empty string');
  }
  if (typeof whenToUse !== 'string' || !whenToUse.trim()) {
    errors.push('whenToUse must be a non-empty string');
  }
  if (notes !== undefined && typeof notes !== 'string') {
    errors.push('notes must be a string when present');
  }

  for (const [key, text] of [
    ['overview', overview],
    ['whenToUse', whenToUse],
    ['notes', notes],
  ]) {
    if (typeof text !== 'string' || !text) continue;
    if (/^\*\*When to use it:\*\*/i.test(text.trim())) {
      errors.push(`${key} must not include the **When to use it:** label`);
    }
    for (const { re, msg } of FORBIDDEN_PATTERNS) {
      if (re.test(text)) errors.push(`${key}: ${msg}`);
    }
  }

  return errors;
}

/**
 * @param {ProseOverlay} overlay
 * @returns {string} markdown body for reference-prose/<slug>.md
 */
export function renderProseMarkdown(overlay) {
  const parts = [overlay.overview.trim(), '', `**When to use it:** ${overlay.whenToUse.trim()}`];
  if (overlay.notes?.trim()) parts.push('', overlay.notes.trim());
  return `${parts.join('\n')}\n`;
}

/**
 * Best-effort parse of an existing overlay markdown file (for export/bootstrap).
 * @param {string} md
 * @returns {ProseOverlay}
 */
export function parseProseMarkdown(md) {
  const text = md.trim();
  const marker = '\n**When to use it:**';
  const idx = text.indexOf(marker);
  if (idx === -1) {
    throw new Error('overlay markdown is missing **When to use it:**');
  }

  const overview = text.slice(0, idx).trim();
  const rest = text.slice(idx + marker.length).trimStart();
  const notesSep = rest.indexOf('\n\n');
  /** @type {ProseOverlay} */
  const overlay =
    notesSep === -1
      ? { overview, whenToUse: rest.trim() }
      : {
          overview,
          whenToUse: rest.slice(0, notesSep).trim(),
          notes: rest.slice(notesSep + 2).trim() || undefined,
        };

  const errors = validateProseOverlay(overlay);
  if (errors.length) throw new Error(errors.join('; '));
  return overlay;
}

/**
 * @param {string} content raw JSON file text
 * @returns {{ overlay: ProseOverlay, errors: string[] }}
 */
export function parseProseJson(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return { overlay: /** @type {ProseOverlay} */ ({}), errors: [`invalid JSON: ${e.message}`] };
  }
  const errors = validateProseOverlay(parsed);
  return { overlay: /** @type {ProseOverlay} */ (parsed), errors };
}

/** @param {string} name */
export function slugFromJsonFile(name) {
  return name.replace(/\.json$/, '');
}

/**
 * @param {string} repoRoot
 * @param {{ slug?: string, check?: boolean }} [opts]
 * @returns {Promise<{ written: number, checked: number, errors: string[] }>}
 */
export async function compileProseFromJson({ repoRoot, slug, check = false }) {
  const jsonDir = join(repoRoot, PROSE_JSON_DIR);
  const proseDir = join(repoRoot, PROSE_DIR);
  await mkdir(proseDir, { recursive: true });

  let entries;
  try {
    entries = (await readdir(jsonDir, { withFileTypes: true })).filter(
      (e) => e.isFile() && e.name.endsWith('.json') && e.name !== 'schema.json',
    );
  } catch (e) {
    if (e.code === 'ENOENT') return { written: 0, checked: 0, errors: [] };
    throw e;
  }

  if (slug) {
    const want = slug.replace(/\.json$/, '');
    entries = entries.filter((e) => slugFromJsonFile(e.name) === want);
    if (!entries.length) {
      return { written: 0, checked: 0, errors: [`no JSON overlay found for slug ${want}`] };
    }
  }

  let written = 0;
  let checked = 0;
  const errors = [];

  for (const e of entries) {
    const fileSlug = slugFromJsonFile(e.name);
    const jsonPath = join(jsonDir, e.name);
    const mdPath = join(proseDir, `${fileSlug}.md`);
    const raw = await readFile(jsonPath, 'utf8');
    const { overlay, errors: parseErrors } = parseProseJson(raw);
    if (parseErrors.length) {
      errors.push(`${e.name}: ${parseErrors.join('; ')}`);
      continue;
    }

    const rendered = renderProseMarkdown(overlay);
    checked++;

    if (check) {
      let existing;
      try {
        existing = await readFile(mdPath, 'utf8');
      } catch {
        errors.push(`${fileSlug}.md is missing; run node scripts/compile-prose.mjs`);
        continue;
      }
      if (existing !== rendered) {
        errors.push(`${fileSlug}.md is stale; run node scripts/compile-prose.mjs`);
      }
      continue;
    }

    await writeFile(mdPath, rendered);
    written++;
  }

  return { written, checked, errors };
}

/**
 * Export reference-prose/*.md → reference-prose-json/*.json for slugs missing JSON.
 * @param {string} repoRoot
 * @param {{ slug?: string }} [opts]
 */
export async function exportMissingProseJson({ repoRoot, slug }) {
  const jsonDir = join(repoRoot, PROSE_JSON_DIR);
  const proseDir = join(repoRoot, PROSE_DIR);
  await mkdir(jsonDir, { recursive: true });

  let mdEntries = (await readdir(proseDir, { withFileTypes: true })).filter(
    (e) => e.isFile() && e.name.endsWith('.md') && e.name !== 'README.md',
  );

  if (slug) {
    const want = slug.replace(/\.md$/, '');
    mdEntries = mdEntries.filter((e) => e.name === `${want}.md`);
    if (!mdEntries.length) throw new Error(`no markdown overlay found for slug ${want}`);
  }

  let exported = 0;
  for (const e of mdEntries) {
    const fileSlug = e.name.replace(/\.md$/, '');
    const jsonPath = join(jsonDir, `${fileSlug}.json`);
    try {
      await readFile(jsonPath);
      continue; // already have JSON source
    } catch {
      /* export below */
    }

    const md = await readFile(join(proseDir, e.name), 'utf8');
    const overlay = parseProseMarkdown(md);
    await writeFile(jsonPath, `${JSON.stringify(overlay, null, 2)}\n`);
    exported++;
  }

  return exported;
}
