#!/usr/bin/env node
// Render reference-prose-json/<slug>.json → reference-prose/<slug>.md
//
// JSON is the LLM/agent wire format; markdown overlays feed generate-reference.mjs.
//   node scripts/compile-prose.mjs              # write all JSON sources
//   node scripts/compile-prose.mjs --check      # CI: fail if .md drift from JSON
//   node scripts/compile-prose.mjs --slug ak_foo
//   node scripts/compile-prose.mjs --export-missing  # bootstrap JSON from existing .md
import { parseArgs } from 'node:util';
import { repoRoot } from './lib/paths.mjs';
import {
  compileProseFromJson,
  exportMissingProseJson,
} from './lib/prose-json.mjs';

const { values } = parseArgs({
  options: {
    check: { type: 'boolean', default: false },
    slug: { type: 'string' },
    'export-missing': { type: 'boolean', default: false },
  },
});

if (values['export-missing']) {
  const n = await exportMissingProseJson({ repoRoot, slug: values.slug });
  console.error(`compile-prose: exported ${n} JSON overlay(s) to reference-prose-json/.`);
  process.exit(0);
}

const { written, checked, errors } = await compileProseFromJson({
  repoRoot,
  slug: values.slug,
  check: values.check,
});

if (errors.length) {
  for (const e of errors) console.error(`compile-prose: ${e}`);
  process.exit(1);
}

if (values.check) {
  console.error(`compile-prose: ${checked} JSON overlay(s) match reference-prose/.`);
} else {
  console.error(`compile-prose: wrote ${written} overlay(s) to reference-prose/.`);
}
