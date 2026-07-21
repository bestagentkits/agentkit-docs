#!/usr/bin/env node
// Agent-PR scope guard: the docs agent may only MODIFY beta prose. Adds,
// deletes, renames, stable/ edits, generated-dir edits, and denylisted paths
// all fail. Enforced on the diff, never on prompt trust.
//
//   node scripts/check-agent-pr.mjs --base origin/main
import { parseArgs } from 'node:util';
import { changedNameStatus } from './lib/git.mjs';
import { findGeneratedDirs } from './lib/generated-dirs.mjs';
import { agentPrViolations } from './lib/guards.mjs';
import { repoRoot } from './lib/paths.mjs';

async function main() {
  const { values } = parseArgs({
    options: {
      base: { type: 'string' },
      repoRoot: { type: 'string', default: repoRoot },
    },
  });

  const changes = changedNameStatus(values.base, { cwd: values.repoRoot });
  const generatedDirs = await findGeneratedDirs(values.repoRoot);
  const violations = agentPrViolations(changes, generatedDirs);

  if (violations.length) {
    console.error('check-agent-pr: this PR is out of the agent scope (modify-only, content/docs/beta prose):');
    for (const v of violations) console.error(`  ✗ ${v}`);
    process.exit(1);
  }
  console.error(`check-agent-pr: ${changes.length} change(s) within agent scope.`);
}

main().catch((err) => {
  console.error(`check-agent-pr failed: ${err.message}`);
  process.exit(1);
});
