import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentPrViolations, generatedViolations, guardedDirs } from './lib/guards.mjs';
import { isInGeneratedDir } from './lib/generated-dirs.mjs';

const GENERATED = ['reference-derived'];

test('isInGeneratedDir matches marker and contents, not siblings', () => {
  assert.ok(isInGeneratedDir('reference-derived/ak.mdx', GENERATED));
  assert.ok(isInGeneratedDir('reference-derived/.generated', GENERATED));
  assert.ok(!isInGeneratedDir('content/docs/beta/reference/cli/index.en.mdx', GENERATED));
  assert.ok(!isInGeneratedDir('content/docs/beta/guides/updating.en.mdx', GENERATED));
});

test('generatedViolations flags derived pages', () => {
  const changed = [
    'reference-derived/ak.mdx',
    'reference-derived/.generated',
    'content/docs/beta/reference/cli/index.en.mdx',
    'content/docs/beta/guides/updating.en.mdx',
    'app/global.css',
  ];
  assert.deepEqual(generatedViolations(changed, GENERATED), [
    'reference-derived/ak.mdx',
    'reference-derived/.generated',
  ]);
});

test('guardedDirs exempts the reproducible derived dir', () => {
  // reference-derived is proven by the regenerate-and-diff CI step.
  assert.deepEqual(guardedDirs(GENERATED), []);
  assert.deepEqual(
    generatedViolations(['reference-derived/ak.mdx'], guardedDirs(GENERATED)),
    [],
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
  assert.equal(agentPrViolations([{ status: 'M', path: 'reference-derived/ak.mdx' }], GENERATED).length, 1);
  assert.equal(agentPrViolations([{ status: 'M', path: 'content/docs/beta/reference/cli/index.en.mdx' }], GENERATED).length, 1);
  // reference/ (incl. machine-written release-notes) is out of agent scope.
  assert.equal(agentPrViolations([{ status: 'M', path: 'content/docs/beta/reference/release-notes.mdx' }], GENERATED).length, 1);
  assert.equal(agentPrViolations([{ status: 'M', path: 'AGENTS.md' }], GENERATED).length, 1);
  assert.equal(agentPrViolations([{ status: 'M', path: 'channels.json' }], GENERATED).length, 1);
});
