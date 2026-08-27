import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const script = resolve(repoRoot, '.agents/skills/ak-release-update/scripts/classify-pr-prefix.sh');

// execFileSync, not execFile: the async form has no `input` option, so the
// script would block on a stdin pipe that is never written or closed.
function classify(entries) {
  const input = `${entries.map((entry) => JSON.stringify({ pr: '0', url: '', ...entry })).join('\n')}\n`;
  const stdout = execFileSync('bash', [script], { input, encoding: 'utf8' });
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test('runtime adapter scopes route for prose review instead of being skipped', () => {
  const rows = classify([
    { prefix: 'codex', subject: 'support Windows directory junctions for canonical hooks root' },
    { prefix: 'pi', subject: 'canonicalize profile paths' },
    { prefix: 'adapters', subject: 'Codex full v0 adapter' },
  ]);
  assert.deepEqual(rows.map((r) => r.tab), ['runtime', 'runtime', 'runtime']);
});

test('a Desktop subject overrides a generic scope the prefix map would not route', () => {
  const [row] = classify([
    { prefix: 'ux', subject: 'auto-detect and auto-install missing Node.js for Desktop App and CLI' },
  ]);
  assert.equal(row.tab, 'desktop');
});

test('gui-api carries Desktop surface and is no longer a skip', () => {
  const [row] = classify([{ prefix: 'gui-api', subject: 'health endpoint' }]);
  assert.equal(row.tab, 'desktop');
});

test('release-engineering scopes stay skipped and unknown scopes stay unclassified', () => {
  const rows = classify([
    { prefix: 'ci', subject: 'avoid pipefail SIGPIPE in snapshot lookup' },
    { prefix: 'release', subject: 'supply CAfile to osslsigncode' },
    { prefix: 'newthing', subject: 'something unknown' },
    { prefix: '', subject: 'a bullet with no scope' },
  ]);
  assert.deepEqual(rows.map((r) => r.tab), ['skip', 'skip', 'unclassified', 'unclassified']);
});

test('a final line with no trailing newline is still classified', () => {
  const input = JSON.stringify({ prefix: 'codex', subject: 'no trailing newline', pr: '0', url: '' });
  const stdout = execFileSync('bash', [script], { input, encoding: 'utf8' });
  const rows = stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tab, 'runtime');
});

test('a non-matching subject does not abort the run under set -e', () => {
  // Regression: subject_override returned non-zero when no keyword matched,
  // which killed the whole stream at the first default-tab entry.
  const rows = classify([
    { prefix: 'installer', subject: 'refresh install channel pins' },
    { prefix: 'update', subject: 'skip Cursor home in pre-force snapshot' },
    { prefix: 'docs', subject: 'clarify channel pin wording' },
  ]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.tab), ['default', 'default', 'default']);
});
