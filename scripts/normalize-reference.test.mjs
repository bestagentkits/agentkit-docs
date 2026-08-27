import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReferenceMdx } from './lib/normalize-reference.mjs';

// A raw `cobra/doc` page exercising every structural quirk the normalizer must
// tame: duplicated title/description, the "What it does:/…" synopsis convention,
// an ASCII banner, entity-escaped example braces, MDX-risky flag descriptions,
// inherited flags, and tab-separated SEE ALSO links.
const RAW = `---
title: "ak demo"
description: "Demo command"
generated: true
---

## ak demo

Demo command

### Synopsis

                                  _    _
                                 / \\  | |
                                 AgentKit

What it does:
  Do a demonstrative thing with the project.

Who it's for:
  Both power devs and casual users.

When to use it:
  Run it after \`ak init\`.

Examples:
  ak demo --vars '&#123;"k":"v"&#125;'   # inline JSON
  ak demo --dry-run

What changes on disk:
  Writes ./.agentkit/demo.

Output modes:
  pretty   default on TTY
  json     --json envelope

Exit codes:
  0  success
  2  invalid flags
  5  demo target missing

\`\`\`
ak demo <name> [flags]
\`\`\`

### Options

\`\`\`
  -h, --help            help for demo
      --target string   Adapter: claude-code | codex (default "claude-code")
      --id string       Restore positional <id>
\`\`\`

### Options inherited from parent commands

\`\`\`
      --cwd string   Project directory override
\`\`\`

### SEE ALSO

* [ak](./ak)\t - AgentKit CLI
* [ak demo child](./ak_demo_child)\t - A child command
`;

test('drops the duplicated title and description headings', () => {
  const out = normalizeReferenceMdx(RAW);
  assert.doesNotMatch(out, /^## ak demo$/m);
  assert.doesNotMatch(out, /^Demo command$/m);
  // frontmatter is preserved verbatim
  assert.match(out, /^---\ntitle: "ak demo"\ndescription: "Demo command"\ngenerated: true\n---/);
});

test('splits the synopsis convention into prose + labelled context', () => {
  const out = normalizeReferenceMdx(RAW);
  assert.match(out, /Do a demonstrative thing with the project\./);
  assert.match(out, /\*\*Who it's for:\*\* Both power devs and casual users\./);
  assert.match(out, /\*\*When to use it:\*\* Run it after `ak init`\./);
  assert.match(out, /\*\*What changes on disk:\*\* Writes \.\/\.agentkit\/demo\./);
});

test('strips the ASCII-art banner', () => {
  const out = normalizeReferenceMdx(RAW);
  assert.doesNotMatch(out, /AgentKit\n/);
  assert.doesNotMatch(out, /\/ \\/);
});

test('examples become a fenced block with decoded entities', () => {
  const out = normalizeReferenceMdx(RAW);
  assert.match(out, /### Examples\n\n```bash\nak demo --vars '\{"k":"v"\}'/);
  assert.doesNotMatch(out, /&#123;/); // decoded inside the code fence
});

test('usage is lifted under its own heading', () => {
  const out = normalizeReferenceMdx(RAW);
  assert.match(out, /### Usage\n\n```bash\nak demo <name> \[flags\]\n```/);
});

test('flags render as a table with MDX-safe cells', () => {
  const out = normalizeReferenceMdx(RAW);
  assert.match(out, /### Flags\n\n\| Flag \| Description \|/);
  // `|` inside a description is escaped so it does not split the column
  assert.match(out, /claude-code \\\| codex/);
  // `<id>` is escaped so MDX does not parse it as JSX
  assert.match(out, /Restore positional &lt;id>/);
});

test('universal flags are deduped to the conventions page', () => {
  const out = normalizeReferenceMdx(RAW);
  assert.doesNotMatch(out, /\| `-h, --help` \|/);
  assert.match(out, /see \[CLI conventions\]\(\.\.\/cli-conventions\)/);
  // command-specific flags survive
  assert.match(out, /\| `--target string` \|/);
});

test('inherited flags get their own table', () => {
  const out = normalizeReferenceMdx(RAW);
  assert.match(out, /### Inherited flags\n\n\| Flag \| Description \|/);
  assert.match(out, /\| `--cwd string` \| Project directory override \|/);
});

test('non-canonical output modes stay; standard exit codes are deduped', () => {
  const out = normalizeReferenceMdx(RAW);
  // this fixture's modes differ from the canonical trio, so the table stays
  assert.match(out, /### Output modes\n\n\| Mode \| Behavior \|\n\| --- \| --- \|\n\| `pretty` \| default on TTY \|/);
  // standard rows (0/2 with standard meanings) are deduped; the extra code stays
  assert.match(out, /### Exit codes\n\n\| Code \| Meaning \|\n\| --- \| --- \|\n\| `5` \| demo target missing \|/);
  assert.doesNotMatch(out, /\| `0` \| success \|/);
});

test('a fully standard exit-code table is dropped entirely', () => {
  const raw = RAW.replace(
    'Exit codes:\n  0  success\n  2  invalid flags\n  5  demo target missing',
    'Exit codes:\n  0  success\n  2  invalid flags',
  );
  const out = normalizeReferenceMdx(raw);
  assert.doesNotMatch(out, /### Exit codes/);
});

test('an overloaded standard code with different meaning survives', () => {
  const raw = RAW.replace('2  invalid flags', '2  invalid filters');
  const out = normalizeReferenceMdx(raw);
  assert.match(out, /\| `2` \| invalid filters \|/);
});

test('the task-first Exit status block dedupes the reworded base set', () => {
  const raw = RAW.replace(
    'Exit codes:\n  0  success\n  2  invalid flags\n  5  demo target missing',
    'Exit status:\n  0   success\n  1   command failure\n  2   invalid flags or arguments\n  5   demo target missing',
  );
  const out = normalizeReferenceMdx(raw);
  assert.match(out, /### Exit codes\n\n\| Code \| Meaning \|\n\| --- \| --- \|\n\| `5` \| demo target missing \|/);
  assert.doesNotMatch(out, /\| `1` \| command failure \|/);
  assert.doesNotMatch(out, /\| `2` \| invalid flags or arguments \|/);
  assert.doesNotMatch(out, /\*\*Exit status:\*\*/);
});

test('a comma-joined Exit status line carrying only the base set is dropped', () => {
  const raw = RAW.replace(
    'Exit codes:\n  0  success\n  2  invalid flags\n  5  demo target missing',
    'Exit status:\n  0 success, 1 command failure, 2 invalid flags or arguments',
  );
  const out = normalizeReferenceMdx(raw);
  assert.doesNotMatch(out, /### Exit codes/);
  assert.doesNotMatch(out, /\*\*Exit status:\*\*/);
  assert.match(out, /base exit codes \(`0`–`2`\)/);
});

test('code 3 is no longer universal and stays on the page', () => {
  const raw = RAW.replace(
    'Exit codes:\n  0  success\n  2  invalid flags\n  5  demo target missing',
    'Exit status:\n  0   success\n  3   preview complete (re-run with --yes to apply)',
  );
  const out = normalizeReferenceMdx(raw);
  assert.match(out, /\| `3` \| preview complete \(re-run with --yes to apply\) \|/);
});

test('SEE ALSO tabs become a clean related-commands list', () => {
  const out = normalizeReferenceMdx(RAW);
  assert.match(out, /### Related commands\n\n- \[`ak`\]\(\.\/ak\) — AgentKit CLI\n- \[`ak demo child`\]\(\.\/ak_demo_child\) — A child command/);
  assert.doesNotMatch(out, /\t/); // no tab characters survive
  assert.doesNotMatch(out, /### SEE ALSO/);
});

test('a prose overlay replaces the mechanical lead but keeps the facts', () => {
  const prose = '`ak demo` is a hand-written overview.\n\n**When to use it:** whenever.';
  const out = normalizeReferenceMdx(RAW, { prose });
  assert.match(out, /`ak demo` is a hand-written overview\./);
  // mechanical synopsis prose is gone…
  assert.doesNotMatch(out, /Do a demonstrative thing/);
  assert.doesNotMatch(out, /\*\*Who it's for:\*\*/);
  // …but the deterministic facts remain
  assert.match(out, /### Flags/);
  assert.match(out, /### Exit codes/);
});

test('normalization is idempotent and skips already-normalized input', () => {
  const once = normalizeReferenceMdx(RAW);
  assert.equal(normalizeReferenceMdx(once), once);
  // an already-clean page is returned untouched
  const clean = '---\ntitle: x\n---\n\nJust prose, no cobra markers.\n';
  assert.equal(normalizeReferenceMdx(clean), clean);
});
