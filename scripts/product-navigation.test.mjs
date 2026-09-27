import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  activeProduct,
  ENGINEER_START_LINKS,
  engineerStartLinks,
  filterTreeByProduct,
  productTabs,
  showsEngineerStartLinks,
} from '../lib/product-navigation.ts';
import { repoRoot } from './lib/paths.mjs';
import { RELEASE_QUALITY_BASELINE } from './release-quality-metrics.mjs';

function createSampleTree(locale = 'en', channel = 'stable') {
  const prefix = `/${locale}/${channel}`;
  return {
    type: 'root',
    $id: 'root',
    children: [
      {
        type: 'folder',
        name: channel === 'beta' ? 'Beta' : 'Stable',
        root: true,
        children: [
          {
            type: 'page',
            name: 'Overview',
            url: prefix,
          },
          {
            type: 'folder',
            name: 'Getting Started',
            children: [
              {
                type: 'page',
                name: 'Installation',
                url: `${prefix}/getting-started/installation`,
              },
            ],
          },
          {
            type: 'folder',
            name: locale === 'vi' ? 'Bộ kit' : 'Kits',
            index: {
              type: 'page',
              name: locale === 'vi' ? 'Chọn bộ kit' : 'Choose a Kit',
              url: `${prefix}/kits`,
            },
            children: [
              {
                type: 'folder',
                name: 'Engineer',
                children: [
                  {
                    type: 'page',
                    name: 'Skills',
                    url: `${prefix}/kits/engineer/skills`,
                  },
                ],
              },
              {
                type: 'folder',
                name: 'Marketing',
                children: [
                  {
                    type: 'page',
                    name: 'Skills',
                    url: `${prefix}/kits/marketing/skills`,
                  },
                ],
              },
              {
                type: 'folder',
                name: 'Workflows',
                children: [
                  {
                    type: 'page',
                    name: 'Software Delivery',
                    url: `${prefix}/kits/workflows/software-delivery`,
                  },
                ],
              },
            ],
          },
          {
            type: 'folder',
            name: 'Guides',
            children: [
              {
                type: 'page',
                name: 'Updating',
                url: `${prefix}/guides/updating`,
              },
            ],
          },
          {
            type: 'folder',
            name: 'CLI Reference',
            children: [
              {
                type: 'page',
                name: 'CLI',
                url: `${prefix}/reference/cli`,
              },
            ],
          },
          {
            type: 'folder',
            name: 'Desktop App',
            children: [
              {
                type: 'page',
                name: 'App',
                url: `${prefix}/desktop-app`,
              },
            ],
          },
        ],
      },
    ],
  };
}

function countUrlsInTree(node, targetUrl) {
  let count = 0;
  if (node.type === 'page' && node.url === targetUrl) {
    count += 1;
  }
  if (node.type === 'folder') {
    if (node.index?.url === targetUrl) {
      count += 1;
    }
    for (const child of node.children ?? []) {
      count += countUrlsInTree(child, targetUrl);
    }
  }
  if (node.type === 'root') {
    for (const child of node.children ?? []) {
      count += countUrlsInTree(child, targetUrl);
    }
  }
  return count;
}

// Every node exposing `targetUrl`, with the number of group levels crossed to
// reach it: depth 0 is the channel root itself, so a first-level sidebar entry
// sits at depth 1.
function findUrlNodes(node, targetUrl, depth = 0) {
  const found = [];
  if (node.type === 'page' && node.url === targetUrl) {
    found.push({ depth, name: node.name, type: 'page' });
  }
  if (node.type === 'folder') {
    if (node.index?.url === targetUrl) {
      found.push({ depth, name: node.index.name, type: 'folder-index' });
    }
    for (const child of node.children ?? []) {
      found.push(...findUrlNodes(child, targetUrl, depth + 1));
    }
  }
  if (node.type === 'root') {
    for (const child of node.children ?? []) {
      found.push(...findUrlNodes(child, targetUrl, depth));
    }
  }
  return found;
}

function collectAllUrls(node, urls = []) {
  if (node.type === 'page') {
    urls.push(node.url);
    return urls;
  }
  if (node.type === 'folder') {
    if (node.index?.url) urls.push(node.index.url);
    for (const child of node.children ?? []) collectAllUrls(child, urls);
  }
  if (node.type === 'root') {
    for (const child of node.children ?? []) collectAllUrls(child, urls);
  }
  return urls;
}

// The real content tree gives each Kit directory an index page
// (`kits/engineer.en.mdx` next to `kits/engineer/`), so the projected sidebar
// already exposes `/kits/engineer` through the Engineer folder.
function addKitIndexes(tree, locale, channel) {
  const prefix = `/${locale}/${channel}`;
  const channelRoot = tree.children[0];
  const kits = channelRoot.children.find(
    (child) => child.type === 'folder' && child.index?.url === `${prefix}/kits`,
  );
  assert.ok(kits, 'sample tree must contain the Kits folder');

  kits.children = kits.children.map((child) => {
    if (child.type !== 'folder') return child;
    const route =
      child.name === 'Engineer'
        ? `${prefix}/kits/engineer`
        : child.name === 'Workflows'
          ? `${prefix}/kits/workflows`
          : null;
    if (!route) return child;
    return {
      ...child,
      index: { type: 'page', name: child.name, url: route },
    };
  });
  return tree;
}

function contentRouteExists(channel, route, locale) {
  const base = resolve(repoRoot, 'content/docs', channel, route);
  return [`${base}.${locale}.mdx`, resolve(base, `index.${locale}.mdx`)].some(
    (path) => existsSync(path),
  );
}

test('activeProduct resolves section correctly', () => {
  assert.equal(activeProduct('/en/stable'), 'docs');
  assert.equal(activeProduct('/en/stable/getting-started/installation'), 'docs');
  assert.equal(activeProduct('/en/stable/kits'), 'kits');
  assert.equal(activeProduct('/en/stable/kits/engineer/skills'), 'kits');
  assert.equal(activeProduct('/en/stable/reference/cli'), 'cli');
  assert.equal(activeProduct('/en/stable/desktop-app'), 'desktop');
  assert.equal(activeProduct('/vi/beta/kits'), 'kits');
});

const products = ['docs', 'kits', 'cli', 'desktop'];
const locales = ['en', 'vi'];
const channels = ['stable', 'beta'];

for (const channel of channels) {
  for (const locale of locales) {
    for (const product of products) {
      test(`filterTreeByProduct (${channel}, ${locale}, ${product}) exposes exactly one catalog link with localized title`, () => {
        const tree = createSampleTree(locale, channel);
        const filtered = filterTreeByProduct(tree, product);
        const catalogUrl = `/${locale}/${channel}/kits`;
        const expectedTitle = locale === 'vi' ? 'Danh mục Skill' : 'Skill Catalog';

        // Assert exactly one occurrence of /kits in the entire sidebar projection
        const count = countUrlsInTree(filtered, catalogUrl);
        assert.equal(
          count,
          1,
          `Expected exactly one ${catalogUrl} link in ${channel}/${locale}/${product} projection, got ${count}`,
        );

        const channelRoot = filtered.children[0];
        assert.equal(channelRoot.type, 'folder');

        if (product === 'docs') {
          const catalogItem = channelRoot.children.find(
            (c) => c.type === 'page' && c.url === catalogUrl,
          );
          assert.ok(catalogItem, 'Docs sidebar must have a page item for Skill Catalog');
          assert.equal(catalogItem.name, expectedTitle);
        } else if (product === 'kits') {
          const kitsFolder = channelRoot.children[0];
          assert.equal(kitsFolder.type, 'folder');
          assert.equal(kitsFolder.name, expectedTitle);
          assert.equal(kitsFolder.index?.url, catalogUrl);
        } else {
          // cli and desktop
          const catalogItem = channelRoot.children.find(
            (c) => c.type === 'page' && c.url === catalogUrl,
          );
          assert.ok(catalogItem, `${product} sidebar must have a top-level page item for Skill Catalog`);
          assert.equal(catalogItem.name, expectedTitle);
        }
      });
    }
  }
}

test('productTabs returns correctly formatted tabs with localized titles', () => {
  const tree = createSampleTree('en', 'stable');
  const tabs = productTabs(tree, 'en', 'stable');

  assert.equal(tabs.length, 4);
  assert.equal(tabs[0].title, 'Docs');
  assert.equal(tabs[0].url, '/en/stable');
  assert.equal(tabs[1].title, 'Kits');
  assert.equal(tabs[1].url, '/en/stable/kits');
  assert.equal(tabs[2].title, 'CLI Reference');
  assert.equal(tabs[3].title, 'Desktop App');

  const viTabs = productTabs(tree, 'vi', 'stable');
  assert.equal(viTabs[0].title, 'Tài liệu');
  assert.equal(viTabs[1].title, 'Bộ kit');
  assert.equal(viTabs[2].title, 'Tham chiếu CLI');
  assert.equal(viTabs[3].title, 'Ứng dụng Desktop');
});

const engineerEntryName = { en: 'Engineer', vi: 'Engineer' };

for (const channel of channels) {
  for (const locale of locales) {
    for (const product of products) {
      test(`Engineer is one visible activation on ${channel}/${locale}/${product}`, () => {
        const tree = createSampleTree(locale, channel);
        const engineerUrl = `/${locale}/${channel}/kits/engineer`;
        const filtered = filterTreeByProduct(tree, product);

        const nodes = findUrlNodes(filtered, engineerUrl);
        assert.equal(
          nodes.length,
          1,
          `Expected exactly one ${engineerUrl} entry in the ${product} projection, got ${nodes.length}`,
        );
        assert.ok(
          nodes[0].depth <= 2,
          `Engineer entry is ${nodes[0].depth} group levels deep in the ${product} projection`,
        );
        assert.equal(nodes[0].name, engineerEntryName[locale]);

        if (product !== 'kits') {
          assert.equal(
            nodes[0].depth,
            1,
            `Engineer must sit directly under the channel root in the ${product} projection`,
          );
        }
      });

      test(`projected ${channel}/${locale}/${product} sidebar never leaves its own scope`, () => {
        const filtered = filterTreeByProduct(createSampleTree(locale, channel), product);
        const prefix = `/${locale}/${channel}`;

        for (const url of collectAllUrls(filtered)) {
          assert.ok(
            url.startsWith(`${prefix}/`) || url === prefix,
            `${product} projection contains an out-of-scope link: ${url}`,
          );
        }
      });
    }
  }
}

test('a projection that already exposes Engineer gains no duplicate node', () => {
  for (const channel of channels) {
    for (const locale of locales) {
      for (const product of products) {
        const tree = addKitIndexes(createSampleTree(locale, channel), locale, channel);
        const engineerUrl = `/${locale}/${channel}/kits/engineer`;
        const filtered = filterTreeByProduct(tree, product);

        const nodes = findUrlNodes(filtered, engineerUrl);
        assert.equal(
          nodes.length,
          1,
          `Expected exactly one ${engineerUrl} entry in the indexed ${product} projection, got ${nodes.length}`,
        );
        if (product !== 'kits') {
          assert.equal(
            nodes[0].depth,
            1,
            `Engineer must stay a direct first-level entry in the indexed ${product} projection`,
          );
        }
      }
    }
  }
});

test('filterTreeByProduct keeps a stable per-product identity and leaves its input intact', () => {
  const tree = createSampleTree('en', 'stable');
  const before = JSON.stringify(tree);

  const docs = filterTreeByProduct(tree, 'docs');
  const kits = filterTreeByProduct(tree, 'kits');

  assert.notEqual(docs.$id, kits.$id);
  assert.equal(JSON.stringify(tree), before, 'filterTreeByProduct must not mutate the shared tree');
  assert.equal(filterTreeByProduct(tree, 'docs').$id, docs.$id, '$id must be stable across renders');
  assert.equal(countUrlsInTree(docs, '/en/stable/kits/engineer'), 1);
});

test('engineer start links stay in scope and drop the landing self-link', () => {
  for (const channel of channels) {
    for (const locale of locales) {
      const home = engineerStartLinks({ locale, channel });
      assert.deepEqual(
        home.items.map((item) => item.id),
        ENGINEER_START_LINKS.map((link) => link.id),
      );
      assert.deepEqual(home.missing, []);

      for (const item of home.items) {
        assert.ok(
          item.href.startsWith(`/${locale}/${channel}/`),
          `start link left its scope: ${item.href}`,
        );
      }

      const landing = engineerStartLinks({ locale, channel, currentRoute: 'kits/engineer' });
      assert.equal(landing.items.length, ENGINEER_START_LINKS.length - 1);
      assert.ok(!landing.items.some((item) => item.href.endsWith('/kits/engineer')));
      assert.ok(landing.items.some((item) => item.href.endsWith('/kits/engineer/skills')));
    }
  }

  const labels = Object.fromEntries(
    engineerStartLinks({ locale: 'vi', channel: 'beta' }).items.map((item) => [item.id, item.label]),
  );
  assert.equal(labels.installation, 'Cài đặt');
  assert.equal(labels.workflows, 'Workflow');
});

test('an unresolvable destination is reported and never answered by another scope', () => {
  const result = engineerStartLinks({
    locale: 'vi',
    channel: 'beta',
    currentRoute: '',
    exists: (route) => route !== 'kits/workflows',
  });

  assert.deepEqual(result.missing, ['kits/workflows']);
  assert.ok(!result.items.some((item) => item.id === 'workflows'));
  assert.equal(result.items.length, ENGINEER_START_LINKS.length - 1);
  for (const item of result.items) {
    assert.ok(item.href.startsWith('/vi/beta/'), `fallback crossed scope: ${item.href}`);
  }
});

test('an unsupported channel is rejected instead of defaulting to another channel', () => {
  assert.throws(
    () => engineerStartLinks({ locale: 'en', channel: 'preview' }),
    /unsupported docs channel/,
  );
});

test('start-link routes are the canonical routes the search acceptance matrix asserts', () => {
  const matrixRoutes = new Set(
    RELEASE_QUALITY_BASELINE.fixedQueries.map((entry) => entry.route),
  );

  for (const link of ENGINEER_START_LINKS) {
    assert.ok(
      matrixRoutes.has(link.route),
      `${link.route} is not asserted by the search acceptance matrix`,
    );
    assert.ok(
      !/^(en|vi|stable|beta)\//.test(link.route),
      `${link.route} must stay channel-relative`,
    );
    assert.ok(link.labels.en.length > 0 && link.labels.vi.length > 0);
  }
});

test('every required start-link route exists in all four scopes', () => {
  for (const channel of channels) {
    for (const locale of locales) {
      const result = engineerStartLinks({
        locale,
        channel,
        exists: (route) => contentRouteExists(channel, route, locale),
      });

      assert.deepEqual(
        result.missing,
        [],
        `${locale}/${channel} is missing required start-link routes`,
      );
      assert.equal(result.items.length, ENGINEER_START_LINKS.length);
    }
  }
});

test('showsEngineerStartLinks selects the channel home and the Engineer landing only', () => {
  assert.equal(showsEngineerStartLinks(''), true);
  assert.equal(showsEngineerStartLinks('kits/engineer'), true);
  assert.equal(showsEngineerStartLinks('kits/engineer/skills'), false);
  assert.equal(showsEngineerStartLinks('kits'), false);
  assert.equal(showsEngineerStartLinks('getting-started/installation'), false);
  assert.equal(showsEngineerStartLinks('reference/cli/update'), false);
});
