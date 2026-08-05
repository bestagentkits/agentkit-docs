#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { repoRoot } from './lib/paths.mjs';
import { emitMarkdownSiblings } from './lib/markdown-siblings.mjs';

// Post-build step (wired into `pnpm build`): copy every already-emitted
// `out/{lang}/llms.mdx/docs/{...}/content.md` to the sibling public URL
// `out/{lang}/{...}.md`, so each docs page is fetchable by appending `.md`.

async function main() {
  const { values } = parseArgs({
    options: { out: { type: 'string', default: 'out' } },
  });
  const outDir = resolve(repoRoot, values.out);
  if (!existsSync(outDir)) {
    throw new Error(`build output not found at ${outDir} — run \`pnpm build\` first`);
  }

  const { emitted, warnings } = await emitMarkdownSiblings(outDir);
  for (const warning of warnings) console.error(`emit-markdown-siblings: ${warning}`);

  if (emitted === 0) {
    // Zero emits means the `llms.mdx/docs` layout changed (or the build is
    // empty) and the mirror silently produced nothing — fail loudly.
    throw new Error(
      'no content.md sources found under out/{lang}/llms.mdx/docs — ' +
        'the llms.mdx emit layout may have changed',
    );
  }

  console.error(`emit-markdown-siblings: emitted ${emitted} sibling .md files`);
}

main().catch((error) => {
  console.error(`emit-markdown-siblings failed: ${error.message}`);
  process.exit(1);
});
