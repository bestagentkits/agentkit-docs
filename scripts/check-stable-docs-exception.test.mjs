import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  checkStableDocsException,
  createStableDocsExceptionReceipt,
  stableDocsExceptionReceiptDigest,
} from './lib/stable-docs-exception.mjs';

const roots = [];
const ROUTE = 'guides/example';
const RECEIPT = 'stable-docs-exceptions/example.json';

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function write(root, path, body) {
  const absolute = join(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, body);
}

function commit(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', message]);
}

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'stable-docs-exception-'));
  roots.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'fixture@example.test']);
  git(root, ['config', 'user.name', 'Fixture']);
  await write(root, 'channels.json', '{"stable":{"tag":"v1.0.0"},"beta":{"tag":"v1.1.0-beta.1"}}\n');
  for (const channel of ['beta', 'stable']) {
    for (const locale of ['en', 'vi']) {
      await write(root, `content/docs/${channel}/${ROUTE}.${locale}.mdx`, `# Old ${locale}\n`);
    }
  }
  commit(root, 'fixture base');
  return { root, base: git(root, ['rev-parse', 'HEAD']) };
}

async function writeException(fixture, body = '# New guidance\n') {
  for (const channel of ['beta', 'stable']) {
    for (const locale of ['en', 'vi']) {
      await write(fixture.root, `content/docs/${channel}/${ROUTE}.${locale}.mdx`, `${body}${locale}\n`);
    }
  }
  commit(fixture.root, 'copy Beta route to Stable');
  const receipt = createStableDocsExceptionReceipt({ root: fixture.root, base: fixture.base, routes: [ROUTE] });
  await write(fixture.root, RECEIPT, `${JSON.stringify(receipt, null, 2)}\n`);
  commit(fixture.root, 'add exception receipt');
  return receipt;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test('valid receipt binds exact bilingual Beta and Stable postimages', async () => {
  const fixture = await makeFixture();
  const receipt = await writeException(fixture);
  const result = await checkStableDocsException({ root: fixture.root, base: fixture.base, receiptPath: RECEIPT });
  assert.equal(result.receipt.stableTag, 'v1.0.0');
  assert.deepEqual(result.receipt.routes, [ROUTE]);
  assert.equal(result.changedStablePaths.length, 2);
  assert.equal(result.receipt.receiptDigest, stableDocsExceptionReceiptDigest(receipt));
});

test('receipt rejects postimage tampering and an extra Stable path', async () => {
  const tampered = await makeFixture();
  await writeException(tampered);
  await write(tampered.root, `content/docs/stable/${ROUTE}.en.mdx`, '# Tampered\n');
  commit(tampered.root, 'tamper Stable postimage');
  await assert.rejects(
    () => checkStableDocsException({ root: tampered.root, base: tampered.base, receiptPath: RECEIPT }),
    /Stable postimages does not match committed postimages/,
  );

  const extra = await makeFixture();
  await writeException(extra);
  await write(extra.root, 'content/docs/stable/guides/unrelated.en.mdx', '# Extra\n');
  commit(extra.root, 'add unrelated Stable path');
  await assert.rejects(
    () => checkStableDocsException({ root: extra.root, base: extra.base, receiptPath: RECEIPT }),
    /Stable diff does not match receipt allowlist/,
  );
});

test('receipt rejects channels changes and non-identical Beta and Stable pages', async () => {
  const channels = await makeFixture();
  await writeException(channels);
  await write(channels.root, 'channels.json', '{"stable":{"tag":"v1.0.1"},"beta":{"tag":"v1.1.0-beta.1"}}\n');
  commit(channels.root, 'change channel identity');
  await assert.rejects(
    () => checkStableDocsException({ root: channels.root, base: channels.base, receiptPath: RECEIPT }),
    /channels.json preimage\/postimage binding mismatch/,
  );

  const mismatch = await makeFixture();
  await writeException(mismatch);
  await write(mismatch.root, `content/docs/beta/${ROUTE}.vi.mdx`, '# Beta-only drift\n');
  commit(mismatch.root, 'drift Beta source');
  await assert.rejects(
    () => checkStableDocsException({ root: mismatch.root, base: mismatch.base, receiptPath: RECEIPT }),
    /Beta postimages does not match committed postimages/,
  );
});

test('canonical digest and base binding are fail closed', async () => {
  const fixture = await makeFixture();
  const receipt = await writeException(fixture);
  receipt.stableTag = 'v9.9.9';
  await write(fixture.root, RECEIPT, `${JSON.stringify(receipt, null, 2)}\n`);
  commit(fixture.root, 'tamper receipt');
  await assert.rejects(
    () => checkStableDocsException({ root: fixture.root, base: fixture.base, receiptPath: RECEIPT }),
    /receipt canonical digest mismatch/,
  );

  const wrongBase = git(fixture.root, ['rev-parse', 'HEAD']);
  receipt.receiptDigest = stableDocsExceptionReceiptDigest(receipt);
  await write(fixture.root, RECEIPT, `${JSON.stringify(receipt, null, 2)}\n`);
  commit(fixture.root, 'reseal receipt');
  await assert.rejects(
    () => checkStableDocsException({ root: fixture.root, base: wrongBase, receiptPath: RECEIPT }),
    /receipt base .* does not match/,
  );
});
