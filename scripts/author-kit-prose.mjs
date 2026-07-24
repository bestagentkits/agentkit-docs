#!/usr/bin/env node
// Offline authoring: SKILL.md → kits-brief/<kit>/<slug>.json (committed brief).
// Never run in CI. Supports --slug, batch, --diff (re-extract when contentHash drifts).
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { repoRoot } from './lib/paths.mjs';
import {
  defaultKitCacheRoot,
  kitRoot,
  skillFilePath,
} from './lib/kit-ingest.mjs';
import { buildSkillBrief, readSkillSource } from './lib/kit-prose.mjs';

const { values } = parseArgs({
  options: {
    slug: { type: 'string' },
    check: { type: 'boolean', default: false },
    diff: { type: 'boolean', default: false },
    cacheRoot: { type: 'string', default: defaultKitCacheRoot() },
    rawDir: { type: 'string', default: join(repoRoot, 'kits-raw') },
    outDir: { type: 'string', default: join(repoRoot, 'kits-brief') },
  },
});

async function loadRawKit(id) {
  return JSON.parse(await readFile(join(values.rawDir, `${id}.json`), 'utf8'));
}

async function readExistingBrief(kitId, slug) {
  try {
    return JSON.parse(await readFile(join(values.outDir, kitId, `${slug}.json`), 'utf8'));
  } catch {
    return null;
  }
}

async function authorSkill(skill, kitId, train) {
  const skillPath = skillFilePath(kitRoot(values.cacheRoot, kitId), skill.slug);
  const source = await readSkillSource(skillPath);
  return buildSkillBrief({
    skill: {
      ...skill,
      descriptionRaw: skill.descriptionRaw || source.descriptionRaw,
      whenToUseRaw: skill.whenToUseRaw || source.whenToUseRaw,
    },
    source: {
      ...source,
      contentHash: skill.contentHash,
    },
    train,
  });
}

function stableStringify(obj) {
  return `${JSON.stringify(obj, null, 2)}\n`;
}

async function writeBrief(kitId, brief) {
  const dir = join(values.outDir, kitId);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${brief.slug}.json`);
  await writeFile(path, stableStringify(brief));
  return path;
}

async function listBriefSlugs(kitId) {
  const dir = join(values.outDir, kitId);
  try {
    const names = await readdir(dir);
    return names
      .filter((n) => n.endsWith('.json') && !n.endsWith('.vi.json'))
      .map((n) => n.slice(0, -'.json'.length));
  } catch {
    return [];
  }
}

async function processKit(kitId) {
  const raw = await loadRawKit(kitId);
  const train = raw.generatedFrom?.train ?? '';
  let targets = raw.skills;

  if (values.slug) {
    targets = raw.skills.filter(
      (s) => s.slug === values.slug || s.name === values.slug || s.slash === values.slug,
    );
    if (!targets.length) return { written: 0, checked: 0, skipped: 0, missing: true };
  }

  let written = 0;
  let checked = 0;
  let skipped = 0;

  for (const skill of targets) {
    const existing = await readExistingBrief(kitId, skill.slug);

    if (values.diff && existing?.provenance?.contentHash === skill.contentHash) {
      skipped++;
      continue;
    }

    const brief = await authorSkill(skill, kitId, train);

    if (values.check) {
      const a = stableStringify(existing ?? {});
      const b = stableStringify(brief);
      if (a !== b) {
        console.error(
          `author-kit-prose: stale ${kitId}/${skill.slug}.json (run without --check)`,
        );
        process.exitCode = 1;
      } else {
        checked++;
      }
      continue;
    }

    await writeBrief(kitId, brief);
    written++;
  }

  // Drop orphan briefs no longer in kits-raw (batch only, not single-slug)
  if (!values.slug && !values.check) {
    const keep = new Set(raw.skills.map((s) => s.slug));
    for (const slug of await listBriefSlugs(kitId)) {
      if (keep.has(slug)) continue;
      await rm(join(values.outDir, kitId, `${slug}.json`), { force: true });
      await rm(join(values.outDir, kitId, `${slug}.vi.json`), { force: true });
      console.error(`author-kit-prose: removed orphan ${kitId}/${slug}`);
    }
  }

  return { written, checked, skipped, missing: false };
}

async function main() {
  const kitIds = ['engineer', 'marketing'];
  let any = false;

  for (const kitId of kitIds) {
    const result = await processKit(kitId);
    if (values.slug && result.missing) continue;
    any = true;
    if (values.check) {
      console.error(
        `author-kit-prose: ${kitId} checked=${result.checked}${process.exitCode ? ' (drift)' : ' OK'}`,
      );
    } else {
      console.error(
        `author-kit-prose: ${kitId} wrote=${result.written} skipped=${result.skipped}`,
      );
    }
  }

  if (values.slug && !any) {
    throw new Error(`skill not found in engineer or marketing: ${values.slug}`);
  }
}

main().catch((err) => {
  console.error(`author-kit-prose failed: ${err.message}`);
  process.exit(1);
});
