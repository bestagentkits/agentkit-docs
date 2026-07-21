import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ManifestError, isValidTag, parseManifest, validateManifest } from './lib/manifest.mjs';

const betaManifest = {
  schemaVersion: 1,
  channel: 'beta',
  tag: 'v0.42.0-beta.7',
  sha: '1a2b3c4d5e6f7890',
  version: '0.42.0-beta.7',
  generatedAt: '2026-07-20T00:00:00Z',
};

const stableManifest = {
  ...betaManifest,
  channel: 'stable',
  tag: 'v0.42.0',
  version: '0.42.0',
  promotedFrom: 'v0.42.0-beta.7',
};

test('isValidTag distinguishes beta and stable shapes', () => {
  assert.ok(isValidTag('v0.42.0-beta.7', 'beta'));
  assert.ok(!isValidTag('v0.42.0', 'beta'));
  assert.ok(isValidTag('v1.0.0', 'stable'));
  assert.ok(!isValidTag('v1.0.0-beta.1', 'stable'));
  assert.ok(!isValidTag('0.42.0', 'stable'));
});

test('valid beta manifest passes', () => {
  assert.deepEqual(validateManifest(betaManifest, { expectedChannel: 'beta' }), betaManifest);
});

test('valid stable manifest requires promotedFrom', () => {
  assert.doesNotThrow(() => validateManifest(stableManifest, { expectedChannel: 'stable' }));
  const { promotedFrom, ...noPromote } = stableManifest;
  assert.throws(() => validateManifest(noPromote, { expectedChannel: 'stable' }), ManifestError);
});

test('channel mismatch is rejected', () => {
  assert.throws(
    () => validateManifest(betaManifest, { expectedChannel: 'stable' }),
    /channel mismatch/,
  );
});

test('unsupported schemaVersion is rejected', () => {
  assert.throws(() => validateManifest({ ...betaManifest, schemaVersion: 2 }), /schemaVersion/);
});

test('bad tag shape is rejected', () => {
  assert.throws(() => validateManifest({ ...betaManifest, tag: 'v0.42' }), /valid beta tag/);
});

test('missing sha / version / generatedAt is rejected', () => {
  assert.throws(() => validateManifest({ ...betaManifest, sha: 'x' }), /sha/);
  assert.throws(() => validateManifest({ ...betaManifest, version: '' }), /version/);
  assert.throws(() => validateManifest({ ...betaManifest, generatedAt: undefined }), /generatedAt/);
});

test('malformed JSON is a ManifestError, not a raw SyntaxError', () => {
  assert.throws(() => parseManifest('{ not json'), ManifestError);
});
