#!/usr/bin/env node
// LLM/offline authoring stage: SKILL.md → kits-prose-json/<kit>.json (committed prose overlay).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { repoRoot } from './lib/paths.mjs';
import {
  defaultKitCacheRoot,
  kitRoot,
  skillFilePath,
} from './lib/kit-ingest.mjs';
import { buildFaithfulProse, readSkillSource } from './lib/kit-prose.mjs';

const { values } = parseArgs({
  options: {
    slug: { type: 'string' },
    check: { type: 'boolean', default: false },
    cacheRoot: { type: 'string', default: defaultKitCacheRoot() },
    rawDir: { type: 'string', default: join(repoRoot, 'kits-raw') },
    outDir: { type: 'string', default: join(repoRoot, 'kits-prose-json') },
  },
});

async function loadRawKit(id) {
  return JSON.parse(await readFile(join(values.rawDir, `${id}.json`), 'utf8'));
}

async function authorSkill(skill, kitId) {
  const skillPath = skillFilePath(kitRoot(values.cacheRoot, kitId), skill.slug);
  const source = await readSkillSource(skillPath);
  const { overview, whenToUse } = buildFaithfulProse({
    ...source,
    descriptionRaw: skill.descriptionRaw,
    whenToUseRaw: skill.whenToUseRaw ?? '',
  });

  return {
    overview,
    whenToUse,
    // VI ships with EN until translated; generate-kits falls back cleanly.
    overviewVi: overview,
    whenToUseVi: whenToUse,
  };
}

async function authorKit(kitId, existing = {}) {
  const raw = await loadRawKit(kitId);
  const prose = { ...existing };
  const targets = values.slug
    ? raw.skills.filter((s) => s.slug === values.slug || s.name === values.slug)
    : raw.skills;

  if (values.slug && !targets.length) {
    throw new Error(`skill not found in ${kitId}: ${values.slug}`);
  }

  for (const skill of targets) {
    prose[skill.slug] = await authorSkill(skill, kitId);
  }
  return prose;
}

async function main() {
  const kitIds = values.slug ? ['engineer', 'marketing'] : ['engineer', 'marketing'];
  await mkdir(values.outDir, { recursive: true });

  for (const kitId of kitIds) {
    const outPath = join(values.outDir, `${kitId}.json`);
    let existing = {};
    try {
      existing = JSON.parse(await readFile(outPath, 'utf8'));
    } catch {
      /* first run */
    }

    const raw = await loadRawKit(kitId);
    if (values.slug && !raw.skills.some((s) => s.slug === values.slug || s.name === values.slug)) {
      continue;
    }

    const prose = await authorKit(kitId, values.slug ? existing : {});
    if (values.check) {
      const onDisk = JSON.parse(await readFile(outPath, 'utf8'));
      const a = JSON.stringify(onDisk, null, 2);
      const b = JSON.stringify(prose, null, 2);
      if (a !== b) {
        console.error(`author-kit-prose: ${outPath} is stale (run without --check)`);
        process.exit(1);
      }
      console.error(`author-kit-prose: ${outPath} OK`);
      continue;
    }

    await writeFile(outPath, `${JSON.stringify(prose, null, 2)}\n`);
    console.error(`author-kit-prose: wrote ${outPath} (${Object.keys(prose).length} skills)`);
  }
}

main().catch((err) => {
  console.error(`author-kit-prose failed: ${err.message}`);
  process.exit(1);
});
