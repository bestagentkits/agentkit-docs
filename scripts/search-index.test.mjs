import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDiscoveryIndex } from '../lib/search-index.mjs';

const structuredData = {
  headings: [{ id: 'install', content: 'Install AgentKit' }],
  contents: [{ heading: 'install', content: 'Body-only installation detail' }],
};

test('buildDiscoveryIndex keeps discovery fields and removes body chunks', async () => {
  const result = await buildDiscoveryIndex({
    url: '/en/stable/installation',
    data: {
      title: 'Installation',
      description: 'Install AgentKit.',
      structuredData,
    },
  });

  assert.deepEqual(result, {
    title: 'Installation',
    description: 'Install AgentKit.',
    id: '/en/stable/installation',
    url: '/en/stable/installation',
    structuredData: {
      headings: structuredData.headings,
      contents: [],
    },
  });
});

test('buildDiscoveryIndex supports lazy page data', async () => {
  const result = await buildDiscoveryIndex({
    url: '/vi/beta/installation',
    data: {
      title: 'Cài đặt',
      structuredData: async () => structuredData,
    },
  });

  assert.deepEqual(result.structuredData.contents, []);
  assert.deepEqual(result.structuredData.headings, structuredData.headings);
});

test('buildDiscoveryIndex falls back to page data load', async () => {
  const result = await buildDiscoveryIndex({
    url: '/en/stable/lazy',
    data: {
      title: 'Lazy page',
      load: async () => ({ structuredData }),
    },
  });

  assert.deepEqual(result.structuredData.contents, []);
});
