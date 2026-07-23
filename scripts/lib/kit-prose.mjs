import { readFile } from 'node:fs/promises';
import { splitFrontmatter, frontmatterValue } from './normalize-reference.mjs';

/** First non-empty paragraph after frontmatter — faithful excerpt only. */
export function firstBodyParagraph(body) {
  const lines = body.split('\n');
  const buf = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (buf.length) break;
      continue;
    }
    if (t.startsWith('#') || t.startsWith('```') || t.startsWith('<')) {
      if (buf.length) break;
      continue;
    }
    buf.push(t);
  }
  return buf.join(' ').replace(/\s+/g, ' ').trim();
}

export function buildFaithfulProse({ descriptionRaw, whenToUseRaw, body }) {
  const overview =
    descriptionRaw.trim() ||
    firstBodyParagraph(body) ||
    'Skill documentation is available in the kit source.';

  let whenToUse = whenToUseRaw.trim();
  if (!whenToUse) {
    const excerpt = firstBodyParagraph(body);
    if (excerpt && excerpt !== overview) whenToUse = excerpt;
    else whenToUse = `Use ${overview.charAt(0).toLowerCase()}${overview.slice(1)}`;
  }

  return { overview, whenToUse };
}

export async function readSkillSource(skillPath) {
  const text = await readFile(skillPath, 'utf8');
  const { frontmatter, body } = splitFrontmatter(text);
  return {
    descriptionRaw: frontmatterValue(frontmatter, 'description') ?? '',
    whenToUseRaw: frontmatterValue(frontmatter, 'when_to_use') ?? '',
    body,
  };
}
