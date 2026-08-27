import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mkdtemp, mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  applyReconciliation,
  canonicalExternalClaims,
  canonicalJson,
  checkDiffAllowlist,
  checkReconciliation,
  closureDigest,
  createReconciliation,
  externalClaimsDigest,
  manifestDigest,
  sha256,
  validateReconciliation,
} from './lib/kit-docs-reconciliation.mjs';
import { canonicalSnapshotDigest, CLASSIFICATIONS, RUNTIMES } from './lib/kit-catalog.mjs';

const roots = [];
const HASH = '1'.repeat(64);
const OTHER_HASH = '2'.repeat(64);
const claimDefinitions = [
  {
    claimId: 'team-guide-en', pairId: 'team-guide', locale: 'en', rationale: 'Approved fixture claim.',
    relativePath: 'guides/team.en.mdx', oldStart: 'OLD TEAM CAPABILITY', newStart: 'NEW TEAM CAPABILITY', end: '\nEND',
  },
  {
    claimId: 'team-guide-vi', pairId: 'team-guide', locale: 'vi', rationale: 'Approved fixture claim.',
    relativePath: 'guides/team.vi.mdx', oldStart: 'OLD TEAM CAPABILITY VI', newStart: 'NEW TEAM CAPABILITY VI', end: '\nEND',
  },
];

function git(root, args, { trim = true } = {}) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return trim ? result.stdout.trim() : result.stdout;
}

async function write(path, body) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
}

async function writeJson(path, value) {
  await write(path, `${JSON.stringify(value, null, 2)}\n`);
}

function identity() {
  return {
    sourceIdentity: 'ak-alpha', declaredInvocation: 'ak:alpha', classification: 'public',
    canonicalRoute: 'kits/test/skills/alpha', aliases: [],
    evidenceRef: `release-asset:sha256:${HASH}#test/skills/ak-alpha/SKILL.md`, rationale: 'Fixture Skill.',
  };
}

function triad(channel, runtime) {
  const version = channel === 'stable' ? '1.0.0' : '1.1.0-beta.1';
  const stem = `agentkit-kit-test-${runtime}-${version}`;
  const directory = `release-evidence/kit-catalog/${channel}-v${version}`;
  return {
    archive: { name: 'kit.tar.gz', sha256: HASH, size: 123 },
    manifest: { path: `${directory}/${stem}.manifest.json`, name: `${stem}.manifest.json`, sha256: HASH, size: 123 },
    sidecar: { path: `${directory}/${stem}.sha256`, name: `${stem}.sha256`, sha256: OTHER_HASH, size: 80 },
  };
}

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'kit-reconcile-v2-'));
  roots.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'fixture@example.test']);
  git(root, ['config', 'user.name', 'Fixture']);

  const snapshot = { kitId: 'test', identities: [identity()] };
  const snapshotDigest = canonicalSnapshotDigest(snapshot);
  const releases = {
    stable: { tag: 'v1.0.0', version: '1.0.0', sha: 'a'.repeat(40), syncedAt: '2026-01-01T00:00:00Z' },
    beta: { tag: 'v1.1.0-beta.1', version: '1.1.0-beta.1', sha: 'b'.repeat(40), syncedAt: '2026-01-02T00:00:00Z' },
  };
  const registry = {
    schemaVersion: 2,
    classifications: [...CLASSIFICATIONS],
    runtimes: [...RUNTIMES],
    inventorySnapshots: { [snapshotDigest]: snapshot },
    channels: Object.fromEntries(Object.entries(releases).map(([channel, release]) => [channel, {
      tag: release.tag,
      version: release.version,
      sourceCommit: release.sha,
      releaseUrl: `https://github.com/bestagentkits/agentkit/releases/tag/${release.tag}`,
      kits: { test: { snapshotDigest, artifacts: Object.fromEntries(RUNTIMES.map((runtime) => [runtime, triad(channel, runtime)])) } },
    }])),
  };
  await writeJson(join(root, 'kit-catalog-identities.json'), registry);
  await writeJson(join(root, 'channels.json'), Object.fromEntries(Object.entries(releases).map(([channel, release]) => [channel, {
    version: release.version, tag: release.tag, sha: release.sha, syncedAt: release.syncedAt,
  }])));

  const files = [
    'test.en.mdx',
    'test.vi.mdx',
    'test/skills/alpha.en.mdx',
    'test/skills/alpha.vi.mdx',
    'test/hooks/index.en.mdx',
    'test/hooks/index.vi.mdx',
  ];
  for (const relativePath of files) {
    await write(join(root, 'content/docs/beta/kits', relativePath), `BETA ${relativePath}\n`);
    if (!relativePath.endsWith('hooks/index.vi.mdx')) {
      await write(join(root, 'content/docs/stable/kits', relativePath), `STABLE ${relativePath}\n`);
    }
  }
  for (const locale of ['en', 'vi']) {
    await write(join(root, `content/docs/stable/guides/team.${locale}.mdx`),
      `TIỀN TỐ ${locale}\nOLD TEAM CAPABILITY${locale === 'vi' ? ' VI' : ''}\nEND\nSTABLE ONLY ${locale}\n`);
    await write(join(root, `content/docs/beta/guides/team.${locale}.mdx`),
      `TIỀN TỐ ${locale}\nNEW TEAM CAPABILITY${locale === 'vi' ? ' VI' : ''}\nEND\nBETA ONLY ${locale}\n`);
  }

  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'fixture']);
  const baseCommit = git(root, ['rev-parse', 'HEAD']);
  const options = {
    root,
    manifestPath: 'docs-reconciliations/test.json',
    baseCommit,
    kitIds: ['test'],
    claimDefinitions: [...claimDefinitions].reverse(),
  };
  return { root, options, baseCommit, registryPath: join(root, 'kit-catalog-identities.json') };
}

async function readManifest(fixture) {
  return JSON.parse(await readFile(join(fixture.root, fixture.options.manifestPath), 'utf8'));
}

async function writeManifest(fixture, manifest) {
  manifest.externalClaimsDigest = externalClaimsDigest(manifest.externalClaims);
  manifest.closureDigest = closureDigest(manifest.evidence.postimageInventoryDigest, manifest.externalClaimsDigest);
  manifest.manifestDigest = manifestDigest(manifest);
  await writeFile(join(fixture.root, fixture.options.manifestPath), `${canonicalJson(manifest)}\n`);
}

async function gitBytes(fixture, path) {
  const result = spawnSync('git', ['-C', fixture.root, 'show', `${fixture.baseCommit}:${path}`]);
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
}

async function sourceBytes(fixture, row) {
  return gitBytes(fixture, row.sourcePath);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test('canonical manifest derives full-tree inventories, triad digests, finite claims, and operation counts', async () => {
  const fixture = await makeFixture();
  const { manifest, created } = await createReconciliation(fixture.options);
  assert.equal(created, true);
  assert.equal(manifest.evidence.sourceInventory.length, 6);
  assert.equal(manifest.evidence.preimageInventory.length, 5);
  assert.equal(manifest.evidence.postimageInventory.length, 6);
  assert.equal(manifest.copyOperations.length, 6);
  assert.ok(manifest.copyOperations.some((row) => row.targetPath.endsWith('test/hooks/index.en.mdx')));
  assert.ok(manifest.copyOperations.some((row) => row.targetPath.endsWith('test/hooks/index.vi.mdx')));
  assert.equal(manifest.externalClaims.length, 2);
  assert.deepEqual(manifest.externalClaims.map((row) => row.normalizedPath), [
    'guides/team.en.mdx',
    'guides/team.vi.mdx',
  ]);
  for (const row of manifest.externalClaims) {
    assert.equal(row.ledgerSchemaVersion, 1);
    assert.equal(row.normalizedPath, row.targetPath.replace(/^content\/docs\/stable\//, ''));
    assert.equal(row.evidenceAnchor, `matrix-sha256:${manifest.evidence.matrixDigest}`);
    assert.deepEqual(Object.keys(row.byteSpan).sort(), ['end', 'start']);
    const preimage = await gitBytes(fixture, row.targetPath);
    assert.equal(preimage.subarray(row.byteSpan.start, row.byteSpan.end).toString('utf8'), row.oldFragment);
    assert.notEqual(row.byteSpan.start, preimage.toString('utf8').indexOf(row.oldFragment));
  }
  assert.equal(manifest.counts.totalOperations, 8);
  assert.equal(manifest.counts.targetWrites, 8);
  assert.equal(manifest.evidence.triadRows.length, 12);
  assert.match(manifest.evidence.digestDefinitions.manifestSetDigest, /projected/);
  assert.match(manifest.evidence.digestDefinitions.matrixDigest, /archive,manifest,sidecar/);
  assert.equal(manifest.evidence.digestDefinitions.closureDigest, 'sha256(canonical-json({postimageInventoryDigest,externalClaimsDigest}))');
  assert.equal(manifest.closureDigest, sha256(Buffer.from(canonicalJson({
    postimageInventoryDigest: manifest.evidence.postimageInventoryDigest,
    externalClaimsDigest: manifest.externalClaimsDigest,
  }), 'utf8')));
  for (const digest of [
    manifest.evidence.manifestSetDigest, manifest.evidence.matrixDigest,
    manifest.evidence.sourceInventoryDigest, manifest.evidence.preimageInventoryDigest,
    manifest.evidence.postimageInventoryDigest, manifest.externalClaimsDigest, manifest.closureDigest, manifest.manifestDigest,
  ]) assert.match(digest, /^[a-f0-9]{64}$/);
});

test('apply is exact, resumable, and a second apply writes zero targets', async () => {
  const fixture = await makeFixture();
  const { manifest } = await createReconciliation(fixture.options);
  const first = await applyReconciliation(fixture.options);
  assert.equal(first.writes, manifest.counts.totalOperations);
  assert.equal(first.skipped, 0);
  await assert.doesNotReject(() => checkReconciliation(fixture.options));
  const second = await applyReconciliation(fixture.options);
  assert.equal(second.writes, 0);
  assert.equal(second.skipped, manifest.counts.totalOperations);
  assert.equal((await createReconciliation(fixture.options)).created, false);
});

test('mixed exact pre/post state resumes only the remaining targets', async () => {
  const fixture = await makeFixture();
  const { manifest } = await createReconciliation(fixture.options);
  const row = manifest.copyOperations[0];
  await writeFile(join(fixture.root, row.targetPath), await sourceBytes(fixture, row));
  const result = await applyReconciliation(fixture.options);
  assert.equal(result.writes, manifest.counts.totalOperations - 1);
  assert.equal(result.skipped, 1);
  await assert.doesNotReject(() => checkReconciliation(fixture.options));
});

test('interruption keeps completed postimages and rerun completes the remainder without rollback', async () => {
  const fixture = await makeFixture();
  const { manifest } = await createReconciliation(fixture.options);
  let calls = 0;
  await assert.rejects(() => applyReconciliation({
    ...fixture.options,
    renameImpl: async (source, target) => {
      calls += 1;
      if (calls === 3) throw new Error('injected interruption');
      await rename(source, target);
    },
  }), /injected interruption/);
  assert.equal(calls, 3);
  const operations = [...manifest.copyOperations, ...manifest.externalClaims]
    .sort((left, right) => left.targetPath.localeCompare(right.targetPath));
  for (const row of operations.slice(0, 2)) {
    const expected = row.expectedPostimageSha256 ?? row.wholeFilePostimageSha256;
    assert.equal(sha256(await readFile(join(fixture.root, row.targetPath))), expected);
  }
  const resumed = await applyReconciliation(fixture.options);
  assert.equal(resumed.writes, manifest.counts.totalOperations - 2);
  assert.equal((await applyReconciliation(fixture.options)).writes, 0);
});

test('a stale hard-crash temp directory is cleaned before resume', async () => {
  const fixture = await makeFixture();
  await createReconciliation(fixture.options);
  const temporaryDirectory = join(fixture.root, 'content/docs/stable/.kit-docs-reconciliation-tmp');
  await write(join(temporaryDirectory, '.stale.reconcile.tmp'), 'partial bytes\n');
  await assert.doesNotReject(() => applyReconciliation(fixture.options));
  await assert.rejects(() => readFile(join(temporaryDirectory, '.stale.reconcile.tmp')), { code: 'ENOENT' });
});

test('third-state preflight rejects before any target is written', async () => {
  const fixture = await makeFixture();
  const { manifest } = await createReconciliation(fixture.options);
  const [tampered, untouched] = manifest.copyOperations;
  await writeFile(join(fixture.root, tampered.targetPath), 'THIRD STATE\n');
  const before = await readFile(join(fixture.root, untouched.targetPath));
  await assert.rejects(() => applyReconciliation(fixture.options), /neither exact preimage nor postimage/);
  assert.deepEqual(await readFile(join(fixture.root, untouched.targetPath)), before);
});

test('manifest, evidence inventory, and external claim mutations are digest-bound and historically rederived', async () => {
  const fixture = await makeFixture();
  await createReconciliation(fixture.options);
  const manifest = await readManifest(fixture);
  manifest.evidence.sourceInventory[0].sha256 = OTHER_HASH;
  await writeFile(join(fixture.root, fixture.options.manifestPath), `${canonicalJson(manifest)}\n`);
  await assert.rejects(() => validateReconciliation({ ...fixture.options, manifest }), /manifest canonical digest mismatch/);
  await writeManifest(fixture, manifest);
  await assert.rejects(() => validateReconciliation({ ...fixture.options, manifest }), /sourceInventory drift/);

  const fresh = await readManifest({ ...fixture, options: fixture.options }).catch(() => null);
  assert.ok(fresh);
});

test('closure digest is required and independently rejects tampering after the manifest is resealed', async (t) => {
  await t.test('required root field', async () => {
    const fixture = await makeFixture();
    await createReconciliation(fixture.options);
    const manifest = await readManifest(fixture);
    delete manifest.closureDigest;
    manifest.manifestDigest = manifestDigest(manifest);
    await assert.rejects(() => validateReconciliation({ ...fixture.options, manifest }), /manifest fields are not exact/);
  });

  await t.test('tamper with valid outer manifest digest', async () => {
    const fixture = await makeFixture();
    await createReconciliation(fixture.options);
    const manifest = await readManifest(fixture);
    manifest.closureDigest = OTHER_HASH;
    manifest.manifestDigest = manifestDigest(manifest);
    await assert.rejects(() => validateReconciliation({ ...fixture.options, manifest }), /closure canonical digest mismatch/);
  });
});

test('finite external claims require authorized rationale, EN/VI pairing, occurrence, fragments, and whole-file hashes', async () => {
  const fixture = await makeFixture();
  await createReconciliation(fixture.options);
  const manifest = await readManifest(fixture);
  manifest.externalClaims[0].rationale = 'unauthorized';
  await writeManifest(fixture, manifest);
  await assert.rejects(() => validateReconciliation({ ...fixture.options, manifest }), /external claims drift/);
});

test('external claim ledger schema, normalized path, UTF-8 span, evidence anchor, and order reject resealed tampering', async (t) => {
  async function tampered(mutator) {
    const fixture = await makeFixture();
    await createReconciliation(fixture.options);
    const manifest = await readManifest(fixture);
    mutator(manifest);
    await writeManifest(fixture, manifest);
    return { fixture, manifest };
  }

  await t.test('schema field', async () => {
    const { fixture, manifest } = await tampered((value) => { delete value.externalClaims[0].ledgerSchemaVersion; });
    await assert.rejects(() => validateReconciliation({ ...fixture.options, manifest }), /fields are not exact/);
  });

  await t.test('normalized path', async () => {
    const { fixture, manifest } = await tampered((value) => { value.externalClaims[0].normalizedPath = 'wrong/path.mdx'; });
    await assert.rejects(() => validateReconciliation({ ...fixture.options, manifest }), /invalid external claim/);
  });

  await t.test('byte span', async () => {
    const { fixture, manifest } = await tampered((value) => {
      value.externalClaims[0].byteSpan.start += 1;
      value.externalClaims[0].byteSpan.end += 1;
    });
    await assert.rejects(() => validateReconciliation({ ...fixture.options, manifest }), /external claims drift/);
  });

  await t.test('evidence anchor', async () => {
    const { fixture, manifest } = await tampered((value) => {
      value.externalClaims[0].evidenceAnchor = `matrix-sha256:${OTHER_HASH}`;
    });
    await assert.rejects(() => validateReconciliation({ ...fixture.options, manifest }), /external claims drift/);
  });

  await t.test('canonical row order', async () => {
    const { fixture, manifest } = await tampered((value) => { value.externalClaims.reverse(); });
    await assert.rejects(() => validateReconciliation({ ...fixture.options, manifest }), /canonical ledger order/);
  });
});

test('external claims canonical order uses every governance key and digest preserves that exact array order', () => {
  const row = (claimId, normalizedPath, locale, start, evidenceAnchor) => ({
    claimId, normalizedPath, locale, byteSpan: { start, end: start + 1 }, evidenceAnchor,
  });
  const anchorA = `matrix-sha256:${HASH}`;
  const anchorB = `matrix-sha256:${OTHER_HASH}`;
  const claims = [
    row('f', 'b.mdx', 'en', 10, anchorB),
    row('e', 'b.mdx', 'en', 10, anchorA),
    row('d', 'b.mdx', 'en', 10, anchorA),
    row('c', 'b.mdx', 'en', 2, anchorB),
    row('b', 'a.mdx', 'vi', 0, anchorA),
    row('a', 'a.mdx', 'en', 9, anchorB),
  ];
  const ordered = canonicalExternalClaims(claims);
  assert.deepEqual(ordered.map(({ claimId }) => claimId), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.notEqual(externalClaimsDigest(ordered), externalClaimsDigest([...ordered].reverse()));
});

test('exact target Kit tree rejects extras', async () => {
  const fixture = await makeFixture();
  await createReconciliation(fixture.options);
  await applyReconciliation(fixture.options);
  await write(join(fixture.root, 'content/docs/stable/kits/test/hooks/extra.mdx'), 'extra\n');
  await assert.rejects(() => checkReconciliation(fixture.options), /Stable Kit tree has extra paths/);
});

test('diff allowlist accepts exact targets including untracked additions', async () => {
  const fixture = await makeFixture();
  const { manifest } = await createReconciliation(fixture.options);
  await applyReconciliation(fixture.options);
  const result = await checkDiffAllowlist({
    root: fixture.root, manifest, manifestPath: fixture.options.manifestPath, base: fixture.baseCommit,
  });
  assert.equal(result.stablePaths, manifest.counts.totalOperations);
  await assert.doesNotReject(() => checkReconciliation({ ...fixture.options, diffBase: fixture.baseCommit }));
});

test('diff allowlist rejects an extra or missing Stable path', async (t) => {
  await t.test('extra', async () => {
    const fixture = await makeFixture();
    const { manifest } = await createReconciliation(fixture.options);
    await applyReconciliation(fixture.options);
    await write(join(fixture.root, 'content/docs/stable/guides/extra.en.mdx'), 'extra\n');
    await assert.rejects(() => checkDiffAllowlist({ root: fixture.root, manifest, manifestPath: fixture.options.manifestPath, base: fixture.baseCommit }), /extra \[content\/docs\/stable\/guides\/extra\.en\.mdx\]/);
  });
  await t.test('missing', async () => {
    const fixture = await makeFixture();
    const { manifest } = await createReconciliation(fixture.options);
    await applyReconciliation(fixture.options);
    const row = manifest.copyOperations.find((entry) => entry.targetPreimageSha256 !== null);
    const preimage = spawnSync('git', ['-C', fixture.root, 'show', `${fixture.baseCommit}:${row.targetPath}`]).stdout;
    await writeFile(join(fixture.root, row.targetPath), preimage);
    await assert.rejects(() => checkDiffAllowlist({ root: fixture.root, manifest, manifestPath: fixture.options.manifestPath, base: fixture.baseCommit }), /missing \[/);
  });
});

test('diff allowlist rejects a cross-boundary Stable rename', async () => {
  const fixture = await makeFixture();
  const { manifest } = await createReconciliation(fixture.options);
  await applyReconciliation(fixture.options);
  const source = join(fixture.root, 'content/docs/stable/guides/team.en.mdx');
  const target = join(fixture.root, 'moved-team.en.mdx');
  await rename(source, target);
  git(fixture.root, ['add', '-A']);
  await assert.rejects(() => checkDiffAllowlist({ root: fixture.root, manifest, manifestPath: fixture.options.manifestPath, base: fixture.baseCommit }), /rename\/copy/);
});

test('diff mode rejects a deleted manifest', async () => {
  const fixture = await makeFixture();
  await createReconciliation(fixture.options);
  await applyReconciliation(fixture.options);
  await unlink(join(fixture.root, fixture.options.manifestPath));
  await assert.rejects(() => checkReconciliation({ ...fixture.options, diffBase: fixture.baseCommit }), /manifest does not exist/);
});

test('no Stable diff performs the ordinary historical postimage check', async () => {
  const fixture = await makeFixture();
  await createReconciliation(fixture.options);
  await applyReconciliation(fixture.options);
  git(fixture.root, ['add', '.']);
  git(fixture.root, ['commit', '-qm', 'reconciled']);
  const head = git(fixture.root, ['rev-parse', 'HEAD']);
  const result = await checkReconciliation({ ...fixture.options, diffBase: head });
  assert.equal(result.diffChecked, true);
});
