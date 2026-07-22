// Turn a raw `cobra/doc`-generated CLI reference page into clean, web-native MDX.
//
// The upstream generator emits, per page:
//   ## <cmd>            duplicates the frontmatter title
//   <short>            duplicates the frontmatter description
//   ### Synopsis       the raw `--help` long text, using a "What it does:/…" convention
//   ``` <usage> ```    optional invocation line
//   ### Examples       root command only
//   ### Options        column-aligned flag block
//   ### Options inherited from parent commands   optional
//   ### SEE ALSO       tab-separated parent/child links
//
// Rendered verbatim that reads like a terminal dump. This module re-projects it
// into a document: drop the duplicated title/description, split the synopsis into
// labelled prose, tabulate flags / output-modes / exit-codes, and rebuild a
// "Related commands" list. It is deterministic and idempotent — feeding it
// already-normalized output returns that output unchanged (guarded up front), so
// the ingest pipeline may run it every sync and the one-time migration is safe to
// re-run.

// A synopsis field label at column 0, e.g. "What it does:", "Output modes:".
const FIELD_LABEL = /^([A-Z][^:\n]{0,40}):[ \t]*(.*)$/;

// ---------------------------------------------------------------------------
// Shared-boilerplate dedupe. Every command page carries the same universal
// flags, output-modes table and standard exit codes; repeating them 120+ times
// buries what is page-specific. They are documented once on the
// `cli-conventions` page, and filtered here — matched by EXACT flag+description
// (resp. code+meaning), so a command that overloads a universal spelling with
// different semantics keeps its row.
// ---------------------------------------------------------------------------

const UNIVERSAL_FLAGS = new Map([
  ['--json', 'Emit machine-readable JSON (implies --no-interactive)'],
  ['--no-interactive', 'Disable interactive prompts (CI-safe)'],
  ['-q, --quiet', 'Suppress non-error output on stderr'],
  ['-V, --verbose', 'Extra diagnostic output on stderr (loses to --quiet)'],
  ['-y, --yes', 'Assume yes for all prompts'],
]);

// `-h, --help` embeds the command name in its description, so it matches by
// flag spec alone.
function isUniversalFlag({ flag, desc }) {
  if (/^-h, --help\b/.test(flag)) return true;
  return UNIVERSAL_FLAGS.get(flag) === desc;
}

const STANDARD_EXIT_CODES = new Map([
  ['0', 'success'],
  ['1', 'runtime error'],
  ['2', 'invalid flags'],
  ['3', 'user-cancel (SIGINT, prompt-cancel)'],
]);

const CANONICAL_OUTPUT_MODES = [
  ['pretty', 'default on TTY (colors, ASCII markers)'],
  ['plain', 'auto when stdout piped or --no-interactive'],
  ['json', '--json (single-object envelope, NDJSON-safe)'],
];

function isCanonicalOutputModes(rows) {
  return (
    rows.length === CANONICAL_OUTPUT_MODES.length &&
    rows.every((r, i) => r.key === CANONICAL_OUTPUT_MODES[i][0] && r.value === CANONICAL_OUTPUT_MODES[i][1])
  );
}

const CONVENTIONS_NOTE =
  'Global flags, output modes, and the standard exit codes (`0`–`3`) are shared by every ' +
  'command — see [CLI conventions](../cli-conventions). The sections below list only what ' +
  'is specific to this command.';

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

function splitFrontmatter(text) {
  const m = text.match(/^(---\n[\s\S]*?\n---\n)([\s\S]*)$/);
  if (!m) return { frontmatter: '', body: text };
  return { frontmatter: m[1], body: m[2] };
}

function frontmatterValue(frontmatter, key) {
  const m = frontmatter.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'));
  if (!m) return '';
  return m[1].trim().replace(/^["']|["']$/g, '');
}

// ---------------------------------------------------------------------------
// MDX escaping. Outside of code spans, `<` starts JSX and `{` starts an
// expression — both break the MDX parser. Table cells additionally treat `|` as
// a column separator. `&#123;`/`&#125;` are the accepted brace escapes (see
// reference-hygiene.mjs), so escaping never introduces a false leak.
// ---------------------------------------------------------------------------

function escapeText(s) {
  // Escape only outside inline-code spans so `<...>`/`{...}` inside backticks
  // still render as literal code.
  return s
    .split(/(`[^`]*`)/)
    .map((part) =>
      part.startsWith('`')
        ? part
        : part.replace(/</g, '&lt;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;'),
    )
    .join('');
}

function escapeCell(s) {
  return escapeText(s).replace(/\|/g, '\\|');
}

// The synopsis "Examples:" block is authored as MDX *text*, so JSON braces and
// angle brackets arrive HTML-escaped (`&#123;`, `&lt;`). We relocate it into a
// fenced code block, where content is literal — so entities must be decoded back
// or the reader sees `&#123;` instead of `{`.
function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#123;/g, '{')
    .replace(/&#125;/g, '}')
    .replace(/&amp;/g, '&');
}

// ---------------------------------------------------------------------------
// Body tokenizer. Splits into headings, fenced code blocks and paragraphs, each
// tagged with the `### heading` it falls under (null before the first heading).
// ---------------------------------------------------------------------------

function tokenize(body) {
  const lines = body.split('\n');
  const tokens = [];
  let heading = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, '').trim();
      const content = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) content.push(lines[i++]);
      i++; // closing fence
      tokens.push({ type: 'fence', lang, content: content.join('\n'), heading });
    } else if (/^###\s/.test(line)) {
      heading = line.replace(/^###\s+/, '').trim();
      tokens.push({ type: 'h3', heading });
      i++;
    } else if (/^##\s/.test(line)) {
      tokens.push({ type: 'h2', heading });
      i++;
    } else if (line.trim() === '') {
      i++;
    } else {
      const para = [];
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        !/^#{2,3}\s/.test(lines[i]) &&
        !/^```/.test(lines[i])
      ) {
        para.push(lines[i++]);
      }
      tokens.push({ type: 'para', content: para.join('\n'), heading });
    }
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// A leading ASCII-art banner (root command). Detected by ≥2 lines that carry no
// alphanumeric characters — real prose never does.
function isBanner(content) {
  const artLines = content.split('\n').filter((l) => l.trim() && /^[^0-9A-Za-z]*$/.test(l));
  return artLines.length >= 2;
}

function dedent(lines) {
  const filled = lines.filter((l) => l.trim());
  if (!filled.length) return lines.map(() => '');
  const min = Math.min(...filled.map((l) => l.match(/^ */)[0].length));
  return lines.map((l) => l.slice(min));
}

function proseValue(inline, restLines) {
  const parts = [];
  if (inline.trim()) parts.push(inline.trim());
  for (const l of restLines) if (l.trim()) parts.push(l.trim());
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// Column-aligned cobra flag block → [{flag, desc}]. Each flag is one line:
// leading indent, spec, 2+ spaces, description. The spec keeps its type token
// (e.g. `--channel string`).
function parseFlags(content) {
  const rows = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    const m = line.match(/^\s*(.+?)\s{2,}(.+?)\s*$/);
    if (m) rows.push({ flag: m[1].trim(), desc: m[2].trim() });
    else rows.push({ flag: line.trim(), desc: '' });
  }
  return rows;
}

function flagTable(rows) {
  const out = ['| Flag | Description |', '| --- | --- |'];
  for (const { flag, desc } of rows) out.push(`| \`${flag}\` | ${escapeCell(desc)} |`);
  return out.join('\n');
}

// Aligned value lines → [{key, value}], split by `splitRe` into [key, rest].
function kvRows(lines, splitRe) {
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = line.match(splitRe);
    if (m) rows.push({ key: m[1], value: m[2].trim() });
  }
  return rows;
}

function kvTable(rows, headers) {
  const out = [`| ${headers[0]} | ${headers[1]} |`, '| --- | --- |'];
  for (const { key, value } of rows) out.push(`| \`${key}\` | ${escapeCell(value)} |`);
  return out.length > 2 ? out.join('\n') : '';
}

// SEE ALSO items: `* [ak x](./ak_x)<tab> - desc` or `- [ak x](./ak_x) — desc`.
function parseSeeAlso(content) {
  const out = [];
  for (const line of content.split('\n')) {
    const m = line.match(/^[*-]\s+\[([^\]]+)\]\(([^)]+)\)\s*[\t ]*(?:[-—–]\s*(.*))?$/);
    if (!m) continue;
    const [, label, href, desc] = m;
    out.push(
      desc && desc.trim()
        ? `- [\`${label}\`](${href}) — ${escapeText(desc.trim())}`
        : `- [\`${label}\`](${href})`,
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * @param {string} input raw generated reference MDX
 * @param {{prose?: string}} [opts] `prose` is a reviewed, human/AI-owned prose
 *   lead for this command. When present it REPLACES the mechanical overview +
 *   context paragraphs; the deterministic factual sections (usage, examples,
 *   flags, tables, related) are always machine-generated from the source.
 * @returns {string} normalized MDX (unchanged if already normalized)
 */
export function normalizeReferenceMdx(input, { prose } = {}) {
  const { frontmatter, body } = splitFrontmatter(input);

  // Idempotency guard: only raw cobra output carries these markers. Normalized
  // pages have none, so re-running is a no-op (safe for re-sync and re-migrate).
  const looksRaw =
    /^##\s+\S/m.test(body) || /^###\s+(Synopsis|Options|SEE ALSO)\b/m.test(body);
  if (!looksRaw) return input;

  const description = frontmatterValue(frontmatter, 'description');
  const tokens = tokenize(body);

  const overview = [];
  const metadata = []; // ordered `**Label:** value` paragraphs
  let examples = null; // fenced example lines (string)
  let usage = null;
  let flags = null;
  let inherited = null;
  let outputModes = null;
  let exitCodes = null;
  let docsFeedback = null;
  let related = [];
  let droppedDescription = false;

  for (const t of tokens) {
    if (t.type === 'h2' || t.type === 'h3') continue;

    if (t.type === 'fence') {
      const single = t.content.trim();
      const isUsage =
        (t.heading === null || t.heading === 'Synopsis') &&
        !single.includes('\n') &&
        /^ak(\s|$)/.test(single);
      if (isUsage) usage ??= single;
      else if (t.heading === 'Options') flags ??= parseFlags(t.content);
      else if (t.heading === 'Options inherited from parent commands')
        inherited ??= parseFlags(t.content);
      // `### Examples` fence (root only) is intentionally ignored: examples come
      // from the synopsis "Examples:" field, which every page carries.
      continue;
    }

    // Paragraph.
    if (/^Docs \/ feedback:/.test(t.content.trim())) {
      docsFeedback = t.content.trim();
      continue;
    }

    if (t.heading === 'SEE ALSO') {
      related = parseSeeAlso(t.content);
      continue;
    }

    // Drop the leading short-description paragraph (duplicates frontmatter).
    if (
      !droppedDescription &&
      t.heading === null &&
      description &&
      t.content.trim() === description
    ) {
      droppedDescription = true;
      continue;
    }

    // Synopsis (or any head-region prose): parse the labelled convention.
    const lines = t.content.split('\n');
    const first = lines[0];
    const labelMatch = first.match(FIELD_LABEL);
    if (!labelMatch) {
      if (!isBanner(t.content)) overview.push(proseValue('', lines));
      continue;
    }

    const label = labelMatch[1].trim();
    const key = label.toLowerCase();
    const inline = labelMatch[2];
    const rest = dedent(lines.slice(1));

    if (key === 'what it does') {
      overview.push(proseValue(inline, rest));
    } else if (key === 'examples') {
      examples = decodeEntities(dedent(rest.length ? rest : [inline]).join('\n').replace(/\n+$/, ''));
    } else if (key === 'output modes') {
      outputModes = kvRows(rest, /^\s*(\S+)\s{2,}(.*)$/);
    } else if (key === 'exit codes') {
      exitCodes = kvRows(rest, /^\s*(\d+)\s+(.*)$/);
    } else {
      metadata.push(`**${label}:** ${escapeText(proseValue(inline, rest))}`);
    }
  }

  // Assemble in a reading-first order: lead → usage → examples → flags →
  // inherited flags → output modes → exit codes → related → footer. The lead is
  // the reviewed prose overlay when supplied, else the mechanical projection of
  // the synopsis (overview + context paragraphs).
  const parts = [];
  if (prose && prose.trim()) {
    parts.push(prose.trim());
  } else {
    for (const p of overview) if (p) parts.push(escapeText(p));
    parts.push(...metadata);
  }
  if (usage) parts.push('### Usage', '```bash\n' + usage + '\n```');
  if (examples) parts.push('### Examples', '```bash\n' + examples + '\n```');

  // Dedupe the shared boilerplate against the cli-conventions page. Only rows
  // matching the universal spelling exactly are dropped; anything a command
  // overrides or extends stays. The pointer paragraph appears only when
  // something was actually filtered.
  const ownFlags = (flags ?? []).filter((r) => !isUniversalFlag(r));
  const ownExitCodes = (exitCodes ?? []).filter(
    (r) => STANDARD_EXIT_CODES.get(r.key) !== r.value,
  );
  const filtered =
    (flags?.length ?? 0) > ownFlags.length ||
    (exitCodes?.length ?? 0) > ownExitCodes.length ||
    (outputModes ? isCanonicalOutputModes(outputModes) : false);
  if (filtered) parts.push(CONVENTIONS_NOTE);

  if (ownFlags.length) parts.push('### Flags', flagTable(ownFlags));
  if (inherited?.length) parts.push('### Inherited flags', flagTable(inherited));
  if (outputModes && !isCanonicalOutputModes(outputModes)) {
    const table = kvTable(outputModes, ['Mode', 'Behavior']);
    if (table) parts.push('### Output modes', table);
  }
  if (ownExitCodes.length) {
    const table = kvTable(ownExitCodes, ['Code', 'Meaning']);
    if (table) parts.push('### Exit codes', table);
  }
  if (related.length) parts.push('### Related commands', related.join('\n'));
  if (docsFeedback) parts.push(docsFeedback);

  return frontmatter + '\n' + parts.join('\n\n') + '\n';
}
