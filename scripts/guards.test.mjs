import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentPrViolations, generatedViolations, guardedDirs } from './lib/guards.mjs';
import { isInGeneratedDir } from './lib/generated-dirs.mjs';

const GENERATED = [
  'content/docs/beta/reference/cli',
  'content/docs/stable/reference/cli',
];

test('isInGeneratedDir matches marker and contents, not siblings', () => {
  assert.ok(isInGeneratedDir('content/docs/beta/reference/cli/ak.mdx', GENERATED));
  assert.ok(isInGeneratedDir('content/docs/beta/reference/cli/.generated', GENERATED));
  assert.ok(!isInGeneratedDir('content/docs/beta/reference/release-notes.mdx', GENERATED));
  assert.ok(!isInGeneratedDir('content/docs/beta/guides/updating.en.mdx', GENERATED));
});

test('generatedViolations flags generated pages but exempts human nav meta', () => {
  const changed = [
    'content/docs/beta/reference/cli/ak.mdx',
    'content/docs/beta/reference/cli/.generated',
    'content/docs/beta/reference/cli/meta.json', // human nav — exempt
    'content/docs/beta/reference/cli/meta.vi.json', // human nav — exempt
    'content/docs/beta/guides/updating.en.mdx',
    'app/global.css',
  ];
  assert.deepEqual(generatedViolations(changed, GENERATED), [
    'content/docs/beta/reference/cli/ak.mdx',
    'content/docs/beta/reference/cli/.generated',
  ]);
});

test('guardedDirs exempts the reproducible reference dir, keeps the rest', () => {
  // beta/reference/cli is proven by the regenerate-and-diff CI step, so the
  // hand-edit guard drops it; stable/reference/cli (a promotion copy) stays.
  assert.deepEqual(guardedDirs(GENERATED), ['content/docs/stable/reference/cli']);
  // With beta exempted, an edit to a beta reference page is no longer a violation.
  assert.deepEqual(
    generatedViolations(['content/docs/beta/reference/cli/ak.mdx'], guardedDirs(GENERATED)),
    [],
  );
  // …but a stable reference edit still is.
  assert.deepEqual(
    generatedViolations(['content/docs/stable/reference/cli/ak.mdx'], guardedDirs(GENERATED)),
    ['content/docs/stable/reference/cli/ak.mdx'],
  );
});

test('agent PR: a modify-only beta prose patch is allowed', () => {
  const changes = [
    { status: 'M', path: 'content/docs/beta/guides/updating.en.mdx' },
    { status: 'M', path: 'content/docs/beta/getting-started/quickstart.en.mdx' },
  ];
  assert.deepEqual(agentPrViolations(changes, GENERATED), []);
});

test('agent PR: added / deleted / renamed files fail', () => {
  assert.equal(agentPrViolations([{ status: 'A', path: 'content/docs/beta/guides/new.mdx' }], GENERATED).length, 1);
  assert.equal(agentPrViolations([{ status: 'D', path: 'content/docs/beta/guides/updating.en.mdx' }], GENERATED).length, 1);
  assert.equal(agentPrViolations([{ status: 'R100', path: 'content/docs/beta/guides/x.mdx' }], GENERATED).length, 1);
});

test('agent PR: stable / workflow / generated / reference touches fail', () => {
  assert.equal(agentPrViolations([{ status: 'M', path: 'content/docs/stable/guides/updating.en.mdx' }], GENERATED).length, 1);
  assert.equal(agentPrViolations([{ status: 'M', path: '.github/workflows/ci.yml' }], GENERATED).length, 1);
  assert.equal(agentPrViolations([{ status: 'M', path: 'content/docs/beta/reference/cli/ak.mdx' }], GENERATED).length, 1);
  // reference/ (incl. machine-written release-notes) is out of agent scope.
  assert.equal(agentPrViolations([{ status: 'M', path: 'content/docs/beta/reference/release-notes.mdx' }], GENERATED).length, 1);
  assert.equal(agentPrViolations([{ status: 'M', path: 'AGENTS.md' }], GENERATED).length, 1);
  assert.equal(agentPrViolations([{ status: 'M', path: 'channels.json' }], GENERATED).length, 1);
});
