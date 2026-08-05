import { mkdir, copyFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

// The per-page processed Markdown is already emitted by the `llms.mdx/docs`
// route handler at `out/{lang}/llms.mdx/docs/{...slug}/content.md` (that route
// runs `getLLMText`). We mirror each of those files to the sibling public URL
// `out/{lang}/{...slug}.md`, byte-for-byte, so the `.md` endpoint is guaranteed
// identical to the existing `content.md` endpoint without a second MDX compile.
//
// A genuine sibling `.md` *route* is impossible under `output: 'export'`: the
// HTML docs pages own the `/[lang]/[...slug]` catch-all, and Next.js forbids a
// route handler resolving to the same pattern. Hence this post-build step.

const CONTENT_FILE = 'content.md';
// Path segments (relative to `out/{lang}`) under which the route emits markdown.
const LLMS_SEGMENTS = ['llms.mdx', 'docs'];

async function listDir(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

// Recursively collect absolute paths of every `content.md` under `dir`.
async function findContentFiles(dir) {
  const found = [];
  for (const entry of await listDir(dir)) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await findContentFiles(full)));
    } else if (entry.isFile() && entry.name === CONTENT_FILE) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Plan (without writing) the `content.md` → sibling `.md` copies for one build
 * output dir. Returns `{ copies, warnings }` where each copy is
 * `{ source, dest, lang, slug }` and `slug` is the page's slug segments.
 */
export async function planMarkdownSiblings(outDir) {
  const copies = [];
  const warnings = [];

  for (const langEntry of await listDir(outDir)) {
    if (!langEntry.isDirectory()) continue;
    const lang = langEntry.name;
    const docsRoot = join(outDir, lang, ...LLMS_SEGMENTS);

    for (const source of await findContentFiles(docsRoot)) {
      const slug = relative(docsRoot, source).split(sep).slice(0, -1);
      if (slug.length === 0) {
        // `out/{lang}/llms.mdx/docs/content.md` → would collide with `out/{lang}.md`.
        // The docs catch-all requires ≥1 slug, so this is not expected; guard anyway.
        warnings.push(`skipped zero-slug markdown source: ${source}`);
        continue;
      }
      const dest = `${join(outDir, lang, ...slug)}.md`;
      copies.push({ source, dest, lang, slug });
    }
  }

  return { copies, warnings };
}

/**
 * Materialize the sibling `.md` files. Returns `{ emitted, warnings }`.
 * Does not enforce a non-zero-emit policy — that is the caller's decision
 * (the CLI treats zero emits as a build failure).
 */
export async function emitMarkdownSiblings(outDir) {
  const { copies, warnings } = await planMarkdownSiblings(outDir);

  for (const { source, dest } of copies) {
    await mkdir(join(dest, '..'), { recursive: true });
    await copyFile(source, dest);
  }

  return { emitted: copies.length, warnings };
}
