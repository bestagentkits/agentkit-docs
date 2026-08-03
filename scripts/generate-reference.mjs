#!/usr/bin/env node
// Regenerate the derived CLI help dump from its in-repo sources:
//   reference-raw/<slug>.mdx    raw `ak --help` projection (machine source)
//   reference-prose/<slug>.md   reviewed prose overlays
// → reference-derived/<slug>.mdx
//
// CI runs this and asserts a zero diff (see .github/workflows/ci.yml): the
// dump is a pure function of committed sources, so regenerate-and-diff proves
// it equals generator(source + overlays) and that no hand edit survived.
// Idempotent; safe to run anytime.
//   node scripts/generate-reference.mjs
import { repoRoot } from './lib/paths.mjs';
import { DERIVED_DIR, generateReference } from './lib/generate.mjs';

const n = await generateReference({ repoRoot });
console.error(`generate-reference: wrote ${n} derived pages in ${DERIVED_DIR}/.`);
