import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  emitMarkdownSiblings,
  planMarkdownSiblings,
} from './lib/markdown-siblings.mjs';

// Build a fake `out/` tree. `pages` maps `"{lang}/{slug...}"` → markdown body;
// each becomes `out/{lang}/llms.mdx/docs/{slug}/content.md` plus the sibling
// HTML the real export would emit, so tests exercise the true layout.
async function fakeOut(pages, extra = () => {}) {
  const outDir = await mkdtemp(join(tmpdir(), 'ak-docs-md-'));
  for (const [key, body] of Object.entries(pages)) {
    const [lang, ...slug] = key.split('/');
    const contentDir = join(outDir, lang, 'llms.mdx', 'docs', ...slug);
    await mkdir(contentDir, { recursive: true });
    await writeFile(join(contentDir, 'content.md'), body);
    // Mirror the HTML page the export emits alongside the markdown route.
    const htmlDir = join(outDir, lang, ...slug.slice(0, -1));
    await mkdir(htmlDir, { recursive: true });
    await writeFile(join(outDir, lang, ...slug) + '.html', '<h1>page</h1>');
  }
  await extra(outDir);
  return outDir;
}

const exists = (p) => access(p).then(() => true, () => false);

test('mirrors EN, VI, and nested pages to byte-identical .md siblings', async (t) => {
  const outDir = await fakeOut({
    'en/stable/getting-started': '# Getting started (/en/stable/getting-started)\n\nEN body.',
    'vi/stable/getting-started': '# Bắt đầu (/vi/stable/getting-started)\n\nNội dung VI.',
    'en/beta/concepts/runtime-adapters': '# Runtime adapters\n\nNested EN body.',
  });
  t.after(() => rm(outDir, { recursive: true, force: true }));

  const { emitted, warnings } = await emitMarkdownSiblings(outDir);

  assert.equal(emitted, 3);
  assert.deepEqual(warnings, []);

  for (const [key] of [
    ['en/stable/getting-started'],
    ['vi/stable/getting-started'],
    ['en/beta/concepts/runtime-adapters'],
  ]) {
    const [lang, ...slug] = key.split('/');
    const sibling = join(outDir, lang, ...slug) + '.md';
    const source = join(outDir, lang, 'llms.mdx', 'docs', ...slug, 'content.md');
    assert.equal(
      await readFile(sibling, 'utf8'),
      await readFile(source, 'utf8'),
      `${sibling} must byte-match its content.md source`,
    );
  }
});

test('link-rewritten markdown passes through unchanged (VI diacritics intact)', async (t) => {
  // content.md already contains getLLMText output (rewritten internal links);
  // the emitter must copy it verbatim, including non-ASCII bytes.
  const body =
    '# Bắt đầu (/vi/stable/getting-started)\n\n' +
    'See [installation](/vi/stable/getting-started/installation).\n';
  const outDir = await fakeOut({ 'vi/stable/getting-started': body });
  t.after(() => rm(outDir, { recursive: true, force: true }));

  await emitMarkdownSiblings(outDir);

  const sibling = join(outDir, 'vi', 'stable', 'getting-started.md');
  assert.equal(await readFile(sibling, 'utf8'), body);
});

test('no sibling is emitted for a path lacking a content.md source (404 by absence)', async (t) => {
  const outDir = await fakeOut({ 'en/stable/getting-started': '# ok' }, async (dir) => {
    // An HTML-only path with no markdown route output must not get a .md sibling.
    await mkdir(join(dir, 'en', 'stable'), { recursive: true });
    await writeFile(join(dir, 'en', 'stable', 'not-a-page.html'), '<h1>x</h1>');
  });
  t.after(() => rm(outDir, { recursive: true, force: true }));

  await emitMarkdownSiblings(outDir);

  assert.equal(await exists(join(outDir, 'en', 'stable', 'not-a-page.md')), false);
});

test('zero-slug markdown source is skipped with a warning (never writes out/{lang}.md)', async (t) => {
  const outDir = await mkdtemp(join(tmpdir(), 'ak-docs-md-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const root = join(outDir, 'en', 'llms.mdx', 'docs');
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'content.md'), '# root');

  const { emitted, warnings } = await emitMarkdownSiblings(outDir);

  assert.equal(emitted, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /zero-slug/);
  assert.equal(await exists(join(outDir, 'en.md')), false);
});

test('planMarkdownSiblings maps content.md paths to sibling .md destinations', async (t) => {
  const outDir = await fakeOut({ 'en/beta/guides/kits': '# Kits' });
  t.after(() => rm(outDir, { recursive: true, force: true }));

  const { copies } = await planMarkdownSiblings(outDir);

  assert.equal(copies.length, 1);
  assert.deepEqual(copies[0].slug, ['beta', 'guides', 'kits']);
  assert.equal(copies[0].dest, join(outDir, 'en', 'beta', 'guides', 'kits.md'));
});

test('emits zero for an empty output tree (caller enforces the failure)', async (t) => {
  const outDir = await mkdtemp(join(tmpdir(), 'ak-docs-md-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));

  const { emitted } = await emitMarkdownSiblings(outDir);

  assert.equal(emitted, 0);
});
