import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const promoteCli = join(here, 'promote-docs.mjs');
const stableBundleDir = join(repoRoot, 'fixtures', 'docs-bundle-stable');

const temps = [];
after(() => {
  for (const dir of temps) {
    try {
      // Drop any leftover git worktrees registered under this fixture repo.
      try {
        const list = execFileSync('git', ['worktree', 'list', '--porcelain'], {
          cwd: dir,
          encoding: 'utf8',
        });
        for (const line of list.split('\n')) {
          if (line.startsWith('worktree ') && !line.endsWith(dir)) {
            const wt = line.slice('worktree '.length);
            try {
              execFileSync('git', ['worktree', 'remove', '--force', wt], {
                cwd: dir,
                stdio: 'ignore',
              });
            } catch {
              // ignore
            }
          }
        }
      } catch {
        // not a git repo or already cleaned
      }
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** Minimal git docs repo with content/docs/beta + channels.json, tagged. */
function makeDocsRepo({ betaTag, refName }) {
  const root = mkdtempSync(join(tmpdir(), 'promote-cli-'));
  temps.push(root);

  mkdirSync(join(root, 'content', 'docs', 'beta', 'reference'), { recursive: true });
  mkdirSync(join(root, 'content', 'docs', 'stable'), { recursive: true });
  writeFileSync(
    join(root, 'content', 'docs', 'beta', 'index.mdx'),
    '---\ntitle: Introduction\n---\nBeta snapshot body.\n',
  );
  writeFileSync(
    join(root, 'content', 'docs', 'beta', 'reference', 'release-notes.mdx'),
    `---\ntitle: Release notes\ndescription: Release notes for the beta channel (${betaTag}).\ngenerated: true\n---\n# ${betaTag}\n`,
  );
  writeFileSync(
    join(root, 'channels.json'),
    JSON.stringify(
      {
        stable: { version: null },
        beta: {
          version: betaTag.slice(1),
          tag: betaTag,
          sha: '1a2b3c4d5e6f7890abcdef1234567890abcdef12',
          syncedAt: '2026-07-20T00:00:00Z',
        },
      },
      null,
      2,
    ) + '\n',
  );

  git(root, ['init', '-b', 'dev']);
  git(root, ['config', 'user.name', 'Promote CLI Fixture']);
  git(root, ['config', 'user.email', 'promote-cli@example.test']);
  // Detached worktrees need a committed tree; avoid global hooks.
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', `docs snapshot ${betaTag}`]);
  git(root, ['tag', refName]);

  return root;
}

function runPromote(args, opts = {}) {
  return spawnSync(process.execPath, [promoteCli, ...args], {
    encoding: 'utf8',
    cwd: repoRoot,
    ...opts,
  });
}

function listLinkedWorktrees(root) {
  try {
    const main = realpathSync(root);
    const list = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
    });
    return list
      .split('\n')
      .filter((line) => line.startsWith('worktree '))
      .map((line) => line.slice('worktree '.length))
      .filter((path) => {
        try {
          return realpathSync(path) !== main;
        } catch {
          return true;
        }
      });
  } catch {
    return [];
  }
}

test('CLI rejects --beta-source without --allow-unverified-beta-source', () => {
  const res = runPromote([
    '--bundle',
    stableBundleDir,
    '--beta-source',
    join(repoRoot, 'content', 'docs', 'beta'),
  ]);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /fixtures\/tests only/);
  assert.match(res.stderr, /allow-unverified-beta-source/);
});

test('CLI rejects beta-ref whose channels.beta.tag mismatches promotedFrom', () => {
  // Fixture stable manifest promotedFrom is v0.42.0-beta.7; tag the wrong beta.
  const root = makeDocsRepo({
    betaTag: 'v0.42.0-beta.9',
    refName: 'docs/v0.42.0-beta.9',
  });

  const res = runPromote([
    '--bundle',
    stableBundleDir,
    '--beta-ref',
    'docs/v0.42.0-beta.9',
    '--repoRoot',
    root,
  ]);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /does not identify promotedFrom v0\.42\.0-beta\.7/);
  assert.match(res.stderr, /channels\.beta\.tag is "v0\.42\.0-beta\.9"/);
  // Worktree from the failed resolve must be cleaned up.
  assert.deepEqual(listLinkedWorktrees(root), []);
  // Stable must not have been written from a mismatched snapshot.
  assert.ok(!existsSync(join(root, 'content', 'docs', 'stable', 'index.mdx')));
});

test('CLI exact beta-ref path succeeds when channels.beta.tag matches promotedFrom', () => {
  const root = makeDocsRepo({
    betaTag: 'v0.42.0-beta.7',
    refName: 'docs/v0.42.0-beta.7',
  });
  // Stale stable file that whole-copy must remove.
  mkdirSync(join(root, 'content', 'docs', 'stable', 'getting-started'), { recursive: true });
  writeFileSync(join(root, 'content', 'docs', 'stable', 'getting-started', 'stale.mdx'), 'gone\n');

  const res = runPromote([
    '--bundle',
    stableBundleDir,
    '--beta-ref',
    'docs/v0.42.0-beta.7',
    '--repoRoot',
    root,
  ]);
  assert.equal(res.status, 0, res.stderr);
  const summary = JSON.parse(res.stdout);
  assert.equal(summary.tag, 'v0.42.0');
  assert.equal(summary.promotedFrom, 'v0.42.0-beta.7');
  assert.equal(summary.betaRef, 'docs/v0.42.0-beta.7');

  const notes = readFileSync(join(root, 'content', 'docs', 'stable', 'reference', 'release-notes.mdx'), 'utf8');
  assert.match(notes, /stable channel \(v0\.42\.0\)/);
  assert.doesNotMatch(notes, /beta channel/);
  assert.ok(existsSync(join(root, 'content', 'docs', 'stable', 'index.mdx')));
  assert.ok(!existsSync(join(root, 'content', 'docs', 'stable', 'getting-started', 'stale.mdx')));

  const channels = JSON.parse(readFileSync(join(root, 'channels.json'), 'utf8'));
  assert.equal(channels.stable.tag, 'v0.42.0');
  assert.equal(channels.beta.tag, 'v0.42.0-beta.7', 'beta channel record untouched');

  // Detached worktree cleaned after success.
  assert.deepEqual(listLinkedWorktrees(root), []);
});
