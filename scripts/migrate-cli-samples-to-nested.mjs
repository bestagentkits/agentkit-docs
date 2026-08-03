#!/usr/bin/env node
/**
 * One-shot: migrate flat cli-samples/ into nested reference/cli/ for both
 * channels, matching published URL shape. Safe to re-run only on a clean
 * cli-samples source (deletes destination cli/ first).
 *
 *   node scripts/migrate-cli-samples-to-nested.mjs
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { repoRoot } from './lib/paths.mjs';

const CHANNELS = ['beta', 'stable'];
const LOCALES = ['en', 'vi'];

function frontmatterTitle(source) {
  const match = /^title:\s*(.+)$/m.exec(source);
  if (!match) throw new Error('missing title frontmatter');
  return match[1].trim().replace(/^["']|["']$/g, '');
}

function commandSegments(title) {
  if (title === 'AgentKit CLI reference' || title === 'Tham chiếu CLI AgentKit') {
    return [];
  }
  if (!title.startsWith('ak ')) {
    throw new Error(`CLI title must start with "ak ": ${title}`);
  }
  const segments = title.slice(3).split(/\s+/);
  for (const segment of segments) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(segment)) {
      throw new Error(`Invalid CLI command segment "${segment}" in title: ${title}`);
    }
  }
  return segments;
}

function relativeDest(segments, locale, hasChildren) {
  if (segments.length === 0) return `index.${locale}.mdx`;
  if (hasChildren) return `${segments.join('/')}/index.${locale}.mdx`;
  if (segments.length === 1) return `${segments[0]}.${locale}.mdx`;
  return `${segments.slice(0, -1).join('/')}/${segments.at(-1)}.${locale}.mdx`;
}

function segmentKey(segments) {
  return segments.join('/');
}

async function migrateChannel(channel) {
  const samplesDir = join(repoRoot, 'content/docs', channel, 'reference/cli-samples');
  const cliDir = join(repoRoot, 'content/docs', channel, 'reference/cli');

  const pages = [];
  for (const locale of LOCALES) {
    const files = (await readdir(samplesDir)).filter((name) => name.endsWith(`.${locale}.mdx`));
    for (const file of files) {
      const source = await readFile(join(samplesDir, file), 'utf8');
      const title = frontmatterTitle(source);
      const segments = commandSegments(title);
      pages.push({ locale, file, source, title, segments, key: segmentKey(segments) });
    }
  }

  const keys = new Set(pages.map((page) => page.key));
  function hasChildren(segments) {
    if (segments.length === 0) return true;
    const prefix = `${segmentKey(segments)}/`;
    for (const key of keys) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }

  // Wipe previous generated dump / prior migration attempt.
  await rm(cliDir, { recursive: true, force: true });
  await mkdir(cliDir, { recursive: true });

  const written = [];
  for (const page of pages) {
    const children = hasChildren(page.segments);
    const rel = relativeDest(page.segments, page.locale, children);
    const dest = join(cliDir, rel);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, page.source);
    written.push(rel);
  }

  // Nested meta from flat order (EN stems → nested page keys).
  const flatMeta = JSON.parse(await readFile(join(samplesDir, 'meta.json'), 'utf8'));
  const flatMetaVi = JSON.parse(await readFile(join(samplesDir, 'meta.vi.json'), 'utf8'));

  const enByStem = new Map();
  for (const page of pages.filter((p) => p.locale === 'en')) {
    const stem = page.file.replace(/\.en\.mdx$/, '');
    enByStem.set(stem, page);
  }

  // Build folder → ordered child keys using flat pages order.
  /** @type {Map<string, string[]>} */
  const folderChildren = new Map();
  folderChildren.set('', []);

  for (const stem of flatMeta.pages) {
    const page = enByStem.get(stem);
    if (!page) throw new Error(`${channel}: meta page missing file: ${stem}`);
    const segments = page.segments;
    if (segments.length === 0) continue; // index
    const parentKey = segmentKey(segments.slice(0, -1));
    const childName = hasChildren(segments) ? segments.at(-1) : segments.at(-1);
    if (!folderChildren.has(parentKey)) folderChildren.set(parentKey, []);
    const list = folderChildren.get(parentKey);
    if (!list.includes(childName)) list.push(childName);
    // Ensure intermediate folders exist in the map
    for (let i = 1; i < segments.length; i++) {
      const key = segmentKey(segments.slice(0, i));
      if (!folderChildren.has(key)) folderChildren.set(key, []);
    }
  }

  // Root meta
  await writeFile(
    join(cliDir, 'meta.json'),
    JSON.stringify({ title: flatMeta.title, pages: ['index', ...folderChildren.get('')] }, null, 2) +
      '\n',
  );
  await writeFile(
    join(cliDir, 'meta.vi.json'),
    JSON.stringify(
      { title: flatMetaVi.title, pages: ['index', ...folderChildren.get('')] },
      null,
      2,
    ) + '\n',
  );

  // Nested folder meta (title = `ak …` for depth 1, else last segment)
  for (const [key, children] of folderChildren) {
    if (!key) continue;
    const segments = key.split('/');
    const folderDir = join(cliDir, ...segments);
    const title = segments.length === 1 ? `ak ${segments[0]}` : segments.at(-1);
    const titleVi = title; // command names stay English in nav labels for folders
    const pagesList = ['index', ...children];
    await writeFile(
      join(folderDir, 'meta.json'),
      JSON.stringify({ title, pages: pagesList }, null, 2) + '\n',
    );
    await writeFile(
      join(folderDir, 'meta.vi.json'),
      JSON.stringify({ title: titleVi, pages: pagesList }, null, 2) + '\n',
    );
  }

  // Parent reference meta: cli-samples → cli
  for (const metaName of ['meta.json', 'meta.vi.json']) {
    const metaPath = join(repoRoot, 'content/docs', channel, 'reference', metaName);
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    meta.pages = meta.pages.map((page) => (page === 'cli-samples' ? 'cli' : page));
    await writeFile(metaPath, JSON.stringify(meta, null, 2) + '\n');
  }

  await rm(samplesDir, { recursive: true, force: true });
  return written.length;
}

let total = 0;
for (const channel of CHANNELS) {
  const n = await migrateChannel(channel);
  total += n;
  console.error(`migrate-cli-samples: ${channel} wrote ${n} pages`);
}
console.error(`migrate-cli-samples: done (${total} page files)`);
