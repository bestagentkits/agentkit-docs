import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateReference } from './lib/generate.mjs';

let repoRoot;
let cliDir;

const RAW_DEMO = `---
title: "ak demo"
description: "Demo command"
generated: true
---

## ak demo

Demo command

### Synopsis

What it does:
  Do a demonstrative thing.

### Options

\`\`\`
  -h, --help        help for demo
      --id string   Demo id
\`\`\`

### SEE ALSO

* [ak](./ak)\t - AgentKit CLI
`;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'gen-test-'));
  await mkdir(join(repoRoot, 'reference-raw'), { recursive: true });
  await mkdir(join(repoRoot, 'reference-prose'), { recursive: true });
  await writeFile(join(repoRoot, 'reference-raw', 'ak_demo.mdx'), RAW_DEMO);

  cliDir = join(repoRoot, 'content', 'docs', 'beta', 'reference', 'cli');
  await mkdir(cliDir, { recursive: true });
  // Human nav + marker (must survive) and a stale derived page (must vanish).
  await writeFile(join(cliDir, 'meta.json'), '{"title":"CLI commands"}\n');
  await writeFile(join(cliDir, '.generated'), '{"tag":"v1"}\n');
  await writeFile(join(cliDir, 'ak_gone.mdx'), '---\ntitle: gone\n---\n');
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

test('generates derived pages, drops stale, preserves nav + marker', async () => {
  const n = await generateReference({ repoRoot, channel: 'beta' });
  assert.equal(n, 1);

  const page = await readFile(join(cliDir, 'ak_demo.mdx'), 'utf8');
  assert.doesNotMatch(page, /### Synopsis/); // normalized
  assert.match(page, /### Flags/);
  assert.match(page, /### Related commands/);

  assert.ok(!existsSync(join(cliDir, 'ak_gone.mdx')), 'stale derived page removed');
  assert.equal(await readFile(join(cliDir, 'meta.json'), 'utf8'), '{"title":"CLI commands"}\n');
  assert.equal(await readFile(join(cliDir, '.generated'), 'utf8'), '{"tag":"v1"}\n');
});

test('merges the prose overlay when present', async () => {
  await writeFile(
    join(repoRoot, 'reference-prose', 'ak_demo.md'),
    '`ak demo` is a hand-written overview.\n',
  );
  await generateReference({ repoRoot, channel: 'beta' });
  const page = await readFile(join(cliDir, 'ak_demo.mdx'), 'utf8');
  assert.match(page, /`ak demo` is a hand-written overview\./);
  assert.doesNotMatch(page, /Do a demonstrative thing/); // mechanical lead replaced
  assert.match(page, /### Flags/); // facts still generated
});

test('is idempotent', async () => {
  await generateReference({ repoRoot, channel: 'beta' });
  const first = await readFile(join(cliDir, 'ak_demo.mdx'), 'utf8');
  await generateReference({ repoRoot, channel: 'beta' });
  const second = await readFile(join(cliDir, 'ak_demo.mdx'), 'utf8');
  assert.equal(second, first);
});
