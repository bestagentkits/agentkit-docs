import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { changedNameStatus } from './lib/git.mjs';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

test('changedNameStatus forces rename provenance independent of git config', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'ak-docs-git-test-'));
  try {
    git(cwd, 'init', '--quiet');
    git(cwd, 'config', 'user.name', 'Test');
    git(cwd, 'config', 'user.email', 'test@example.com');
    git(cwd, 'config', 'diff.renames', 'false');

    await writeFile(join(cwd, 'before.mdx'), 'unchanged content\n');
    git(cwd, 'add', 'before.mdx');
    git(cwd, 'commit', '--quiet', '-m', 'initial');

    await rename(join(cwd, 'before.mdx'), join(cwd, 'after.mdx'));
    git(cwd, 'add', '-A');
    git(cwd, 'commit', '--quiet', '-m', 'rename');

    assert.deepEqual(changedNameStatus('HEAD~1', { cwd }), [
      {
        status: 'R100',
        source: 'before.mdx',
        path: 'after.mdx',
      },
    ]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
