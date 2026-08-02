#!/usr/bin/env node
// Regenerate the derived CLI reference from its in-repo sources:
//   reference-raw/<slug>.mdx    raw `ak --help` projection (machine source)
//   reference-prose/<slug>.md   reviewed prose overlays
// → content/docs/<channel>/reference/cli/<slug>.mdx
//
// CI runs this and asserts a zero diff (see .github/workflows/ci.yml): the
// reference is a pure function of committed sources, so regenerate-and-diff
// proves it equals generator(source + overlays) and that no hand edit survived.
// Idempotent; safe to run anytime.
//   node scripts/generate-reference.mjs [--channel beta]
import { parseArgs } from 'node:util';
import { repoRoot } from './lib/paths.mjs';
import { generateReference } from './lib/generate.mjs';

const { values } = parseArgs({ options: { channel: { type: 'string', default: 'beta' } } });
const n = await generateReference({ repoRoot, channel: values.channel });
console.error(`generate-reference: wrote ${n} derived pages in ${values.channel}/reference/cli.`);
