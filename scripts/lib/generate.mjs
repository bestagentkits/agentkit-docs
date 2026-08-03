import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  normalizeReferenceMdx,
  splitFrontmatter,
  frontmatterValue,
} from './normalize-reference.mjs';
import { buildIndexBody } from './reference-index.mjs';
import { scrubPrivateLinks } from './hygiene.mjs';
import { loadProse, slugFromFile } from './reference-prose.mjs';

// The derived CLI help dump is generated from two in-repo sources:
//   reference-raw/<slug>.mdx    raw `ak --help` projection (machine source of truth)
//   reference-prose/<slug>.md   reviewed prose overlays (channel-neutral)
// → reference-derived/<slug>.mdx (hygiene-scrubbed, normalized, overlaid).
// Published docs under content/docs/<channel>/reference/cli/ are human-authored
// and nested to match site URLs. CI regenerates reference-derived/ and asserts
// a zero diff — proving the help dump equals generator(source + overlays).

export const RAW_DIR = 'reference-raw';
export const DERIVED_DIR = 'reference-derived';

/**
 * Regenerate the derived CLI help dump from reference-raw + reference-prose.
 * Delete-then-write for derived pages (upstream deletions vanish), preserving
 * the `.generated` marker when present.
 * @param {{repoRoot: string, channel?: string}} args
 * @returns {Promise<number>} number of derived pages written
 */
export async function generateReference({ repoRoot }) {
  const rawDir = join(repoRoot, RAW_DIR);
  const derivedDir = join(repoRoot, DERIVED_DIR);
  await mkdir(derivedDir, { recursive: true });

  const rawPages = (await readdir(rawDir, { withFileTypes: true })).filter(
    (e) => e.isFile() && /\.mdx?$/.test(e.name),
  );
  const derived = new Set(rawPages.map((e) => e.name));

  // Drop derived pages no longer backed by a raw source; keep the marker.
  for (const e of await readdir(derivedDir, { withFileTypes: true })) {
    if (!e.isFile() || e.name === '.generated') continue;
    if (/\.mdx?$/.test(e.name) && !derived.has(e.name)) await rm(join(derivedDir, e.name));
  }

  // The index page is compiled last: a grouped table of contents derived from
  // the command pages' frontmatter (title + description), not a raw projection.
  const commandMeta = [];
  let indexRaw = null;

  for (const e of rawPages) {
    const raw = scrubPrivateLinks(await readFile(join(rawDir, e.name), 'utf8'));
    if (e.name.replace(/\.mdx?$/, '') === 'index') {
      indexRaw = raw;
      continue;
    }
    const prose = await loadProse(repoRoot, slugFromFile(e.name));
    await writeFile(join(derivedDir, e.name), normalizeReferenceMdx(raw, { prose }));

    const { frontmatter } = splitFrontmatter(raw);
    commandMeta.push({
      slug: slugFromFile(e.name),
      title: frontmatterValue(frontmatter, 'title'),
      description: frontmatterValue(frontmatter, 'description'),
    });
  }

  if (indexRaw) {
    const { frontmatter } = splitFrontmatter(indexRaw);
    await writeFile(
      join(derivedDir, 'index.mdx'),
      frontmatter + '\n' + buildIndexBody(commandMeta),
    );
  }
  return rawPages.length;
}
