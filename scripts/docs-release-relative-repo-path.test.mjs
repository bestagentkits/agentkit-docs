import assert from 'node:assert/strict';
import { win32 } from 'node:path';
import test from 'node:test';
import { ReleasePathError, relativeRepoPath } from './lib/docs-release-paths.mjs';

test('relativeRepoPath converts native separators to POSIX', () => {
  assert.equal(relativeRepoPath('C:\\r', 'C:\\r\\a\\b', win32), 'a/b');
  assert.equal(relativeRepoPath('/r', '/r/a/b'), 'a/b');
});

test('relativeRepoPath still rejects escapes and the root itself', () => {
  assert.throws(() => relativeRepoPath('C:\\r\\a', 'C:\\r\\x', win32), ReleasePathError);
  assert.throws(() => relativeRepoPath('/r', '/r'), ReleasePathError);
});
