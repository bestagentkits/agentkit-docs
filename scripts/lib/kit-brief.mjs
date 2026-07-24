import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Load committed briefs for one kit.
 * Returns Map-like object: { [slug]: { en, vi|null } }
 */
export async function loadKitBriefs(briefDir, kitId) {
  const dir = join(briefDir, kitId);
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return {};
  }

  const bySlug = {};
  for (const name of names) {
    if (!name.endsWith('.json') || name.endsWith('.vi.json')) continue;
    const slug = name.slice(0, -'.json'.length);
    const en = JSON.parse(await readFile(join(dir, name), 'utf8'));
    let vi = null;
    try {
      vi = JSON.parse(await readFile(join(dir, `${slug}.vi.json`), 'utf8'));
    } catch {
      /* optional overlay */
    }
    bySlug[slug] = { en, vi };
  }
  return bySlug;
}

/** Merge EN brief + optional VI prose overlay for a locale. */
export function resolveBriefLocale(entry, locale) {
  if (!entry?.en) return null;
  const en = entry.en;
  if (locale !== 'vi' || !entry.vi) return en;

  const vi = entry.vi;
  const flagDesc = new Map((vi.flags ?? []).map((f) => [f.name, f.desc]));
  const subDesc = new Map((vi.subcommands ?? []).map((f) => [f.name, f.desc]));

  return {
    ...en,
    overview: vi.overview || en.overview,
    whenToUse: vi.whenToUse || en.whenToUse,
    flags: (en.flags ?? []).map((f) => ({
      name: f.name,
      desc: flagDesc.get(f.name) || f.desc,
    })),
    subcommands: (en.subcommands ?? []).map((f) => ({
      name: f.name,
      desc: subDesc.get(f.name) || f.desc,
    })),
  };
}
