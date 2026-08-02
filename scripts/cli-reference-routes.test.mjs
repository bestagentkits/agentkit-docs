import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  canonicalCliReferenceSlugs,
  nestCliReferencePageTree,
  resolveCliReferenceHref,
  transformCliReferenceStorage,
} from '../lib/cli-reference-routes.mjs';

const channels = ['stable', 'beta'];
const locales = ['en', 'vi'];

function inventory(channel, locale) {
  const dir = path.join('content/docs', channel, 'reference/cli-samples');
  return readdirSync(dir)
    .filter((file) => file.endsWith(`.${locale}.mdx`))
    .map((file) => {
      const source = readFileSync(path.join(dir, file), 'utf8');
      const title = /^title:\s+(.+)$/m.exec(source)?.[1];
      const storagePath = `${channel}/reference/cli-samples/${file.replace(`.${locale}`, '')}`;
      const slugs = canonicalCliReferenceSlugs(storagePath, title);
      return {
        file: file.replace(`.${locale}.mdx`, ''),
        path: `${channel}/reference/cli-samples/${file}`,
        title,
        data: { title },
        slugs,
        url: `/${locale}/${slugs.join('/')}`,
      };
    });
}

function pageUrls(node) {
  const urls = [];
  if (node.index) urls.push(node.index.url);
  for (const child of node.children ?? []) {
    if (child.type === 'page') urls.push(child.url);
    else if (child.type === 'folder') urls.push(...pageUrls(child));
  }
  return urls;
}

test('publishes 165 unique nested authored routes with full channel/locale parity', () => {
  const shapes = new Map();
  const navShapes = new Map();
  for (const channel of channels) {
    for (const locale of locales) {
      const pages = inventory(channel, locale);
      const routes = pages.map((page) => page.slugs.slice(1).join('/'));
      const metaFile = locale === 'en' ? 'meta.json' : 'meta.vi.json';
      const nav = JSON.parse(
        readFileSync(
          path.join('content/docs', channel, 'reference/cli-samples', metaFile),
          'utf8',
        ),
      ).pages;
      assert.equal(pages.length, 165, `${channel}/${locale} authored page count`);
      assert.equal(new Set(routes).size, 165, `${channel}/${locale} route collisions`);
      assert.ok(routes.every((route) => !/[\s]|%20/i.test(route)));
      assert.deepEqual(
        [...nav].sort(),
        pages.map((page) => page.file).sort(),
        `${channel}/${locale} navigation inventory`,
      );
      shapes.set(`${channel}/${locale}`, routes.sort());
      navShapes.set(`${channel}/${locale}`, nav);
    }
  }

  const expected = shapes.get('stable/en');
  for (const shape of shapes.values()) assert.deepEqual(shape, expected);
  const expectedNav = navShapes.get('stable/en');
  for (const shape of navShapes.values()) assert.deepEqual(shape, expectedNav);
  assert.ok(expected.includes('reference/cli'));
  assert.ok(expected.includes('reference/cli/agents'));
  assert.ok(expected.includes('reference/cli/agents/install'));
  assert.ok(expected.includes('reference/cli/config/prefs/set'));
});

test('nests each family overview once and keeps every authored page reachable', () => {
  const pages = inventory('stable', 'en');
  const children = pages
    .map((page, index) => ({
      type: 'page',
      $id: String(index),
      $ref: page.path,
      name: page.title,
      url: page.url,
    }));
  const tree = nestCliReferencePageTree({
    type: 'folder',
    $id: 'en:stable/reference/cli-samples',
    name: 'CLI Reference',
    children,
  });

  const urls = pageUrls(tree);
  const topFamilies = new Set(
    pages.filter((page) => page.file !== 'index').map((page) => page.slugs[3]),
  );
  assert.equal(urls.length, 165);
  assert.equal(new Set(urls).size, 165);
  assert.equal(tree.children.length, topFamilies.size);
  assert.equal(
    new Set(tree.children.map((node) => node.name)).size,
    topFamilies.size,
  );
  const agents = tree.children.find((node) => node.name === 'ak agents');
  assert.equal(agents.type, 'folder');
  assert.equal(agents.index.url, '/en/stable/reference/cli/agents');
  assert.equal(
    agents.children.find((node) => node.name === 'install').url,
    '/en/stable/reference/cli/agents/install',
  );
  const config = tree.children.find((node) => node.name === 'ak config');
  const prefs = config.children.find((node) => node.name === 'prefs');
  assert.equal(prefs.index.url, '/en/stable/reference/cli/config/prefs');
  assert.ok(prefs.children.some((node) => node.name === 'set'));
});

test('removes generated storage and rejects canonical route collisions', () => {
  const files = new Map([
    ['stable/reference/cli/ak_agents.mdx', { format: 'page', slugs: ['stable', 'reference', 'cli', 'ak_agents'], data: { title: 'ak agents' } }],
    ['stable/reference/cli/meta.json', { format: 'meta', data: {} }],
    ['stable/reference/cli-samples/ak agents.mdx', { format: 'page', slugs: [], data: { title: 'ak agents' } }],
  ]);
  const storage = {
    getFiles: () => [...files.keys()],
    read: (file) => files.get(file),
    delete(prefix, recursive) {
      if (!recursive) return files.delete(prefix);
      let deleted = false;
      for (const file of [...files.keys()]) {
        if (file === prefix || file.startsWith(`${prefix}/`)) {
          files.delete(file);
          deleted = true;
        }
      }
      return deleted;
    },
  };
  transformCliReferenceStorage(storage);
  assert.deepEqual(storage.getFiles(), ['stable/reference/cli-samples/ak agents.mdx']);
  assert.deepEqual(storage.read(storage.getFiles()[0]).slugs, [
    'stable', 'reference', 'cli', 'agents',
  ]);

  files.set('stable/reference/cli-samples/duplicate.mdx', {
    format: 'page', slugs: [], data: { title: 'ak agents' },
  });
  assert.throws(() => transformCliReferenceStorage(storage), /Duplicate canonical CLI route/);
});

test('rewrites old flat authored and generated hrefs within the current channel', () => {
  const pages = channels.flatMap((channel) => inventory(channel, 'en'));
  assert.equal(
    resolveCliReferenceHref(
      '../reference/cli',
      pages,
      'beta/getting-started/quickstart.en.mdx',
    ),
    '/en/beta/reference/cli',
  );
  assert.equal(
    resolveCliReferenceHref(
      '../../../reference/cli/kit-init',
      pages,
      'beta/kits/engineer/hooks/index.en.mdx',
    ),
    '/en/beta/reference/cli/kit/init',
  );
  assert.equal(
    resolveCliReferenceHref(
      '../reference/cli-samples/ak%20gui',
      pages,
      'stable/desktop-app/index.en.mdx',
    ),
    '/en/stable/reference/cli/gui',
  );
  assert.equal(
    resolveCliReferenceHref(
      '../cli/ak_config_prefs_set#usage',
      pages,
      'beta/reference/example.en.mdx',
    ),
    '/en/beta/reference/cli/config/prefs/set#usage',
  );
});
