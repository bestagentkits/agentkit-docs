import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { splitFrontmatter, frontmatterValue } from './normalize-reference.mjs';

export const KIT_TRAIN = '2.5.0-beta.5';
export const KIT_RUNTIME = 'claude-code';
export const KIT_IDS = ['engineer', 'marketing'];

export function defaultKitCacheRoot() {
  return join(homedir(), '.agentkit', 'cache', 'kits');
}

export function kitRoot(cacheRoot, kitId) {
  return join(cacheRoot, kitId, KIT_RUNTIME, KIT_TRAIN, kitId);
}

/** Minimal YAML reader for the kit.yaml fields this pipeline needs. */
export async function readKitYaml(path) {
  const text = await readFile(path, 'utf8');
  const name = text.match(/^name:\s*"(.*)"/m)?.[1] ?? text.match(/^name:\s*(\S+)/m)?.[1];
  const version = text.match(/^version:\s*"(.*)"/m)?.[1] ?? text.match(/^version:\s*(\S+)/m)?.[1];
  const description =
    text.match(/^description:\s*"(.*)"/m)?.[1] ??
    text.match(/^description:\s*(\S+)/m)?.[1] ??
    '';
  const tier = text.match(/^tier:\s*"(.*)"/m)?.[1] ?? text.match(/^tier:\s*(\S+)/m)?.[1] ?? '';

  const agents = [];
  const agentBlock = text.match(/exports:\s*\n(?:.*\n)*?\s+agents:\s*\n((?:\s+-\s+name:.*\n(?:\s+path:.*\n)?)+)/);
  if (agentBlock) {
    for (const m of agentBlock[1].matchAll(/-\s+name:\s*"(.*)"/g)) agents.push({ name: m[1] });
  }

  const skills = [];
  const skillBlock = text.match(/\s+skills:\s*\n((?:\s+-\s+name:.*\n(?:\s+path:.*\n)?)+)/);
  if (skillBlock) {
    for (const m of skillBlock[1].matchAll(/-\s+name:\s*"(.*)"/g)) {
      skills.push({ slug: m[1] });
    }
  }

  return { name, version, description, tier, agents, skills };
}

export async function readSkillFrontmatter(skillPath) {
  const text = await readFile(skillPath, 'utf8');
  const { frontmatter, body } = splitFrontmatter(text);
  const name = frontmatterValue(frontmatter, 'name') ?? '';
  const slash = name.startsWith('ak:') ? `/${name}` : name ? `/${name}` : '';
  return {
    name,
    slash,
    category: frontmatterValue(frontmatter, 'category') ?? 'Other',
    version: frontmatterValue(frontmatter, 'version') ?? frontmatterValue(frontmatter, 'metadata.version') ?? '',
    descriptionRaw: frontmatterValue(frontmatter, 'description') ?? '',
    whenToUseRaw: frontmatterValue(frontmatter, 'when_to_use') ?? '',
    body,
    contentHash: createHash('sha256').update(text).digest('hex'),
  };
}

export function skillDirFromSlug(kitRootDir, slug) {
  return join(kitRootDir, 'skills', slug);
}

export function skillFilePath(kitRootDir, slug) {
  return join(skillDirFromSlug(kitRootDir, slug), 'SKILL.md');
}
