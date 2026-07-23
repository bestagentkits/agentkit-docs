#!/usr/bin/env node
// Project kit.yaml + SKILL.md frontmatter → kits-raw/<kit>.json (mechanical, offline).
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { repoRoot } from './lib/paths.mjs';
import {
  KIT_IDS,
  KIT_TRAIN,
  defaultKitCacheRoot,
  kitRoot,
  readKitYaml,
  readSkillFrontmatter,
  skillFilePath,
} from './lib/kit-ingest.mjs';

const { values } = parseArgs({
  options: {
    cacheRoot: { type: 'string', default: defaultKitCacheRoot() },
    outDir: { type: 'string', default: join(repoRoot, 'kits-raw') },
  },
});

async function loadKit(kitId, cacheRoot) {
  const root = kitRoot(cacheRoot, kitId);
  const meta = await readKitYaml(join(root, 'kit.yaml'));
  const skills = [];

  for (const { slug } of meta.skills) {
    const skillPath = skillFilePath(root, slug);
    const fm = await readSkillFrontmatter(skillPath);
    skills.push({
      slug,
      name: fm.name,
      slash: fm.slash,
      category: fm.category || 'Other',
      version: fm.version,
      descriptionRaw: fm.descriptionRaw,
      whenToUseRaw: fm.whenToUseRaw || undefined,
      contentHash: fm.contentHash,
    });
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));

  return {
    id: kitId,
    name: meta.name ?? kitId,
    version: meta.version ?? '0.0.0',
    description: meta.description ?? '',
    tier: meta.tier ?? '',
    generatedFrom: {
      train: KIT_TRAIN,
      runtime: 'claude-code',
      cacheRoot,
    },
    counts: {
      skills: skills.length,
      agents: meta.agents.length,
    },
    agents: meta.agents,
    skills,
  };
}

function markShared(kits) {
  const bySlug = new Map();
  for (const kit of kits) {
    for (const skill of kit.skills) {
      if (!bySlug.has(skill.slug)) bySlug.set(skill.slug, []);
      bySlug.get(skill.slug).push({ kit: kit.id, hash: skill.contentHash });
    }
  }

  for (const kit of kits) {
    for (const skill of kit.skills) {
      const entries = bySlug.get(skill.slug) ?? [];
      skill.shared = entries.length > 1;
      if (skill.shared) {
        const hashes = new Set(entries.map((e) => e.hash));
        skill.identicalAcrossKits = hashes.size === 1;
      }
    }
  }
}

async function main() {
  const kits = [];
  for (const kitId of KIT_IDS) {
    kits.push(await loadKit(kitId, values.cacheRoot));
  }
  markShared(kits);

  await mkdir(values.outDir, { recursive: true });
  for (const kit of kits) {
    const path = join(values.outDir, `${kit.id}.json`);
    await writeFile(path, `${JSON.stringify(kit, null, 2)}\n`);
    console.error(`ingest-kits: wrote ${path} (${kit.counts.skills} skills, ${kit.counts.agents} agents)`);
  }

  const shared = kits[0].skills.filter((s) => s.shared).length;
  console.error(`ingest-kits: ${shared} shared skill slugs flagged`);
}

main().catch((err) => {
  console.error(`ingest-kits failed: ${err.message}`);
  process.exit(1);
});
