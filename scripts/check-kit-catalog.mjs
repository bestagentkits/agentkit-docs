#!/usr/bin/env node
// CI-ready default: node scripts/check-kit-catalog.mjs
// Optional exact inventories: --inventory engineer=engineer.json --inventory marketing=marketing.json
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { repoRoot } from './lib/paths.mjs';

const CLASSIFICATIONS = new Set([
  'public',
  'alias',
  'internal',
  'duplicate',
  'unsupported',
  'intentionally-unlisted',
  'collision-blocked',
]);
const ROUTED = new Set(['public', 'intentionally-unlisted', 'collision-blocked']);
const UNLISTED = new Set([
  'internal',
  'duplicate',
  'unsupported',
  'intentionally-unlisted',
  'collision-blocked',
]);

function sorted(values) {
  return [...values].sort();
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function addDifference(errors, label, expected, actual) {
  const missing = sorted([...expected].filter((value) => !actual.has(value)));
  const extra = sorted([...actual].filter((value) => !expected.has(value)));
  if (missing.length || extra.length) {
    errors.push(`${label}: missing [${missing.join(', ')}]; extra [${extra.join(', ')}]`);
  }
}

function addSubsetViolation(errors, label, subset, superset) {
  const extra = sorted([...subset].filter((value) => !superset.has(value)));
  if (extra.length) errors.push(`${label}: not present in superset [${extra.join(', ')}]`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function detailSlugs(skillsDir, locale) {
  if (!existsSync(skillsDir)) return new Set();
  const suffix = `.${locale}.mdx`;
  return new Set(
    (await readdir(skillsDir))
      .filter((name) => name.endsWith(suffix) && name !== `index${suffix}`)
      .map((name) => name.slice(0, -suffix.length)),
  );
}

async function indexSkillSlugs(skillsDir, locale) {
  const path = join(skillsDir, `index.${locale}.mdx`);
  if (!existsSync(path)) return new Set();
  const body = await readFile(path, 'utf8');
  return new Set(
    [...body.matchAll(/\]\(\.\/([a-z0-9][a-z0-9-]*)\)/g)].map((match) => match[1]),
  );
}

async function observeChannel(docsRoot, channel, kitId) {
  const skillsDir = join(docsRoot, channel, 'kits', kitId, 'skills');
  const metaPath = join(skillsDir, 'meta.json');
  const metaViPath = join(skillsDir, 'meta.vi.json');
  return {
    en: await detailSlugs(skillsDir, 'en'),
    vi: await detailSlugs(skillsDir, 'vi'),
    nav: new Set(existsSync(metaPath) ? (await readJson(metaPath)).pages ?? [] : []),
    navVi: new Set(existsSync(metaViPath) ? (await readJson(metaViPath)).pages ?? [] : []),
    indexEn: await indexSkillSlugs(skillsDir, 'en'),
    indexVi: await indexSkillSlugs(skillsDir, 'vi'),
  };
}

function routeSlug(identity, kitId, errors) {
  if (identity.canonicalRoute === null) return null;
  const prefix = `kits/${kitId}/skills/`;
  if (!identity.canonicalRoute?.startsWith(prefix)) {
    errors.push(`${kitId}/${identity.sourceIdentity}: canonicalRoute must start with ${prefix}`);
    return null;
  }
  return identity.canonicalRoute.slice(prefix.length);
}

function validateIdentityFields(kit, errors) {
  const sourceSeen = new Set();
  for (const identity of kit.identities) {
    const label = `${kit.kitId}/${identity.sourceIdentity ?? '<missing>'}`;
    if (!identity.sourceIdentity || sourceSeen.has(identity.sourceIdentity)) {
      errors.push(`${label}: missing or duplicate sourceIdentity`);
    }
    sourceSeen.add(identity.sourceIdentity);
    if (!identity.declaredInvocation) errors.push(`${label}: declaredInvocation is required`);
    if (!CLASSIFICATIONS.has(identity.classification)) {
      errors.push(`${label}: unsupported classification ${identity.classification}`);
    }
    if (!Array.isArray(identity.aliases)) errors.push(`${label}: aliases must be an array`);
    if (!identity.evidenceRef) errors.push(`${label}: evidenceRef is required`);
    if (!identity.rationale) errors.push(`${label}: rationale is required`);
    if (identity.classification !== 'public' && identity.classification !== 'alias' && !identity.reviewedException) {
      errors.push(`${label}: non-public classification requires reviewedException`);
    }
    if (ROUTED.has(identity.classification) && !identity.canonicalRoute) {
      errors.push(`${label}: ${identity.classification} identity requires canonicalRoute`);
    }
    if (!ROUTED.has(identity.classification) && identity.classification !== 'alias' && identity.canonicalRoute !== null) {
      errors.push(`${label}: ${identity.classification} identity must have canonicalRoute null`);
    }
  }
}

function validateIdentityRelationships(kit, errors) {
  const bySource = new Map(kit.identities.map((entry) => [entry.sourceIdentity, entry]));
  const publicByRoute = new Map();
  const routedByRoute = new Map();
  const invocationGroups = new Map();
  for (const identity of kit.identities) {
    if (ROUTED.has(identity.classification)) {
      const prior = routedByRoute.get(identity.canonicalRoute);
      if (prior) errors.push(`${kit.kitId}: duplicate routed canonicalRoute ${identity.canonicalRoute}`);
      routedByRoute.set(identity.canonicalRoute, identity);
    }
    if (identity.classification === 'public') {
      const prior = publicByRoute.get(identity.canonicalRoute);
      if (prior) errors.push(`${kit.kitId}: duplicate public route ${identity.canonicalRoute}`);
      publicByRoute.set(identity.canonicalRoute, identity);
      for (const aliasName of identity.aliases) {
        const alias = bySource.get(aliasName);
        if (
          !alias ||
          alias.classification !== 'alias' ||
          alias.canonicalRoute !== identity.canonicalRoute ||
          alias.declaredInvocation !== identity.declaredInvocation
        ) {
          errors.push(`${kit.kitId}/${identity.sourceIdentity}: alias ${aliasName} is not a matching alias identity`);
        }
      }
    }
    const group = invocationGroups.get(identity.declaredInvocation) ?? [];
    group.push(identity);
    invocationGroups.set(identity.declaredInvocation, group);
  }
  for (const identity of kit.identities.filter((entry) => entry.classification === 'alias')) {
    const canonical = publicByRoute.get(identity.canonicalRoute);
    if (!canonical || !canonical.aliases.includes(identity.sourceIdentity)) {
      errors.push(`${kit.kitId}/${identity.sourceIdentity}: alias must be named by its public canonical identity`);
    }
  }
  for (const [invocation, group] of invocationGroups) {
    if (group.length === 1) continue;
    const classes = new Set(group.map((entry) => entry.classification));
    const aliasPair =
      group.filter((entry) => entry.classification === 'public').length === 1 &&
      group.some((entry) => entry.classification === 'alias') &&
      [...classes].every((value) => value === 'public' || value === 'alias');
    const collision = classes.size === 1 && classes.has('collision-blocked') && group.length >= 2;
    const exceptionIds = new Set(group.map((entry) => entry.reviewedException).filter(Boolean));
    if ((!aliasPair && !collision) || (collision && exceptionIds.size !== 1)) {
      errors.push(`${kit.kitId}: duplicate declared invocation ${invocation} is not an alias or reviewed collision`);
    }
  }
}

async function overviewCount(path) {
  const body = await readFile(path, 'utf8');
  const match = body.match(/^\|\s*Skills\s*\|\s*(\d+)\s*\|/mi);
  return match ? Number(match[1]) : null;
}

async function validateOverview(root, kit, expected, errors) {
  const betaEn = resolve(root, kit.overviewPath);
  const betaVi = betaEn.replace(/\.en\.mdx$/, '.vi.mdx');
  for (const path of [betaEn, betaVi]) {
    const count = existsSync(path) ? await overviewCount(path) : null;
    if (count !== expected) {
      errors.push(`${relative(root, path)}: Skills count ${count ?? 'missing'} does not match ${kit.overviewMetric} ${expected}`);
    }
  }

  const stableEn = betaEn.replace('/beta/', '/stable/');
  const stableVi = betaVi.replace('/beta/', '/stable/');
  const stableEnCount = existsSync(stableEn) ? await overviewCount(stableEn) : null;
  const stableViCount = existsSync(stableVi) ? await overviewCount(stableVi) : null;
  if (stableEnCount === null || stableViCount === null || stableEnCount !== stableViCount) {
    errors.push(
      `${kit.kitId} Stable EN/VI overview: Skills counts ${stableEnCount ?? 'missing'} and ${stableViCount ?? 'missing'} must match`,
    );
  }
}

async function validateInventory(kit, inventoryPath, errors) {
  if (!inventoryPath) return false;
  const raw = await readJson(inventoryPath);
  const entries = Array.isArray(raw) ? raw : raw.identities;
  if (!Array.isArray(entries)) {
    errors.push(`${kit.kitId}: inventory must be an array or an object with identities`);
    return true;
  }
  const expected = new Map(kit.identities.map((entry) => [entry.sourceIdentity, entry.declaredInvocation]));
  const actual = new Map(entries.map((entry) => [entry.sourceIdentity, entry.declaredInvocation]));
  addDifference(errors, `${kit.kitId} source inventory`, new Set(expected.keys()), new Set(actual.keys()));
  for (const [sourceIdentity, invocation] of expected) {
    if (actual.has(sourceIdentity) && actual.get(sourceIdentity) !== invocation) {
      errors.push(`${kit.kitId}/${sourceIdentity}: inventory invocation ${actual.get(sourceIdentity)} does not match ${invocation}`);
    }
  }
  return true;
}

export async function checkKitCatalog({
  root = repoRoot,
  registryPath = join(root, 'kit-catalog-identities.json'),
  docsRoot = join(root, 'content', 'docs'),
  inventories = {},
} = {}) {
  const registry = await readJson(registryPath);
  const errors = [];
  const reports = [];
  if (registry.schemaVersion !== 1) errors.push(`unsupported registry schemaVersion ${registry.schemaVersion}`);
  if (!sameSet(new Set(registry.classifications ?? []), CLASSIFICATIONS)) {
    errors.push('registry classifications do not match the supported classification set');
  }
  for (const kit of registry.kits ?? []) {
    validateIdentityFields(kit, errors);
    validateIdentityRelationships(kit, errors);
    const beta = await observeChannel(docsRoot, 'beta', kit.kitId);
    const stable = await observeChannel(docsRoot, 'stable', kit.kitId);
    addDifference(errors, `${kit.kitId} Beta EN/VI details`, beta.en, beta.vi);
    addDifference(errors, `${kit.kitId} Stable EN/VI details`, stable.en, stable.vi);
    addDifference(errors, `${kit.kitId} Beta EN/VI nav`, beta.nav, beta.navVi);
    addDifference(errors, `${kit.kitId} Stable EN/VI nav`, stable.nav, stable.navVi);
    addDifference(errors, `${kit.kitId} Stable EN/VI public Skill index`, stable.indexEn, stable.indexVi);
    addDifference(errors, `${kit.kitId} Stable navigation/index`, stable.nav, stable.indexEn);
    addSubsetViolation(errors, `${kit.kitId} Stable details/Beta details`, stable.en, beta.en);
    addSubsetViolation(errors, `${kit.kitId} Stable nav/Beta nav`, stable.nav, beta.nav);
    addSubsetViolation(errors, `${kit.kitId} Stable nav/details`, stable.nav, stable.en);

    const routed = new Set();
    const publicRoutes = new Set();
    for (const identity of kit.identities) {
      const slug = routeSlug(identity, kit.kitId, errors);
      if (ROUTED.has(identity.classification) && slug) routed.add(slug);
      if (identity.classification === 'public' && slug) publicRoutes.add(slug);
      if (UNLISTED.has(identity.classification) && slug && beta.nav.has(slug)) {
        errors.push(`${kit.kitId}/${identity.sourceIdentity}: ${identity.classification} route must not be listed`);
      }
    }
    addDifference(errors, `${kit.kitId} registered detail routes`, routed, beta.en);
    addDifference(errors, `${kit.kitId} public navigation`, publicRoutes, beta.nav);
    addDifference(errors, `${kit.kitId} Beta EN public Skill index`, publicRoutes, beta.indexEn);
    addDifference(errors, `${kit.kitId} Beta VI public Skill index`, publicRoutes, beta.indexVi);
    const metrics = {
      'source-identities': kit.identities.length,
      'public-identities': publicRoutes.size,
    };
    const expectedOverview = metrics[kit.overviewMetric];
    if (expectedOverview === undefined) errors.push(`${kit.kitId}: unsupported overviewMetric ${kit.overviewMetric}`);
    else await validateOverview(root, kit, expectedOverview, errors);
    const inventoryChecked = await validateInventory(kit, inventories[kit.kitId], errors);
    reports.push({
      kitId: kit.kitId,
      sourceIdentities: kit.identities.length,
      publicIdentities: publicRoutes.size,
      detailRoutes: beta.en.size,
      navEntries: beta.nav.size,
      inventoryChecked,
    });
  }
  if (errors.length) throw new Error(`Kit catalog check failed:\n- ${errors.sort().join('\n- ')}`);
  return reports;
}

async function main() {
  const { values } = parseArgs({
    options: {
      registry: { type: 'string', default: 'kit-catalog-identities.json' },
      'docs-root': { type: 'string', default: 'content/docs' },
      inventory: { type: 'string', multiple: true, default: [] },
      json: { type: 'boolean', default: false },
    },
  });
  const inventories = {};
  for (const value of values.inventory) {
    const separator = value.indexOf('=');
    if (separator < 1) throw new Error(`invalid --inventory ${value}; expected kit=path`);
    inventories[value.slice(0, separator)] = resolve(repoRoot, value.slice(separator + 1));
  }
  const reports = await checkKitCatalog({
    registryPath: resolve(repoRoot, values.registry),
    docsRoot: resolve(repoRoot, values['docs-root']),
    inventories,
  });
  if (values.json) console.log(JSON.stringify(reports, null, 2));
  else {
    for (const report of reports) {
      const inventory = report.inventoryChecked ? 'verified' : 'not supplied; immutable registry evidence used';
      console.log(`${report.kitId}: source=${report.sourceIdentities}, public=${report.publicIdentities}, details=${report.detailRoutes}, nav=${report.navEntries}, inventory=${inventory}`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
