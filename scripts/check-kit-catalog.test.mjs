import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { afterEach, test } from 'node:test';
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { tmpdir } from 'node:os';
import { checkKitCatalog } from './check-kit-catalog.mjs';
import {
  canonicalSnapshotDigest,
  CLASSIFICATIONS,
  RUNTIMES,
  validateCatalogEvidence,
  validateRegistry,
} from './lib/kit-catalog.mjs';

const HASH = '1'.repeat(64);
const OTHER_HASH = '2'.repeat(64);
const temporaryRoots = [];
const releases = {
  stable: { tag: 'v1.0.0', version: '1.0.0', sha: 'a'.repeat(40), syncedAt: '2026-01-01T00:00:00Z' },
  beta: { tag: 'v1.1.0-beta.1', version: '1.1.0-beta.1', sha: 'b'.repeat(40), syncedAt: '2026-01-02T00:00:00Z' },
};
const byteHash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function identity(sourceIdentity, classification = 'public', overrides = {}) {
  const slug = sourceIdentity.replace(/^ak-/, '');
  return {
    sourceIdentity,
    declaredInvocation: `ak:${slug}`,
    classification,
    canonicalRoute: ['public', 'intentionally-unlisted', 'collision-blocked'].includes(classification)
      ? `kits/test/skills/${slug}`
      : null,
    aliases: [],
    evidenceRef: `release-asset:sha256:${HASH}#test/skills/${sourceIdentity}/SKILL.md`,
    rationale: 'Test identity.',
    ...(['internal', 'duplicate', 'unsupported', 'intentionally-unlisted', 'collision-blocked'].includes(classification)
      ? { reviewedException: `reviewed-${slug}` }
      : {}),
    ...overrides,
  };
}

function snapshot(identities) {
  return { kitId: 'test', identities };
}

function artifact(channel, runtime, hash = HASH) {
  return {
    archive: { name: 'kit.tar.gz', sha256: hash, size: 123 },
    manifest: null,
    sidecar: null,
  };
}

function evidenceNames(channel, runtime, kitId = 'test') {
  const version = releases[channel].version;
  const stem = `agentkit-kit-${kitId}-${runtime}-${version}`;
  const directory = `release-evidence/kit-catalog/${channel}-v${version}`;
  return {
    manifestName: `${stem}.manifest.json`,
    manifestPath: posix.join(directory, `${stem}.manifest.json`),
    sidecarName: `${stem}.sha256`,
    sidecarPath: posix.join(directory, `${stem}.sha256`),
    archiveAsset: `${stem}.tar.gz`,
  };
}

async function writeCatalogEvidence(root, registry) {
  for (const [channel, channelValue] of Object.entries(registry.channels)) {
    const release = releases[channel];
    for (const [kitId, kitBinding] of Object.entries(channelValue.kits)) {
      for (const [runtime, triad] of Object.entries(kitBinding.artifacts)) {
        const names = evidenceNames(channel, runtime, kitId);
        const sidecarBytes = Buffer.from(`${triad.archive.sha256}  ${triad.archive.name}\n`);
        const sidecar = {
          path: names.sidecarPath,
          name: names.sidecarName,
          sha256: byteHash(sidecarBytes),
          size: sidecarBytes.length,
        };
        const manifest = {
          schemaVersion: 'remote-registry.v1',
          kitId,
          tier: 'paid',
          runtime,
          version: release.version,
          channel,
          adapterSchemaVersion: 'agentkit-adapter.v1',
          requiredCliVersion: release.version,
          sourceCommit: release.sha,
          createdAt: release.syncedAt,
          artifact: {
            url: `https://registry.agentkit.best/kits/${kitId}/${runtime}/${release.version}/kit.tar.gz`,
            sha256: triad.archive.sha256,
            size: triad.archive.size,
            signature: 'fixture-signature',
            signatureAlgorithm: 'ed25519',
            keyId: 'fixture-key',
            expiresAt: '2026-01-03T00:00:00Z',
          },
          resolvedFrom: [{ kitId, version: '0.1.0' }],
          githubAssets: [
            { kind: 'archive', name: names.archiveAsset, sha256: triad.archive.sha256, size: triad.archive.size },
            { kind: 'sha256', name: names.sidecarName, sha256: sidecar.sha256, size: sidecar.size },
          ],
        };
        const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
        triad.manifest = {
          path: names.manifestPath,
          name: names.manifestName,
          sha256: byteHash(manifestBytes),
          size: manifestBytes.length,
        };
        triad.sidecar = sidecar;
        await mkdir(join(root, names.manifestPath, '..'), { recursive: true });
        await Promise.all([
          writeFile(join(root, names.manifestPath), manifestBytes),
          writeFile(join(root, names.sidecarPath), sidecarBytes),
        ]);
      }
    }
  }
}

function binding(channel, digest, mismatchRuntime) {
  return {
    snapshotDigest: digest,
    artifacts: Object.fromEntries(RUNTIMES.map((runtime) => [
      runtime,
      artifact(channel, runtime, channel === 'stable' && runtime === mismatchRuntime ? OTHER_HASH : HASH),
    ])),
  };
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function routesFor(identities, classification = null) {
  return identities
    .filter((entry) => classification ? entry.classification === classification : ['public', 'intentionally-unlisted', 'collision-blocked'].includes(entry.classification))
    .map((entry) => entry.canonicalRoute.split('/').at(-1));
}

async function writeChannelDocs(root, channel, identities, options = {}) {
  const docsRoot = join(root, 'content', 'docs');
  const skillsDir = join(docsRoot, channel, 'kits', 'test', 'skills');
  await mkdir(skillsDir, { recursive: true });
  const routed = routesFor(identities);
  const publicRoutes = routesFor(identities, 'public');
  const en = options.en ?? routed;
  const vi = options.vi ?? routed;
  const navEn = options.navEn ?? publicRoutes;
  const navVi = options.navVi ?? publicRoutes;
  const indexEn = options.indexEn ?? publicRoutes;
  const indexVi = options.indexVi ?? publicRoutes;
  for (const slug of en) await writeFile(join(skillsDir, `${slug}.en.mdx`), options.enBytes?.[slug] ?? `---\ntitle: Test\n---\n\n${slug}:en\n`);
  for (const slug of vi) await writeFile(join(skillsDir, `${slug}.vi.mdx`), options.viBytes?.[slug] ?? `---\ntitle: Test\n---\n\n${slug}:vi\n`);
  await writeJson(join(skillsDir, 'meta.json'), { title: 'Skills', pages: navEn });
  await writeJson(join(skillsDir, 'meta.vi.json'), { title: 'Skills', pages: navVi });
  const indexBody = (routes) => `---\ntitle: Test\n---\n\n${routes.map((slug) => `[ak:${slug}](./${slug})`).join('\n')}\n`;
  await writeFile(join(skillsDir, 'index.en.mdx'), indexBody(indexEn));
  await writeFile(join(skillsDir, 'index.vi.mdx'), indexBody(indexVi));
  const overview = (count) => `---\ntitle: Test\n---\n\n| Component | Count |\n| --- | ---: |\n| Skills | ${count} | Fixture |\n`;
  await writeFile(join(docsRoot, channel, 'kits', 'test.en.mdx'), overview(options.countEn ?? identities.length));
  await writeFile(join(docsRoot, channel, 'kits', 'test.vi.mdx'), overview(options.countVi ?? identities.length));
  return docsRoot;
}

async function makeFixture({
  betaIdentities = [identity('ak-alpha')],
  stableIdentities = betaIdentities,
  stableDocs = {},
  betaDocs = {},
  mismatchRuntime,
  mutateRegistry,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ak-kit-catalog-v2-'));
  temporaryRoots.push(root);
  const stableSnapshot = snapshot(stableIdentities);
  const betaSnapshot = snapshot(betaIdentities);
  const stableDigest = canonicalSnapshotDigest(stableSnapshot);
  const betaDigest = canonicalSnapshotDigest(betaSnapshot);
  const registry = {
    schemaVersion: 2,
    classifications: [...CLASSIFICATIONS],
    runtimes: [...RUNTIMES],
    inventorySnapshots: Object.fromEntries([[stableDigest, structuredClone(stableSnapshot)], [betaDigest, structuredClone(betaSnapshot)]]),
    channels: Object.fromEntries(Object.entries(releases).map(([channel, release]) => [channel, {
      tag: release.tag,
      version: release.version,
      sourceCommit: release.sha,
      releaseUrl: `https://github.com/bestagentkits/agentkit/releases/tag/${release.tag}`,
      kits: { test: binding(channel, channel === 'stable' ? stableDigest : betaDigest, mismatchRuntime) },
    }])),
  };
  await writeCatalogEvidence(root, registry);
  if (mutateRegistry) mutateRegistry(registry, { stableDigest, betaDigest });
  const registryPath = join(root, 'kit-catalog-identities.json');
  const channelsPath = join(root, 'channels.json');
  await Promise.all([
    writeJson(registryPath, registry),
    writeJson(channelsPath, Object.fromEntries(Object.entries(releases).map(([channel, release]) => [channel, {
      version: release.version,
      tag: release.tag,
      sha: release.sha,
      syncedAt: release.syncedAt,
    }]))),
    writeChannelDocs(root, 'stable', stableIdentities, stableDocs),
    writeChannelDocs(root, 'beta', betaIdentities, betaDocs),
  ]);
  assert.equal(spawnSync('git', ['-C', root, 'init', '-q']).status, 0);
  assert.equal(spawnSync('git', ['-C', root, 'add', '.']).status, 0);
  return { root, docsRoot: join(root, 'content', 'docs'), registryPath, channelsPath, registry };
}

async function rewriteManifest(fixture, channel, runtime, mutate) {
  const names = evidenceNames(channel, runtime);
  const path = join(fixture.root, names.manifestPath);
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  mutate(manifest);
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path, bytes);
  const record = fixture.registry.channels[channel].kits.test.artifacts[runtime].manifest;
  record.sha256 = byteHash(bytes);
  record.size = bytes.length;
  await writeJson(fixture.registryPath, fixture.registry);
}

async function expectFailure(fixture, pattern) {
  await assert.rejects(() => checkKitCatalog(fixture), pattern);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test('reports totals for every channel and Kit', async () => {
  const fixture = await makeFixture({ betaIdentities: [identity('ak-alpha'), identity('ak-common', 'internal')] });
  const reports = await checkKitCatalog(fixture);
  assert.deepEqual(reports.map((report) => ({
    channel: report.channel,
    kitId: report.kitId,
    total: report.total,
    public: report.public,
    internal: report.internal,
    details: report.details,
    nav: report.nav,
    artifacts: report.artifacts,
  })), [
    { channel: 'stable', kitId: 'test', total: 2, public: 1, internal: 1, details: 1, nav: 1, artifacts: 6 },
    { channel: 'beta', kitId: 'test', total: 2, public: 1, internal: 1, details: 1, nav: 1, artifacts: 6 },
  ]);
});

test('rejects schema v1 and exact-field violations', async (t) => {
  await t.test('schema v1', async () => {
    const fixture = await makeFixture({ mutateRegistry: (registry) => { registry.schemaVersion = 1; } });
    await expectFailure(fixture, /unsupported registry schemaVersion 1; expected 2/);
  });
  await t.test('unknown root field', async () => {
    const fixture = await makeFixture({ mutateRegistry: (registry) => { registry.legacy = true; } });
    await expectFailure(fixture, /registry:.*unknown fields \[legacy\]/);
  });
  await t.test('missing artifact field', async () => {
    const fixture = await makeFixture({ mutateRegistry: (registry) => { delete registry.channels.stable.kits.test.artifacts.pi.archive.size; } });
    await expectFailure(fixture, /artifacts\.pi\.archive: missing fields \[size\]/);
  });
  await t.test('unknown identity field', async () => {
    const fixture = await makeFixture({ mutateRegistry: (registry, { betaDigest }) => { registry.inventorySnapshots[betaDigest].identities[0].legacy = true; } });
    await expectFailure(fixture, /unknown fields \[legacy\]/);
  });
  await t.test('unknown nested artifact field', async () => {
    const fixture = await makeFixture({ mutateRegistry: (registry) => { registry.channels.beta.kits.test.artifacts.pi.legacy = true; } });
    await expectFailure(fixture, /artifacts\.pi:.*unknown fields \[legacy\]/);
  });
  await t.test('duplicate raw runtime tuple', async () => {
    const fixture = await makeFixture();
    const artifactJson = JSON.stringify(fixture.registry.channels.stable.kits.test.artifacts.pi);
    const tuple = `"pi":${artifactJson}`;
    const registryJson = JSON.stringify(fixture.registry);
    assert.ok(registryJson.includes(tuple));
    await writeFile(fixture.registryPath, registryJson.replace(tuple, `${tuple},"pi":${artifactJson}`));
    await expectFailure(fixture, /duplicate object keys .*artifacts.*pi/);
  });
  await t.test('malformed routed identity fails cleanly', async () => {
    const fixture = await makeFixture({ mutateRegistry: (registry, { betaDigest }) => {
      registry.inventorySnapshots[betaDigest].identities[0].canonicalRoute = null;
    } });
    await expectFailure(fixture, /canonicalRoute: expected kits\/test\/skills\/alpha/);
  });
});

test('requires the exact ordered classifications and runtime matrix', async (t) => {
  await t.test('runtime missing', async () => {
    const fixture = await makeFixture({ mutateRegistry: (registry) => { registry.runtimes.pop(); } });
    await expectFailure(fixture, /runtimes must be exactly/);
  });
  await t.test('classification reordered', async () => {
    const fixture = await makeFixture({ mutateRegistry: (registry) => { registry.classifications.reverse(); } });
    await expectFailure(fixture, /classifications must match/);
  });
  await t.test('artifact runtime missing', async () => {
    const fixture = await makeFixture({ mutateRegistry: (registry) => { delete registry.channels.beta.kits.test.artifacts.pi; } });
    await expectFailure(fixture, /artifacts: missing \[pi\]/);
  });
});

test('canonical digest ignores recursive object key order', () => {
  const original = identity('ak-alpha');
  const reordered = Object.fromEntries(Object.entries(original).reverse());
  assert.equal(canonicalSnapshotDigest(snapshot([original])), canonicalSnapshotDigest(snapshot([reordered])));
});

test('rejects canonical snapshot digest tampering', async () => {
  const fixture = await makeFixture({ mutateRegistry: (registry, { betaDigest }) => {
    const snapshotValue = registry.inventorySnapshots[betaDigest];
    delete registry.inventorySnapshots[betaDigest];
    registry.inventorySnapshots['f'.repeat(64)] = snapshotValue;
    registry.channels.stable.kits.test.snapshotDigest = 'f'.repeat(64);
    registry.channels.beta.kits.test.snapshotDigest = 'f'.repeat(64);
  } });
  await expectFailure(fixture, /canonical digest is/);
});

test('rejects unsorted identities and aliases even with a valid digest', async (t) => {
  await t.test('identities', async () => {
    const identities = [identity('ak-beta'), identity('ak-alpha')];
    const fixture = await makeFixture({ betaIdentities: identities });
    await expectFailure(fixture, /identities: must be sorted by sourceIdentity/);
  });
  await t.test('aliases', async () => {
    const canonical = identity('ak-alpha', 'public', { aliases: ['ak-alpha-z', 'ak-alpha-old'] });
    const old = identity('ak-alpha-old', 'alias', { declaredInvocation: 'ak:alpha', canonicalRoute: canonical.canonicalRoute });
    const zed = identity('ak-alpha-z', 'alias', { declaredInvocation: 'ak:alpha', canonicalRoute: canonical.canonicalRoute });
    const fixture = await makeFixture({ betaIdentities: [canonical, old, zed] });
    await expectFailure(fixture, /aliases: must be sorted/);
  });
});

test('accepts a correctly related public alias', async () => {
  const canonical = identity('ak-alpha', 'public', { aliases: ['ak-alpha-old'] });
  const alias = identity('ak-alpha-old', 'alias', { declaredInvocation: 'ak:alpha', canonicalRoute: canonical.canonicalRoute });
  const fixture = await makeFixture({ betaIdentities: [canonical, alias] });
  await assert.doesNotReject(() => checkKitCatalog(fixture));
});

test('validates invocation, storage route, aliases, internal identities, collisions, and evidence refs', async (t) => {
  await t.test('invocation mismatch', async () => {
    const fixture = await makeFixture({ betaIdentities: [identity('ak-alpha', 'public', { declaredInvocation: 'ak:beta' })] });
    await expectFailure(fixture, /invocation ak:beta does not match storage identity ak-alpha/);
  });
  await t.test('storage route mismatch', async () => {
    const fixture = await makeFixture({ betaIdentities: [identity('ak-alpha', 'public', { canonicalRoute: 'kits/test/skills/beta' })] });
    await expectFailure(fixture, /canonicalRoute: expected kits\/test\/skills\/alpha/);
  });
  await t.test('orphan alias', async () => {
    const fixture = await makeFixture({ betaIdentities: [identity('ak-alpha'), identity('ak-alpha-old', 'alias', { declaredInvocation: 'ak:alpha', canonicalRoute: 'kits/test/skills/alpha' })] });
    await expectFailure(fixture, /alias must be named by its public canonical identity/);
  });
  await t.test('internal route', async () => {
    const fixture = await makeFixture({ betaIdentities: [identity('ak-alpha'), identity('ak-common', 'internal', { canonicalRoute: 'kits/test/skills/common' })] });
    await expectFailure(fixture, /internal identity must use null/);
  });
  await t.test('reviewed collision accepted', async () => {
    const alpha = identity('ak-alpha', 'collision-blocked', { declaredInvocation: 'ak:storage', reviewedException: 'storage-collision' });
    const beta = identity('ak-beta', 'collision-blocked', { declaredInvocation: 'ak:storage', reviewedException: 'storage-collision' });
    const fixture = await makeFixture({ betaIdentities: [alpha, beta] });
    await assert.doesNotReject(() => checkKitCatalog(fixture));
  });
  await t.test('unreviewed collision rejected', async () => {
    const alpha = identity('ak-alpha', 'collision-blocked', { declaredInvocation: 'ak:storage', reviewedException: 'collision-a' });
    const beta = identity('ak-beta', 'collision-blocked', { declaredInvocation: 'ak:storage', reviewedException: 'collision-b' });
    const fixture = await makeFixture({ betaIdentities: [alpha, beta] });
    await expectFailure(fixture, /duplicate declared invocation ak:storage is not an alias or reviewed collision/);
  });
  await t.test('singleton collision rejected', async () => {
    const fixture = await makeFixture({ betaIdentities: [identity('ak-alpha', 'collision-blocked', { declaredInvocation: 'ak:storage', reviewedException: 'storage-collision' })] });
    await expectFailure(fixture, /collision-blocked invocation ak:storage requires at least two identities/);
  });
  await t.test('evidence path mismatch', async () => {
    const fixture = await makeFixture({ betaIdentities: [identity('ak-alpha', 'public', { evidenceRef: `release-asset:sha256:${HASH}#test/skills/ak-beta/SKILL.md` })] });
    await expectFailure(fixture, /evidenceRef: must identify this Kit and storage identity/);
  });
});

test('validates channel identities and artifact records', async (t) => {
  await t.test('channels.json mismatch', async () => {
    const fixture = await makeFixture({ mutateRegistry: (registry) => { registry.channels.stable.sourceCommit = 'c'.repeat(40); } });
    await expectFailure(fixture, /channels\.stable\.sourceCommit: expected/);
  });
  await t.test('artifact name', async () => {
    const fixture = await makeFixture({ mutateRegistry: (registry) => { registry.channels.beta.kits.test.artifacts.pi.archive.name = 'wrong.tar.gz'; } });
    await expectFailure(fixture, /artifacts\.pi\.archive\.name: expected/);
  });
  await t.test('artifact hash', async () => {
    const fixture = await makeFixture({ mutateRegistry: (registry) => { registry.channels.beta.kits.test.artifacts.pi.archive.sha256 = 'BAD'; } });
    await expectFailure(fixture, /artifacts\.pi\.archive\.sha256/);
  });
  await t.test('artifact size', async () => {
    const fixture = await makeFixture({ mutateRegistry: (registry) => { registry.channels.beta.kits.test.artifacts.pi.archive.size = 0; } });
    await expectFailure(fixture, /artifacts\.pi\.archive\.size/);
  });
  await t.test('malformed artifact object', async () => {
    const fixture = await makeFixture({ mutateRegistry: (registry) => { registry.channels.beta.kits.test.artifacts.pi = null; } });
    await expectFailure(fixture, /artifacts\.pi: must be an object/);
  });
});

test('validates committed manifest and sidecar evidence bytes', async (t) => {
  await t.test('manifest-byte tamper', async () => {
    const fixture = await makeFixture();
    const path = join(fixture.root, evidenceNames('stable', 'pi').manifestPath);
    await writeFile(path, `${await readFile(path, 'utf8')}tampered\n`);
    await expectFailure(fixture, /manifest\.sha256: expected committed byte hash/);
  });
  await t.test('sidecar-byte tamper', async () => {
    const fixture = await makeFixture();
    const path = join(fixture.root, evidenceNames('beta', 'omp').sidecarPath);
    await writeFile(path, `${OTHER_HASH}  kit.tar.gz\n`);
    await expectFailure(fixture, /sidecar\.sha256: expected committed byte hash/);
  });
  await t.test('sidecar semantic tamper with matching byte metadata', async () => {
    const fixture = await makeFixture();
    const names = evidenceNames('beta', 'pi');
    const triad = fixture.registry.channels.beta.kits.test.artifacts.pi;
    const sidecarBytes = Buffer.from(`${triad.archive.sha256}  ${names.archiveAsset}\n`);
    await writeFile(join(fixture.root, names.sidecarPath), sidecarBytes);
    triad.sidecar.sha256 = byteHash(sidecarBytes);
    triad.sidecar.size = sidecarBytes.length;
    await rewriteManifest(fixture, 'beta', 'pi', (manifest) => {
      const sidecarAsset = manifest.githubAssets.find((asset) => asset.kind === 'sha256');
      sidecarAsset.sha256 = triad.sidecar.sha256;
      sidecarAsset.size = triad.sidecar.size;
    });
    await expectFailure(fixture, /sidecar: bytes must be exactly/);
  });
  await t.test('evidence byte-size mismatch', async () => {
    const fixture = await makeFixture({ mutateRegistry: (registry) => {
      registry.channels.stable.kits.test.artifacts.pi.manifest.size += 1;
    } });
    await expectFailure(fixture, /manifest\.size: expected committed byte size/);
  });
  await t.test('missing registry-referenced evidence file', async () => {
    const fixture = await makeFixture();
    const missingPath = evidenceNames('stable', 'pi').sidecarPath;
    await rm(join(fixture.root, missingPath));
    await expectFailure(fixture, new RegExp(`catalog evidence files: missing \\[${missingPath.replaceAll('.', '\\.')}`));
  });
  await t.test('symlink evidence path', async () => {
    const fixture = await makeFixture();
    const path = join(fixture.root, evidenceNames('stable', 'pi').sidecarPath);
    const target = `${path}.target`;
    await writeFile(target, await readFile(path));
    await rm(path);
    await symlink(target, path);
    await expectFailure(fixture, /sidecar\.path: evidence must be a regular file/);
  });
  await t.test('directory evidence path', async () => {
    const fixture = await makeFixture();
    const path = join(fixture.root, evidenceNames('stable', 'pi').manifestPath);
    await rm(path);
    await mkdir(path);
    await expectFailure(fixture, /manifest\.path: evidence must be a regular file/);
  });
  await t.test('parsed identity mismatch with matching byte metadata', async () => {
    const fixture = await makeFixture();
    await rewriteManifest(fixture, 'beta', 'pi', (manifest) => { manifest.runtime = 'omp'; });
    await expectFailure(fixture, /manifest\.parsed\.runtime: expected pi/);
  });
  await t.test('logical archive name mismatch', async () => {
    const fixture = await makeFixture();
    await rewriteManifest(fixture, 'stable', 'pi', (manifest) => {
      manifest.artifact.url = manifest.artifact.url.replace('/kit.tar.gz', '/renamed.tar.gz');
    });
    await expectFailure(fixture, /manifest\.parsed\.artifact\.name: expected kit\.tar\.gz/);
  });
  await t.test('GitHub archive asset name mismatch', async () => {
    const fixture = await makeFixture();
    await rewriteManifest(fixture, 'stable', 'pi', (manifest) => {
      manifest.githubAssets.find((asset) => asset.kind === 'archive').name = 'kit.tar.gz';
    });
    await expectFailure(fixture, /manifest\.parsed\.githubAssets\.archive\.name: expected agentkit-kit-test-pi-1\.0\.0\.tar\.gz/);
  });
  await t.test('unknown parsed manifest field', async () => {
    const fixture = await makeFixture();
    await rewriteManifest(fixture, 'stable', 'pi', (manifest) => { manifest.legacy = true; });
    await expectFailure(fixture, /manifest\.parsed:.*unknown fields \[legacy\]/);
  });
  await t.test('duplicate parsed channel-version-Kit-runtime tuple', async () => {
    const fixture = await makeFixture();
    await rewriteManifest(fixture, 'beta', 'pi', (manifest) => { manifest.runtime = 'omp'; });
    await expectFailure(fixture, /duplicate channel\/version\/Kit\/runtime tuple beta\/1\.1\.0-beta\.1\/test\/omp/);
  });
});

test('rejects triad field and exact-path mismatches', async (t) => {
  await t.test('missing manifest field', async () => {
    const fixture = await makeFixture({ mutateRegistry: (registry) => {
      delete registry.channels.stable.kits.test.artifacts.pi.manifest.size;
    } });
    await expectFailure(fixture, /artifacts\.pi\.manifest: missing fields \[size\]/);
  });
  await t.test('manifest path mismatch', async () => {
    const fixture = await makeFixture({ mutateRegistry: (registry) => {
      registry.channels.beta.kits.test.artifacts.pi.manifest.path = registry.channels.beta.kits.test.artifacts.omp.manifest.path;
    } });
    await expectFailure(fixture, /artifacts\.pi\.manifest\.path: expected release-evidence\/kit-catalog\/beta-v1\.1\.0-beta\.1\/agentkit-kit-test-pi-1\.1\.0-beta\.1\.manifest\.json/);
  });
  await t.test('sidecar asset-name mismatch', async () => {
    const fixture = await makeFixture({ mutateRegistry: (registry) => {
      registry.channels.beta.kits.test.artifacts.pi.sidecar.name = 'wrong.sha256';
    } });
    await expectFailure(fixture, /artifacts\.pi\.sidecar\.name: expected/);
  });
  await t.test('unknown triad field', async () => {
    const fixture = await makeFixture({ mutateRegistry: (registry) => {
      registry.channels.beta.kits.test.artifacts.pi.remote = true;
    } });
    await expectFailure(fixture, /artifacts\.pi:.*unknown fields \[remote\]/);
  });
});

test('same snapshot with a missing Stable route fails exact Stable inventory', async () => {
  const fixture = await makeFixture({ stableDocs: { en: [], vi: [], navEn: [], navVi: [], indexEn: [], indexVi: [] } });
  await expectFailure(fixture, /stable\/test exact routed details EN: missing \[alpha\]/);
});

test('same artifact matrix requires byte-identical complete Kit docs closure', async (t) => {
  await t.test('routed guide bytes', async () => {
    const fixture = await makeFixture({ betaDocs: { enBytes: { alpha: 'different guide bytes\n' } } });
    await expectFailure(fixture, /Stable\/Beta full kits tree: divergent bytes at test\/skills\/alpha\.en\.mdx/);
  });
  await t.test('metadata bytes', async () => {
    const fixture = await makeFixture();
    await writeJson(join(fixture.docsRoot, 'beta', 'kits', 'test', 'skills', 'meta.json'), { title: 'Skills', pages: ['alpha'], note: 'different bytes' });
    await expectFailure(fixture, /Stable\/Beta full kits tree: divergent bytes at test\/skills\/meta\.json/);
  });
  await t.test('index bytes', async () => {
    const fixture = await makeFixture();
    const path = join(fixture.docsRoot, 'beta', 'kits', 'test', 'skills', 'index.en.mdx');
    await writeFile(path, `${await readFile(path, 'utf8')}\n`);
    await expectFailure(fixture, /Stable\/Beta full kits tree: divergent bytes at test\/skills\/index\.en\.mdx/);
  });
  await t.test('nested Hook index drift outside the Skill inventory', async () => {
    const fixture = await makeFixture();
    for (const channel of ['stable', 'beta']) {
      const hooks = join(fixture.docsRoot, channel, 'kits', 'test', 'hooks');
      await mkdir(hooks, { recursive: true });
      await writeFile(join(hooks, 'index.en.mdx'), channel === 'stable' ? 'stale Hook index\n' : 'current Hook index\n');
    }
    assert.equal(spawnSync('git', ['-C', fixture.root, 'add', 'content/docs']).status, 0);
    await expectFailure(fixture, /Stable\/Beta full kits tree: divergent bytes at test\/hooks\/index\.en\.mdx/);
  });
  await t.test('untracked nested file is outside tracked mirror closure', async () => {
    const fixture = await makeFixture();
    const hooks = join(fixture.docsRoot, 'stable', 'kits', 'test', 'hooks');
    await mkdir(hooks, { recursive: true });
    await writeFile(join(hooks, 'extra.mdx'), 'extra\n');
    await assert.doesNotReject(() => checkKitCatalog(fixture));
  });
});

test('different snapshots with a smaller exact Stable inventory pass after one runtime changes', async () => {
  const fixture = await makeFixture({
    stableIdentities: [identity('ak-alpha')],
    betaIdentities: [identity('ak-alpha'), identity('ak-beta')],
    mismatchRuntime: 'pi',
  });
  await assert.doesNotReject(() => checkKitCatalog(fixture));
});

test('matching all six artifact hashes reject different snapshots', async () => {
  const fixture = await makeFixture({ stableIdentities: [identity('ak-alpha')], betaIdentities: [identity('ak-alpha'), identity('ak-beta')] });
  await expectFailure(fixture, /all runtime artifact hashes match but snapshots differ/);
});

test('one runtime mismatch disables byte mirroring but never exact inventory', async (t) => {
  await t.test('divergent guide bytes allowed', async () => {
    const fixture = await makeFixture({ mismatchRuntime: 'omp', betaDocs: { enBytes: { alpha: 'different guide bytes\n' } } });
    await assert.doesNotReject(() => checkKitCatalog(fixture));
  });
  await t.test('missing Stable route still rejected', async () => {
    const fixture = await makeFixture({ mismatchRuntime: 'omp', stableDocs: { en: [], vi: [], navEn: [], navVi: [], indexEn: [], indexVi: [] } });
    await expectFailure(fixture, /stable\/test exact routed details EN/);
  });
});

test('rejects locale, navigation, index, and overview errors independently by channel', async (t) => {
  await t.test('missing VI detail', async () => {
    const fixture = await makeFixture({ betaDocs: { vi: [] } });
    await expectFailure(fixture, /beta\/test EN\/VI details: missing \[alpha\]/);
  });
  await t.test('extra EN detail', async () => {
    const fixture = await makeFixture({ betaDocs: { en: ['alpha', 'orphan'] } });
    await expectFailure(fixture, /beta\/test exact routed details EN:.*extra \[orphan\]/);
  });
  await t.test('locale nav mismatch', async () => {
    const fixture = await makeFixture({ stableDocs: { navVi: [] } });
    await expectFailure(fixture, /stable\/test EN\/VI public nav: missing \[alpha\]/);
  });
  await t.test('duplicate nav', async () => {
    const fixture = await makeFixture({ betaDocs: { navEn: ['alpha', 'alpha'] } });
    await expectFailure(fixture, /public nav EN: duplicate pages \[alpha\]/);
  });
  await t.test('EN index missing route', async () => {
    const fixture = await makeFixture({ betaDocs: { indexEn: [] } });
    await expectFailure(fixture, /beta\/test exact public index EN: missing \[alpha\]/);
  });
  await t.test('VI index extra route', async () => {
    const fixture = await makeFixture({ stableDocs: { indexVi: ['alpha', 'orphan'] } });
    await expectFailure(fixture, /stable\/test exact public index VI:.*extra \[orphan\]/);
  });
  await t.test('overview count wrong', async () => {
    const fixture = await makeFixture({ betaDocs: { countEn: 2 } });
    await expectFailure(fixture, /beta\/test overview EN: Skills count 2 does not match snapshot total 1/);
  });
});

test('compares channel-scoped optional inventories including invocation identity', async () => {
  const fixture = await makeFixture();
  const inventoryPath = join(fixture.root, 'inventory.json');
  await writeJson(inventoryPath, { identities: [{ sourceIdentity: 'ak-alpha', declaredInvocation: 'ak:alpha' }] });
  const reports = await checkKitCatalog({ ...fixture, inventories: { 'stable:test': inventoryPath } });
  assert.equal(reports[0].inventoryChecked, true);
  assert.equal(reports[1].inventoryChecked, false);
  await writeJson(inventoryPath, { identities: [{ sourceIdentity: 'ak-alpha', declaredInvocation: 'ak:renamed' }] });
  await expectFailure({ ...fixture, inventories: { 'stable:test': inventoryPath } }, /inventory invocation ak:renamed does not match ak:alpha/);
});

test('closed-world evidence rejects a 49th orphan archive file', async () => {
  const sourceRoot = join(import.meta.dirname, '..');
  const root = await mkdtemp(join(tmpdir(), 'ak-kit-catalog-closed-world-'));
  temporaryRoots.push(root);
  await mkdir(join(root, 'release-evidence'), { recursive: true });
  await cp(join(sourceRoot, 'release-evidence', 'kit-catalog'), join(root, 'release-evidence', 'kit-catalog'), { recursive: true });
  const [registry, channels] = await Promise.all([
    readFile(join(sourceRoot, 'kit-catalog-identities.json'), 'utf8').then(JSON.parse),
    readFile(join(sourceRoot, 'channels.json'), 'utf8').then(JSON.parse),
  ]);
  const orphan = 'release-evidence/kit-catalog/orphans/agentkit-kit-orphan.tar.gz';
  await mkdir(join(root, 'release-evidence', 'kit-catalog', 'orphans'), { recursive: true });
  await writeFile(join(root, orphan), 'not allowed\n');
  const errors = await validateCatalogEvidence({ registry, channelsIdentity: channels, root });
  assert.ok(errors.some((error) => error === `catalog evidence files: missing []; extra [${orphan}]`), errors.join('\n'));
});

test('real registry validates all 24 evidence triads and 48 committed files', async () => {
  const root = join(import.meta.dirname, '..');
  const [registry, channels] = await Promise.all([
    readFile(join(root, 'kit-catalog-identities.json'), 'utf8').then(JSON.parse),
    readFile(join(root, 'channels.json'), 'utf8').then(JSON.parse),
  ]);
  assert.deepEqual(validateRegistry(registry, channels), []);
  assert.deepEqual(await validateCatalogEvidence({ registry, channelsIdentity: channels, root }), []);
  assert.equal(Object.keys(registry.inventorySnapshots).length, 2);
  const triads = [];
  const evidencePaths = new Set();
  for (const channel of ['stable', 'beta']) {
    assert.equal(Object.keys(registry.channels[channel].kits.engineer.artifacts).length, 6);
    assert.equal(Object.keys(registry.channels[channel].kits.marketing.artifacts).length, 6);
    for (const [kitId, bindingValue] of Object.entries(registry.channels[channel].kits)) {
      for (const [runtime, triad] of Object.entries(bindingValue.artifacts)) {
        triads.push(`${channel}/${kitId}/${runtime}`);
        evidencePaths.add(triad.manifest.path);
        evidencePaths.add(triad.sidecar.path);
      }
    }
  }
  assert.equal(new Set(triads).size, 24);
  assert.equal(evidencePaths.size, 48);
  const snapshots = Object.values(registry.inventorySnapshots);
  assert.deepEqual(snapshots.map((value) => [value.kitId, value.identities.length]), [['engineer', 106], ['marketing', 84]]);
  assert.equal(registry.channels.stable.kits.engineer.snapshotDigest, registry.channels.beta.kits.engineer.snapshotDigest);
  assert.equal(registry.channels.stable.kits.marketing.snapshotDigest, registry.channels.beta.kits.marketing.snapshotDigest);
});
