import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndexBody } from './lib/reference-index.mjs';

const PAGES = [
  { slug: 'ak', title: 'ak', description: 'AgentKit CLI' },
  { slug: 'ak_doctor', title: 'ak doctor', description: 'Run health checks' },
  { slug: 'ak_kit', title: 'ak kit', description: 'Kit management commands' },
  { slug: 'ak_kit_install', title: 'ak kit install', description: 'Install a kit | fast' },
  { slug: 'ak_kit_validate', title: 'ak kit validate', description: 'Validate a kit' },
];

test('groups multi-command families and keeps singles standalone', () => {
  const out = buildIndexBody(PAGES);
  // family section led by the parent command
  assert.match(out, /## `ak kit` — Kit management commands/);
  assert.match(out, /\[`ak kit install`\]\(\.\/ak_kit_install\)/);
  // standalone commands (root + doctor) fall under the flat Commands table
  assert.match(out, /## Commands\n\n\| Command \| Description \|/);
  assert.match(out, /\[`ak doctor`\]\(\.\/ak_doctor\)/);
  // `ak kit` rows live only in their family section, not in Commands
  const commandsSection = out.split('## `ak kit`')[0];
  assert.doesNotMatch(commandsSection, /ak_kit_install/);
});

test('escapes pipes in descriptions and links conventions', () => {
  const out = buildIndexBody(PAGES);
  assert.match(out, /Install a kit \\\| fast/);
  assert.match(out, /\[CLI conventions\]\(\.\.\/cli-conventions\)/);
});

test('MDX-escapes angle brackets in descriptions', () => {
  const out = buildIndexBody([
    ...PAGES,
    { slug: 'ak_plan_x', title: 'ak plan x', description: 'Append phase-NN-<slug>.md' },
    { slug: 'ak_plan', title: 'ak plan', description: 'Plan <tools>' },
  ]);
  assert.match(out, /phase-NN-&lt;slug>\.md/);
  assert.match(out, /## `ak plan` — Plan &lt;tools>/);
  assert.doesNotMatch(out, /\| Append phase-NN-<slug>/);
});

test('is deterministic regardless of input order', () => {
  const reversed = [...PAGES].reverse();
  assert.equal(buildIndexBody(reversed), buildIndexBody(PAGES));
});
