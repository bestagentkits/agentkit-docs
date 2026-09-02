import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeProduct,
  filterTreeByProduct,
  productTabs,
} from '../lib/product-navigation.ts';

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
