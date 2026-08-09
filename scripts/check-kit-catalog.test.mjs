import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkKitCatalog } from './check-kit-catalog.mjs';

const CLASSIFICATIONS = [
  'public',
  'alias',
  'internal',
  'duplicate',
  'unsupported',
  'intentionally-unlisted',
  'collision-blocked',
];
const temporaryRoots = [];

function identity(sourceIdentity, classification = 'public', overrides = {}) {
  const slug = sourceIdentity.replace(/^ak-/, '');
  return {
    sourceIdentity,
    declaredInvocation: `ak:${slug}`,
    classification,
    canonicalRoute: classification === 'public' ? `kits/test/skills/${slug}` : null,
    aliases: [],
    evidenceRef: `fixture:test#test/skills/${sourceIdentity}/SKILL.md`,
    rationale: 'Test identity.',
    ...(classification !== 'public' && classification !== 'alias'
      ? { reviewedException: `reviewed-${slug}` }
      : {}),
    ...overrides,
  };
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function makeFixture({
  identities = [identity('ak-alpha')],
  betaRoutes,
  stableRoutes,
  betaViRoutes,
  stableViRoutes,
  nav,
  stableNav,
  betaIndexRoutes,
  betaViIndexRoutes,
  count = identities.length,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ak-kit-catalog-'));
  temporaryRoots.push(root);
  const docsRoot = join(root, 'content', 'docs');
  const routed = identities
    .filter((entry) => ['public', 'intentionally-unlisted', 'collision-blocked'].includes(entry.classification))
    .map((entry) => entry.canonicalRoute.split('/').at(-1));
  const publicRoutes = identities
    .filter((entry) => entry.classification === 'public')
    .map((entry) => entry.canonicalRoute.split('/').at(-1));
  const routesByChannel = {
    beta: {
      en: betaRoutes ?? routed,
      vi: betaViRoutes ?? betaRoutes ?? routed,
      nav: nav ?? publicRoutes,
      indexEn: betaIndexRoutes ?? publicRoutes,
      indexVi: betaViIndexRoutes ?? betaIndexRoutes ?? publicRoutes,
    },
    stable: {
      en: stableRoutes ?? betaRoutes ?? routed,
      vi: stableViRoutes ?? stableRoutes ?? betaViRoutes ?? betaRoutes ?? routed,
      nav: stableNav ?? nav ?? publicRoutes,
      indexEn: publicRoutes,
      indexVi: publicRoutes,
    },
  };
  for (const [channel, observed] of Object.entries(routesByChannel)) {
    const skillsDir = join(docsRoot, channel, 'kits', 'test', 'skills');
    await mkdir(skillsDir, { recursive: true });
    for (const slug of observed.en) await writeFile(join(skillsDir, `${slug}.en.mdx`), '---\ntitle: Test\n---\n');
    for (const slug of observed.vi) await writeFile(join(skillsDir, `${slug}.vi.mdx`), '---\ntitle: Test\n---\n');
    await writeJson(join(skillsDir, 'meta.json'), { pages: observed.nav });
    await writeJson(join(skillsDir, 'meta.vi.json'), { pages: observed.nav });
    const indexBody = (routes) =>
      `---\ntitle: Test\n---\n\n${routes.map((slug) => `[ak:${slug}](./${slug})`).join('\n')}\n`;
    await writeFile(join(skillsDir, 'index.en.mdx'), indexBody(observed.indexEn));
    await writeFile(join(skillsDir, 'index.vi.mdx'), indexBody(observed.indexVi));
    const overview = `---\ntitle: Test\n---\n\n| Component | Resolved count | Note |\n| --- | ---: | --- |\n| Skills | ${count} | Fixture |\n`;
    await writeFile(join(docsRoot, channel, 'kits', 'test.en.mdx'), overview);
    await writeFile(join(docsRoot, channel, 'kits', 'test.vi.mdx'), overview);
  }
  const registryPath = join(root, 'kit-catalog-identities.json');
  await writeJson(registryPath, {
    schemaVersion: 1,
    classifications: CLASSIFICATIONS,
    kits: [
      {
        kitId: 'test',
        overviewPath: 'content/docs/beta/kits/test.en.mdx',
        overviewMetric: 'source-identities',
        identities,
      },
    ],
  });
  return { root, docsRoot, registryPath };
}

async function expectFailure(fixture, pattern) {
  await assert.rejects(() => checkKitCatalog(fixture), pattern);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test('accepts an explicit source alias without duplicating public semantics', async () => {
  const canonical = identity('ak-alpha', 'public', { aliases: ['ak-alpha-old'] });
  const alias = identity('ak-alpha-old', 'alias', {
    declaredInvocation: 'ak:alpha',
    canonicalRoute: canonical.canonicalRoute,
  });
  const fixture = await makeFixture({ identities: [canonical, alias] });
  const [report] = await checkKitCatalog(fixture);
  assert.deepEqual(report, {
    kitId: 'test',
    sourceIdentities: 2,
    publicIdentities: 1,
    detailRoutes: 1,
    navEntries: 1,
    inventoryChecked: false,
  });
});

test('rejects a duplicate public invocation', async () => {
  const fixture = await makeFixture({
    identities: [identity('ak-alpha'), identity('ak-beta', 'public', { declaredInvocation: 'ak:alpha' })],
  });
  await expectFailure(fixture, /duplicate declared invocation ak:alpha/);
});

test('rejects an unregistered detail route', async () => {
  const fixture = await makeFixture({ betaRoutes: ['alpha', 'orphan'], stableRoutes: ['alpha', 'orphan'] });
  await expectFailure(fixture, /registered detail routes.*extra \[orphan\]/);
});

test('rejects a missing locale detail page', async () => {
  const fixture = await makeFixture({ betaViRoutes: [] });
  await expectFailure(fixture, /Beta EN\/VI details.*missing \[alpha\]/);
});

test('rejects Stable and Beta route divergence', async () => {
  const fixture = await makeFixture({ stableRoutes: [] });
  await expectFailure(fixture, /Beta\/Stable EN details.*missing \[alpha\]/);
});

test('rejects a stale overview count', async () => {
  const fixture = await makeFixture({ count: 2 });
  await expectFailure(fixture, /Skills count 2 does not match source-identities 1/);
});

test('rejects an incomplete public Skill index in either locale', async () => {
  const fixture = await makeFixture({ betaViIndexRoutes: [] });
  await expectFailure(fixture, /Beta VI public Skill index.*missing \[alpha\]/);
});

test('accepts a reviewed intentionally-unlisted route', async () => {
  const hidden = identity('ak-hidden', 'intentionally-unlisted', {
    canonicalRoute: 'kits/test/skills/hidden',
  });
  const fixture = await makeFixture({ identities: [identity('ak-alpha'), hidden] });
  await assert.doesNotReject(() => checkKitCatalog(fixture));
});

test('compares an optional exact source inventory instead of inferring it from docs', async () => {
  const fixture = await makeFixture();
  const inventoryPath = join(fixture.root, 'inventory.json');
  await writeJson(inventoryPath, {
    identities: [{ sourceIdentity: 'ak-alpha', declaredInvocation: 'ak:alpha' }],
  });
  const [report] = await checkKitCatalog({
    ...fixture,
    inventories: { test: inventoryPath },
  });
  assert.equal(report.inventoryChecked, true);

  await writeJson(inventoryPath, {
    identities: [{ sourceIdentity: 'ak-alpha', declaredInvocation: 'ak:renamed' }],
  });
  await expectFailure(
    { ...fixture, inventories: { test: inventoryPath } },
    /inventory invocation ak:renamed does not match ak:alpha/,
  );
});

test('reproduces the reviewed Engineer and Marketing catalog counts', async () => {
  const reports = await checkKitCatalog();
  assert.deepEqual(
    reports.map(({ kitId, sourceIdentities, publicIdentities, detailRoutes, navEntries }) => ({
      kitId,
      sourceIdentities,
      publicIdentities,
      detailRoutes,
      navEntries,
    })),
    [
      { kitId: 'engineer', sourceIdentities: 102, publicIdentities: 101, detailRoutes: 101, navEntries: 101 },
      { kitId: 'marketing', sourceIdentities: 81, publicIdentities: 79, detailRoutes: 81, navEntries: 79 },
    ],
  );
});
