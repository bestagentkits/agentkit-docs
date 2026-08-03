import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  cliCommandSegmentsFromTitle,
  legacyCliSamplesParentPath,
  resolveCliReferenceHref,
} from '../lib/cli-reference-routes.mjs';

const channels = ['stable', 'beta'];
const locales = ['en', 'vi'];

function walkMdx(dir, locale, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMdx(full, locale, acc);
      continue;
    }
    if (!entry.name.endsWith(`.${locale}.mdx`)) continue;
    acc.push(full);
  }
  return acc;
}

function inventory(channel, locale) {
  const dir = path.join('content/docs', channel, 'reference/cli');
  return walkMdx(dir, locale).map((full) => {
    const source = readFileSync(full, 'utf8');
    const title = /^title:\s+(.+)$/m.exec(source)?.[1]?.trim();
    const rel = path.relative(dir, full).split(path.sep).join('/');
    const storagePath = `${channel}/reference/cli/${rel}`;
    const withoutLocale = rel.replace(new RegExp(`\\.${locale}\\.mdx$`), '');
    const parts = withoutLocale.split('/');
    if (parts.at(-1) === 'index') parts.pop();
    const slugs = [channel, 'reference', 'cli', ...parts];
    return {
      file: withoutLocale,
      path: storagePath,
      title,
      data: { title },
      slugs,
      url: `/${locale}/${slugs.join('/')}`,
    };
  });
}

test('publishes 165 unique nested authored routes with full channel/locale parity', () => {
  const shapes = new Map();
  for (const channel of channels) {
    for (const locale of locales) {
      const pages = inventory(channel, locale);
      const routes = pages.map((page) => page.slugs.slice(1).join('/'));
      assert.equal(pages.length, 165, `${channel}/${locale} authored page count`);
      assert.equal(new Set(routes).size, 165, `${channel}/${locale} route collisions`);
      assert.ok(routes.every((route) => !/[\s]|%20/i.test(route)));
      shapes.set(`${channel}/${locale}`, routes.sort());
    }
  }

  const expected = shapes.get('stable/en');
  for (const shape of shapes.values()) assert.deepEqual(shape, expected);
  assert.ok(expected.includes('reference/cli'));
  assert.ok(expected.includes('reference/cli/agents'));
  assert.ok(expected.includes('reference/cli/agents/install'));
  assert.ok(expected.includes('reference/cli/config/prefs/set'));
});

test('title segments match nested filesystem paths', () => {
  for (const page of inventory('beta', 'en')) {
    if (page.file === 'index') continue;
    const segments = cliCommandSegmentsFromTitle(page.title);
    assert.deepEqual(page.slugs.slice(3), segments, page.path);
  }
});

test('rewrites nested, legacy flat, and generated hrefs within the current channel', () => {
  const pages = channels.flatMap((channel) => inventory(channel, 'en'));
  assert.equal(
    resolveCliReferenceHref(
      './projects-list',
      pages,
      'beta/reference/cli/projects/add.en.mdx',
    ),
    '/en/beta/reference/cli/projects/list',
  );
  assert.equal(
    resolveCliReferenceHref(
      './ak%20content%20queue%20list',
      pages,
      'beta/reference/cli/content/queue/cancel.en.mdx',
    ),
    '/en/beta/reference/cli/content/queue/list',
  );
  assert.equal(
    resolveCliReferenceHref(
      './watch-dry-run',
      pages,
      'beta/reference/cli/watch/start.en.mdx',
    ),
    '/en/beta/reference/cli/watch/dry-run',
  );
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
      '../../../reference/cli/kit/init',
      pages,
      'beta/kits/engineer/hooks/index.en.mdx',
    ),
    '/en/beta/reference/cli/kit/init',
  );
  assert.equal(
    resolveCliReferenceHref(
      '../reference/cli-samples/ak%20gui',
      pages,
      'beta/desktop-app/index.en.mdx',
    ),
    '/en/beta/reference/cli/gui',
  );
  assert.equal(
    resolveCliReferenceHref(
      '../cli/ak_config_prefs_set#usage',
      pages,
      'beta/reference/example.en.mdx',
    ),
    '/en/beta/reference/cli/config/prefs/set#usage',
  );
  assert.equal(
    resolveCliReferenceHref(
      './doctor',
      pages,
      'beta/reference/cli/index.en.mdx',
    ),
    '/en/beta/reference/cli/doctor',
  );
});

test('rebases non-CLI relatives from the legacy flat authored directory', () => {
  assert.equal(
    legacyCliSamplesParentPath('beta/reference/cli/kit/install.en.mdx'),
    'beta/reference/cli-samples/__legacy__.en.mdx',
  );
  assert.equal(
    legacyCliSamplesParentPath('stable/reference/cli/kit/install.vi.mdx'),
    'stable/reference/cli-samples/__legacy__.vi.mdx',
  );
});
