#!/usr/bin/env node
// Deterministic merge: kits-raw + kits-prose-json → content/docs/beta/kits/*.mdx
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { repoRoot } from './lib/paths.mjs';
import {
  kitPageFrontmatter,
  renderKitCatalogMdx,
  renderKitIndexMdx,
  renderKitOverviewMdx,
} from './lib/kit-catalog.mjs';

const { values } = parseArgs({
  options: {
    channel: { type: 'string', default: 'beta' },
    rawDir: { type: 'string', default: join(repoRoot, 'kits-raw') },
    proseDir: { type: 'string', default: join(repoRoot, 'kits-prose-json') },
  },
});

const KITS = ['engineer', 'marketing'];
const LOCALES = ['en', 'vi'];
const DERIVED = new Set([
  'index.en.mdx',
  'index.vi.mdx',
  'engineer.en.mdx',
  'engineer.vi.mdx',
  'marketing.en.mdx',
  'marketing.vi.mdx',
]);

const isNavMeta = (name) => /^meta(\.[\w-]+)?\.json$/.test(name);

async function loadJson(dir, name) {
  return JSON.parse(await readFile(join(dir, name), 'utf8'));
}

async function main() {
  const kitsDir = join(repoRoot, 'content', 'docs', values.channel, 'kits');
  await mkdir(kitsDir, { recursive: true });

  for (const e of await readdir(kitsDir, { withFileTypes: true })) {
    if (!e.isFile() || isNavMeta(e.name) || e.name === '.generated') continue;
    if (/\.mdx?$/.test(e.name) && DERIVED.has(e.name)) {
      await rm(join(kitsDir, e.name));
    }
  }

  const rawKits = [];
  const proseByKit = {};
  for (const id of KITS) {
    rawKits.push(await loadJson(values.rawDir, `${id}.json`));
    proseByKit[id] = await loadJson(values.proseDir, `${id}.json`);
  }

  let written = 0;
  for (const locale of LOCALES) {
    const indexBody = renderKitIndexMdx({
      kits: rawKits.map((k) => ({ id: k.id, title: k.name, description: k.description, counts: k.counts })),
      locale,
    });
    await writeFile(
      join(kitsDir, `index.${locale}.mdx`),
      kitPageFrontmatter({ kit: rawKits[0], locale, page: 'index' }) + indexBody,
    );
    written++;
  }

  for (const kit of rawKits) {
    for (const locale of LOCALES) {
      const overview = renderKitOverviewMdx({ kit, locale });
      const catalog = renderKitCatalogMdx({
        kit,
        skills: kit.skills,
        proseBySlug: proseByKit[kit.id],
        locale,
      });
      await writeFile(
        join(kitsDir, `${kit.id}.${locale}.mdx`),
        kitPageFrontmatter({ kit, locale, page: kit.id, withAccordion: true }) +
          overview +
          catalog,
      );
      written++;
    }
  }

  const marker = join(kitsDir, '.generated');
  try {
    await readFile(marker, 'utf8');
  } catch {
    await writeFile(marker, '{"pipeline":"generate-kits"}\n');
  }

  console.error(`generate-kits: wrote ${written} pages in ${values.channel}/kits`);
}

main().catch((err) => {
  console.error(`generate-kits failed: ${err.message}`);
  process.exit(1);
});
