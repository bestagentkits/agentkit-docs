import assert from 'node:assert/strict';
import test from 'node:test';
import { createFromSource } from 'fumadocs-core/search/server';
import {
  createPublicDiscoverySource,
  filterPublicDiscoveryPages,
} from '../lib/public-discovery.mjs';

const pages = [
  {
    url: '/en/_showcase',
    path: '_showcase.mdx',
    locale: 'en',
    data: {
      title: 'Design Showcase',
      discoverable: false,
      structuredData: { headings: [], contents: [] },
    },
  },
  {
    url: '/vi/_showcase',
    path: '_showcase.mdx',
    locale: 'vi',
    data: {
      title: 'Design Showcase',
      discoverable: false,
      structuredData: { headings: [], contents: [] },
    },
  },
  {
    url: '/en/stable/getting-started/installation',
    path: 'stable/getting-started/installation.en.mdx',
    locale: 'en',
    data: {
      title: 'Installation',
      discoverable: true,
      structuredData: { headings: [], contents: [] },
    },
  },
  {
    url: '/vi/stable/getting-started/installation',
    path: 'stable/getting-started/installation.vi.mdx',
    locale: 'vi',
    data: {
      title: 'Cài đặt',
      discoverable: true,
      structuredData: { headings: [], contents: [] },
    },
  },
];

function fakeSource() {
  return {
    getPages(locale) {
      return locale ? pages.filter((page) => page.locale === locale) : pages;
    },
    getPageTree() {
      return {
        type: 'root',
        name: 'AgentKit',
        children: pages.map((page) => ({
          type: 'page',
          name: page.data.title,
          url: page.url,
        })),
      };
    },
  };
}

test('public discovery projection excludes the QA fixture in both locales', () => {
  const source = createPublicDiscoverySource(fakeSource());

  assert.deepEqual(
    source.getPages('en').map((page) => page.url),
    ['/en/stable/getting-started/installation'],
  );
  assert.deepEqual(
    source.getPages('vi').map((page) => page.url),
    ['/vi/stable/getting-started/installation'],
  );
  assert.equal(fakeSource().getPages().length, 4);
});

test('static search export keeps normal docs and omits the QA fixture', async () => {
  const search = createFromSource(createPublicDiscoverySource(fakeSource()));
  const response = await search.staticGET();
  const exported = await response.text();

  assert.equal(response.status, 200);
  assert.doesNotMatch(exported, /_showcase/);
  assert.match(exported, /\/en\/stable\/getting-started\/installation/);
  assert.match(exported, /\/vi\/stable\/getting-started\/installation/);
});

test('pages remain discoverable unless they explicitly opt out', () => {
  assert.deepEqual(
    filterPublicDiscoveryPages([
      { data: {} },
      { data: { discoverable: true } },
      { data: { discoverable: false } },
    ]),
    [{ data: {} }, { data: { discoverable: true } }],
  );
});
