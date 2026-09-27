import assert from 'node:assert/strict';
import test from 'node:test';
import {
  channelRootFromSourcePath,
  channelRootTitle,
  normalizeChannelRootMeta,
} from '../lib/channel-metadata.mjs';

const copiedBetaRoot = {
  root: true,
  title: 'Beta',
  pages: ['index', 'getting-started'],
};

test('recognizes channel root metadata in both locales', () => {
  assert.equal(channelRootFromSourcePath('stable/meta.json'), 'stable');
  assert.equal(channelRootFromSourcePath('beta/meta.json'), 'beta');
  assert.equal(channelRootFromSourcePath('stable/meta.vi.json'), 'stable');
  assert.equal(channelRootFromSourcePath('beta/meta.vi.json'), 'beta');
  assert.equal(channelRootFromSourcePath('beta/getting-started/meta.json'), null);
  assert.equal(channelRootFromSourcePath('beta/getting-started/meta.vi.json'), null);
  assert.equal(channelRootFromSourcePath('beta/index.en.mdx'), null);
});

test('derives the display label from the real source path', () => {
  assert.equal(channelRootTitle('stable'), 'Stable');
  assert.equal(channelRootTitle('beta'), 'Beta');
});

test('a promoted Stable root cannot keep the copied Beta label', () => {
  const normalized = normalizeChannelRootMeta('stable/meta.json', copiedBetaRoot);

  assert.equal(normalized.title, 'Stable');
  assert.deepEqual(normalized.pages, copiedBetaRoot.pages);
  // The shared fixture still carries the Beta label for its own channel.
  assert.equal(normalizeChannelRootMeta('beta/meta.json', copiedBetaRoot), null);
});

test('leaves already-correct and unrelated metadata alone', () => {
  assert.equal(normalizeChannelRootMeta('stable/meta.json', { ...copiedBetaRoot, title: 'Stable' }), null);
  assert.equal(normalizeChannelRootMeta('beta/getting-started/meta.json', { title: 'Beta' }), null);
  assert.equal(normalizeChannelRootMeta('beta/index.en.mdx', { title: 'Beta' }), null);
});
