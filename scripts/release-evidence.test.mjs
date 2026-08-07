import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  classifyReceipt,
  createLegacyDocsBackfillProvenance,
  DOCS_BACKFILL_PROVENANCE_NAME,
  inspectStableReplay,
  inspectTarGz,
  ReleaseEvidenceError,
  selectReleaseAssets,
  validateChannelAdvance,
  validateBetaReplay,
  validateStableReplayTree,
  validateDispatchPayload,
  verifyReleaseEvidence,
} from './lib/release-evidence.mjs';

const payload = {
  channel: 'beta',
  tag: 'v2.8.0-beta.7',
  sha: '1234567890abcdef1234567890abcdef12345678',
};

const legacyPayload = {
  channel: 'beta',
  tag: 'v2.8.0-beta.14',
  sha: 'fb99155ba6dd173e137a69ffee6122b80441fe56',
};

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

async function initGitRepo(root) {
  git(root, 'init', '--quiet');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'user.email', 'test@example.com');
  await writeFile(join(root, 'base.txt'), 'base\n');
  git(root, 'add', 'base.txt');
  git(root, 'commit', '--quiet', '-m', 'base');
}

function octal(value, width) {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

function tar(entries) {
  const blocks = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? '');
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100, 'utf8');
    header.write(octal(entry.type === '5' ? 0o755 : 0o644, 8), 100, 8, 'ascii');
    header.write(octal(0, 8), 108, 8, 'ascii');
    header.write(octal(0, 8), 116, 8, 'ascii');
    header.write(octal(entry.type === '5' ? 0 : body.length, 12), 124, 12, 'ascii');
    header.write(octal(0, 12), 136, 12, 'ascii');
    header.fill(32, 148, 156);
    header.write(entry.type ?? '0', 156, 1, 'ascii');
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    const sum = header.reduce((total, byte) => total + byte, 0);
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
    blocks.push(header);
    if (entry.type !== '5') {
      blocks.push(body, Buffer.alloc((512 - (body.length % 512)) % 512));
    }
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function validArchive(extra = [], identity = payload) {
  const manifest = `${JSON.stringify({
    schemaVersion: 1,
    channel: identity.channel,
    tag: identity.tag,
    sha: identity.sha,
    version: identity.tag.slice(1),
    generatedAt: '2026-08-04T00:00:00Z',
    ...(identity.channel === 'stable' ? { promotedFrom: `${identity.tag}-beta.7` } : {}),
  }, null, 2)}\n`;
  return tar([
    { name: 'reference', type: '5' },
    { name: 'reference/cli', type: '5' },
    { name: 'manifest.json', body: manifest },
    { name: 'release-notes.md', body: '# Notes\n' },
    { name: 'reference/cli/ak.mdx', body: '---\ntitle: ak\ngenerated: true\n---\n' },
    { name: 'reference/cli/index.mdx', body: '---\ntitle: CLI\ngenerated: true\n---\n' },
    ...extra,
  ]);
}

async function fixture(root, overrides = {}) {
  const identity = overrides.payload ?? payload;
  const assetsDir = join(root, 'assets');
  await mkdir(assetsDir);
  const archive = overrides.archive ?? validArchive([], identity);
  const archiveDigest = digest(archive);
  const sidecar = Buffer.from(overrides.sidecar ?? `${archiveDigest}  docs-bundle.tar.gz\n`);
  const sidecarDigest = digest(sidecar);
  const provenanceArtifacts = overrides.legacyBackfill ? [] : [
    {
      githubAssetId: 11,
      githubDigest: `sha256:${archiveDigest}`,
      name: 'docs-bundle.tar.gz',
      sha256: archiveDigest,
      size: archive.length,
    },
    {
      githubAssetId: 12,
      githubDigest: `sha256:${sidecarDigest}`,
      name: 'docs-bundle.tar.gz.sha256',
      sha256: sidecarDigest,
      size: sidecar.length,
    },
  ];
  const provenance = Buffer.from(JSON.stringify({
    schemaVersion: 'agentkit-release-provenance.v1',
    releaseTag: identity.tag,
    channel: identity.channel,
    snapshotSha: overrides.snapshotSha ?? identity.sha,
    promotedSourceSha: identity.sha,
    artifacts: provenanceArtifacts,
  }, null, 2) + '\n');
  const files = new Map([
    ['docs-bundle.tar.gz', { id: 11, bytes: archive }],
    ['docs-bundle.tar.gz.sha256', { id: 12, bytes: sidecar }],
    ['release-provenance.json', { id: 13, bytes: provenance }],
  ]);
  const assetRecord = (name) => {
    const item = files.get(name);
    const sha256 = digest(item.bytes);
    return {
      githubAssetId: item.id,
      githubDigest: `sha256:${sha256}`,
      name,
      sha256,
      size: item.bytes.length,
    };
  };
  if (overrides.legacyBackfill) {
    const backfill = Buffer.from(`${JSON.stringify({
      schemaVersion: 'agentkit-docs-backfill-provenance.v1',
      releaseTag: identity.tag,
      channel: identity.channel,
      snapshotSha: overrides.snapshotSha ?? identity.sha,
      promotedSourceSha: identity.sha,
      tooling: {
        repository: 'bestagentkits/agentkit',
        commit: '69fccfd32bf48acb4fd30c38556819bae82cef38',
      },
      baseProvenance: assetRecord('release-provenance.json'),
      artifacts: [assetRecord('docs-bundle.tar.gz'), assetRecord('docs-bundle.tar.gz.sha256')],
    }, null, 2)}\n`);
    files.set(DOCS_BACKFILL_PROVENANCE_NAME, { id: 14, bytes: backfill });
  }
  for (const [name, item] of files) await writeFile(join(assetsDir, name), item.bytes);
  const release = {
    id: 99,
    tag_name: identity.tag,
    assets: [...files].map(([name, item]) => ({
      id: item.id,
      name,
      size: item.bytes.length,
      digest: `sha256:${digest(item.bytes)}`,
    })),
  };
  return { assetsDir, release };
}

test('dispatch payload requires a channel-shaped tag and exact lowercase source sha', () => {
  assert.deepEqual(validateDispatchPayload(payload), payload);
  assert.throws(() => validateDispatchPayload({ ...payload, sha: payload.sha.toUpperCase() }), /40 lowercase/);
  assert.throws(() => validateDispatchPayload({ ...payload, tag: 'v2.8.0' }), /does not match/);
  assert.throws(() => validateDispatchPayload({ ...payload, channel: 'staging' }), /beta or stable/);
});

test('release-evidence CLI validates a payload file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'release-evidence-cli-'));
  try {
    const path = join(root, 'payload.json');
    await writeFile(path, JSON.stringify(payload));
    const result = spawnSync(process.execPath, ['scripts/release-evidence.mjs', 'payload', '--payload', path], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), payload);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a new receipt cannot move a channel backward or repeat an unreceipted tag', () => {
  const channels = { beta: { version: '2.8.0-beta.6', tag: 'v2.8.0-beta.6' } };
  assert.deepEqual(validateChannelAdvance(payload, channels), payload);
  assert.throws(
    () => validateChannelAdvance({ ...payload, tag: 'v2.8.0-beta.6' }, channels),
    /does not advance/,
  );
  assert.throws(
    () => validateChannelAdvance({ ...payload, tag: 'v2.7.9-beta.99' }, channels),
    /stale beta release/,
  );
  assert.doesNotThrow(() => validateChannelAdvance(payload, { beta: { version: null, tag: null } }));
});

test('release selection requires one immutable identity for every evidence asset', () => {
  const release = {
    id: 9,
    tag_name: payload.tag,
    assets: ['docs-bundle.tar.gz', 'docs-bundle.tar.gz.sha256', 'release-provenance.json']
      .map((name, index) => ({ id: index + 1, name, size: 1, digest: `sha256:${'a'.repeat(64)}` })),
  };
  assert.equal(selectReleaseAssets(release, payload).assets.length, 3);
  assert.throws(
    () => selectReleaseAssets({ ...release, assets: [...release.assets, release.assets[0]] }, payload),
    /exactly one docs-bundle.tar.gz/,
  );
  assert.throws(
    () => selectReleaseAssets({ ...release, assets: release.assets.slice(1) }, payload),
    /exactly one docs-bundle.tar.gz/,
  );
  assert.throws(
    () => selectReleaseAssets({ ...release, assets: release.assets.map((asset) => ({ ...asset, digest: null })) }, payload),
    /GitHub digest/,
  );
});

test('verified release evidence binds GitHub bytes, provenance, sidecar, manifest, and extraction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'release-evidence-'));
  try {
    const { assetsDir, release } = await fixture(root);
    const bundleDir = join(root, 'bundle');
    const result = await verifyReleaseEvidence({ payload, release, assetsDir, bundleDir });
    assert.equal(result.manifest.sha, payload.sha);
    assert.equal(result.receipt.releaseId, 99);
    assert.match(await readFile(join(bundleDir, 'reference/cli/ak.mdx'), 'utf8'), /generated: true/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the exact beta.14 legacy tuple uses supplemental provenance without replacing release provenance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'release-evidence-backfill-'));
  try {
    const { assetsDir, release } = await fixture(root, {
      payload: legacyPayload,
      legacyBackfill: true,
    });
    const selection = selectReleaseAssets(release, legacyPayload);
    assert.equal(selection.assets.length, 4);
    const generated = createLegacyDocsBackfillProvenance(release, legacyPayload);
    assert.equal(generated, await readFile(join(assetsDir, DOCS_BACKFILL_PROVENANCE_NAME), 'utf8'));
    const releasePath = join(root, 'release.json');
    const payloadPath = join(root, 'payload.json');
    const outputPath = join(root, 'generated-backfill.json');
    await writeFile(releasePath, JSON.stringify(release));
    await writeFile(payloadPath, JSON.stringify(legacyPayload));
    const command = spawnSync(process.execPath, [
      'scripts/release-evidence.mjs', 'legacy-backfill-provenance',
      '--release', releasePath,
      '--payload', payloadPath,
      '--output', outputPath,
    ], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
    });
    assert.equal(command.status, 0, command.stderr);
    assert.equal(await readFile(outputPath, 'utf8'), generated);
    const result = await verifyReleaseEvidence({
      payload: legacyPayload,
      release,
      assetsDir,
      bundleDir: join(root, 'bundle'),
    });
    assert.equal(result.receipt.assets.length, 4);
    assert.equal(result.receipt.snapshotSha, legacyPayload.sha);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy supplemental provenance is tuple-scoped and binds the immutable base provenance identity', async () => {
  const missingRoot = await mkdtemp(join(tmpdir(), 'release-evidence-backfill-missing-'));
  const tamperedRoot = await mkdtemp(join(tmpdir(), 'release-evidence-backfill-tampered-'));
  try {
    const missing = await fixture(missingRoot, { payload: legacyPayload });
    await assert.rejects(
      async () => selectReleaseAssets(missing.release, legacyPayload),
      /exactly one docs-backfill-provenance.json/,
    );

    const tampered = await fixture(tamperedRoot, {
      payload: legacyPayload,
      legacyBackfill: true,
    });
    const backfillPath = join(tampered.assetsDir, DOCS_BACKFILL_PROVENANCE_NAME);
    const value = JSON.parse(await readFile(backfillPath, 'utf8'));
    value.baseProvenance.githubAssetId = 999;
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    await writeFile(backfillPath, bytes);
    const asset = tampered.release.assets.find((candidate) => candidate.name === DOCS_BACKFILL_PROVENANCE_NAME);
    asset.size = bytes.length;
    asset.digest = `sha256:${digest(bytes)}`;
    await assert.rejects(
      () => verifyReleaseEvidence({
        payload: legacyPayload,
        release: tampered.release,
        assetsDir: tampered.assetsDir,
        bundleDir: join(tamperedRoot, 'bundle'),
      }),
      /base provenance identity mismatch/,
    );

    const unrelatedRelease = structuredClone(tampered.release);
    unrelatedRelease.tag_name = payload.tag;
    assert.throws(
      () => selectReleaseAssets(unrelatedRelease, payload),
      /allowed only for an explicit legacy release tuple/,
    );
  } finally {
    await rm(missingRoot, { recursive: true, force: true });
    await rm(tamperedRoot, { recursive: true, force: true });
  }
});

test('stable evidence binds the promoted source while allowing a distinct snapshot sha', async () => {
  const root = await mkdtemp(join(tmpdir(), 'release-evidence-stable-'));
  const stablePayload = { channel: 'stable', tag: 'v2.8.0', sha: payload.sha };
  try {
    const { assetsDir, release } = await fixture(root, {
      payload: stablePayload,
      snapshotSha: 'abcdef1234567890abcdef1234567890abcdef12',
    });
    const result = await verifyReleaseEvidence({
      payload: stablePayload,
      release,
      assetsDir,
      bundleDir: join(root, 'bundle'),
    });
    assert.equal(result.receipt.snapshotSha, 'abcdef1234567890abcdef1234567890abcdef12');
    assert.equal(result.manifest.promotedFrom, 'v2.8.0-beta.7');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('verification fails before extraction on byte, sidecar, provenance, or manifest mismatch', async () => {
  for (const scenario of ['bytes', 'sidecar', 'provenance', 'manifest']) {
    const root = await mkdtemp(join(tmpdir(), `release-evidence-${scenario}-`));
    try {
      const overrides = scenario === 'sidecar'
        ? { sidecar: `${'0'.repeat(64)}  docs-bundle.tar.gz\n` }
        : scenario === 'manifest'
          ? { archive: validArchive([], { ...payload, sha: 'f'.repeat(40) }) }
          : {};
      const { assetsDir, release } = await fixture(root, overrides);
      if (scenario === 'bytes') await writeFile(join(assetsDir, 'docs-bundle.tar.gz'), 'tampered');
      if (scenario === 'provenance') {
        const path = join(assetsDir, 'release-provenance.json');
        const value = JSON.parse(await readFile(path, 'utf8'));
        value.promotedSourceSha = 'f'.repeat(40);
        const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
        await writeFile(path, bytes);
        const record = release.assets.find((asset) => asset.name === 'release-provenance.json');
        record.size = bytes.length;
        record.digest = `sha256:${digest(bytes)}`;
      }
      const bundleDir = join(root, 'bundle');
      await assert.rejects(
        () => verifyReleaseEvidence({ payload, release, assetsDir, bundleDir }),
        ReleaseEvidenceError,
      );
      await assert.rejects(() => readFile(join(bundleDir, 'manifest.json')), /ENOENT/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('same-size downloaded-byte tampering is rejected by the GitHub digest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'release-evidence-same-size-'));
  try {
    const { assetsDir, release } = await fixture(root);
    const path = join(assetsDir, 'docs-bundle.tar.gz');
    const bytes = await readFile(path);
    bytes[bytes.length - 1] ^= 1;
    await writeFile(path, bytes);
    await assert.rejects(
      () => verifyReleaseEvidence({ payload, release, assetsDir, bundleDir: join(root, 'bundle') }),
      /digest mismatch/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('provenance must uniquely match the selected GitHub asset identity', async () => {
  for (const scenario of ['duplicate', 'asset-id', 'sha256']) {
    const root = await mkdtemp(join(tmpdir(), `release-provenance-${scenario}-`));
    try {
      const { assetsDir, release } = await fixture(root);
      const path = join(assetsDir, 'release-provenance.json');
      const value = JSON.parse(await readFile(path, 'utf8'));
      if (scenario === 'duplicate') value.artifacts.push({ ...value.artifacts[0] });
      if (scenario === 'asset-id') value.artifacts[0].githubAssetId = 999;
      if (scenario === 'sha256') value.artifacts[0].sha256 = 'f'.repeat(64);
      const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
      await writeFile(path, bytes);
      const record = release.assets.find((asset) => asset.name === 'release-provenance.json');
      record.size = bytes.length;
      record.digest = `sha256:${digest(bytes)}`;
      await assert.rejects(
        () => verifyReleaseEvidence({ payload, release, assetsDir, bundleDir: join(root, 'bundle') }),
        ReleaseEvidenceError,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('tar inspection rejects traversal, duplicate entries, and links or special files', () => {
  for (const extra of [
    [{ name: '../escape', body: 'x' }],
    [{ name: 'manifest.json', body: '{}' }],
    [{ name: 'reference/cli/hardlink.mdx', type: '1', body: '' }],
    [{ name: 'reference/cli/link.mdx', type: '2', body: '' }],
    [{ name: 'reference/cli/device', type: '3', body: '' }],
  ]) {
    assert.throws(() => inspectTarGz(validArchive(extra)), ReleaseEvidenceError);
  }
});

test('tar inspection rejects missing end markers and trailing content', () => {
  const expanded = gunzipSync(validArchive());
  assert.throws(() => inspectTarGz(gzipSync(expanded.subarray(0, -1024))), /end marker/);
  assert.throws(() => inspectTarGz(gzipSync(Buffer.concat([expanded, Buffer.from('trailing')]))), /trailing data/);
});

test('canonical receipts make exact replay a no-op and reject conflicts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'release-receipt-'));
  try {
    const path = join(root, 'receipt.json');
    const candidate = `${JSON.stringify({ schemaVersion: 'v1', tag: payload.tag }, null, 2)}\n`;
    assert.equal(await classifyReceipt(path, candidate), 'new');
    await writeFile(path, candidate);
    assert.equal(await classifyReceipt(path, candidate), 'replay');
    await assert.rejects(() => classifyReceipt(path, `${JSON.stringify({ schemaVersion: 'v1', tag: 'other' }, null, 2)}\n`), /conflicting/);
    await writeFile(path, JSON.stringify({ schemaVersion: 'v1', tag: payload.tag }));
    await assert.rejects(() => classifyReceipt(path, candidate), /not canonical/);
    await assert.rejects(() => classifyReceipt(path, '{broken'), /candidate release receipt is not valid JSON/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('beta replay requires the docs tag to remain on the receipt-introducing commit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'beta-replay-'));
  const receiptPath = `release-sync-receipts/beta/${payload.tag}.json`;
  const candidate = `${JSON.stringify({ schemaVersion: 'receipt.v1', tag: payload.tag }, null, 2)}\n`;
  try {
    await initGitRepo(root);
    await mkdir(join(root, 'release-sync-receipts', 'beta'), { recursive: true });
    await writeFile(join(root, receiptPath), candidate);
    git(root, 'add', receiptPath);
    git(root, 'commit', '--quiet', '-m', `docs-sync: beta ${payload.tag}`);
    const syncCommit = git(root, 'rev-parse', 'HEAD');
    git(root, 'tag', `docs/${payload.tag}`);
    await writeFile(join(root, 'later.txt'), 'later\n');
    git(root, 'add', 'later.txt');
    git(root, 'commit', '--quiet', '-m', 'later dev change');

    assert.equal(validateBetaReplay({ repoRoot: root, tag: payload.tag, receiptPath, candidateText: candidate }), syncCommit);
    git(root, 'tag', '--force', `docs/${payload.tag}`, 'HEAD');
    assert.throws(
      () => validateBetaReplay({ repoRoot: root, tag: payload.tag, receiptPath, candidateText: candidate }),
      /receipt-introducing commit/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stable replay validates the original promotion tree after dev advances', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stable-replay-'));
  const stableTag = 'v2.8.0';
  const receiptPath = `release-sync-receipts/stable/${stableTag}.json`;
  const candidate = `${JSON.stringify({ schemaVersion: 'receipt.v1', tag: stableTag }, null, 2)}\n`;
  try {
    await initGitRepo(root);
    const base = git(root, 'rev-parse', 'HEAD');
    git(root, 'switch', '--quiet', '-c', 'docs-promotion');
    await mkdir(join(root, 'release-sync-receipts', 'stable'), { recursive: true });
    await writeFile(join(root, receiptPath), candidate);
    await writeFile(join(root, 'stable.txt'), 'promoted\n');
    git(root, 'add', receiptPath, 'stable.txt');
    git(root, 'commit', '--quiet', '-m', `docs-promotion: ${stableTag}`);
    const promotionTree = git(root, 'rev-parse', 'HEAD^{tree}');
    git(root, 'switch', '--quiet', '-c', 'dev', base);
    await writeFile(join(root, 'unrelated.txt'), 'new dev work\n');
    git(root, 'add', 'unrelated.txt');
    git(root, 'commit', '--quiet', '-m', 'unrelated dev change');
    assert.notEqual(git(root, 'rev-parse', 'HEAD^{tree}'), promotionTree);

    const replay = inspectStableReplay({
      repoRoot: root,
      branchRef: 'docs-promotion',
      receiptPath,
      candidateText: candidate,
    });
    assert.equal(replay.parent, base);
    assert.equal(validateStableReplayTree({ repoRoot: root, branchRef: 'docs-promotion', expectedTree: promotionTree }), promotionTree);
    assert.throws(
      () => validateStableReplayTree({
        repoRoot: root,
        branchRef: 'docs-promotion',
        expectedTree: git(root, 'rev-parse', 'HEAD^{tree}'),
      }),
      /conflicts with deterministic original-base tree/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('workflow validates immutable evidence before writes and publishes beta atomically', async () => {
  const workflow = await readFile(new URL('../.github/workflows/docs-sync.yml', import.meta.url), 'utf8');
  assert.match(workflow, /group: docs-sync\n/);
  assert.match(workflow, /releases\/assets\/\$\{asset_id\}/);
  assert.match(workflow, /node scripts\/release-evidence\.mjs verify/);
  assert.match(workflow, /git push --atomic origin HEAD:dev/);
  assert.match(workflow, /release-evidence\.mjs beta-replay/);
  assert.match(workflow, /git worktree add --detach "\$\{replay_root\}" "\$\{original_base\}"/);
  assert.match(workflow, /release-evidence\.mjs stable-replay-tree/);
  assert.doesNotMatch(workflow, /git diff --quiet HEAD "refs\/remotes\/origin\/\$\{branch\}"/);
  assert.ok(workflow.indexOf('release-evidence.mjs verify') < workflow.indexOf('sync-release.mjs'));
  assert.doesNotMatch(workflow, /tar -x/);
  assert.doesNotMatch(workflow, /gh release download/);
});
