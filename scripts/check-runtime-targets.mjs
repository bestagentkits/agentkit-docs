#!/usr/bin/env node
// Drift guard for the AgentKit setup-target claims in the docs.
//
// The fixture records the seven setup targets, their support level, the
// export-only and distribution-only names that are not setup targets, and the
// restricted lists that intentionally show fewer runtimes. This script checks:
//   1. the fixture against the released Kit catalog (release-bound packages),
//   2. the fixture against the AgentKit source matrix when --source is given,
//   3. the Beta prose in both locales against the fixture.
// Stable prose is promotion-owned and is not checked here.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = ['en', 'vi'];

export function loadFixture(root = ROOT) {
  return JSON.parse(readFileSync(path.join(root, 'fixtures/runtime-targets/setup-targets.json'), 'utf8'));
}

export function checkFixtureShape(fixture) {
  const errors = [];
  const ids = fixture.setupTargets.map((t) => t.id);
  if (new Set(ids).size !== ids.length) errors.push('fixture setupTargets contain duplicate ids');
  if (ids.length !== 7) errors.push(`fixture must list seven setup targets, found ${ids.length}`);
  for (const t of fixture.setupTargets) {
    if (!['production', 'spike'].includes(t.support)) errors.push(`${t.id}: support must be production or spike`);
  }
  for (const id of [...fixture.exportOnly, ...fixture.distributionOnly]) {
    if (ids.includes(id)) errors.push(`${id} is export-only or distribution-only and must not be a setup target`);
  }
  const names = fixture.setupTargets.map((t) => t.name);
  if (JSON.stringify(names) !== JSON.stringify(fixture.restrictedLists.quickstartTabs)) {
    errors.push('quickstartTabs must list every setup target name in fixture order');
  }
  return errors;
}

// Released packages must exist for each setup id in each channel; export-only
// names must not appear as released runtimes.
export function checkCatalog(fixture, catalog) {
  const errors = [];
  const ids = fixture.setupTargets.map((t) => t.id);
  for (const [channel, data] of Object.entries(catalog.channels ?? {})) {
    const runtimes = data.runtimes ?? [];
    for (const id of ids) {
      if (!runtimes.includes(id)) errors.push(`${channel}: released runtimes miss setup target ${id}`);
    }
    for (const id of fixture.exportOnly) {
      if (runtimes.includes(id)) errors.push(`${channel}: export-only ${id} appears as a released runtime`);
    }
    for (const id of fixture.distributionOnly) {
      if (!runtimes.includes(id)) errors.push(`${channel}: distribution-only ${id} is missing from released runtimes`);
    }
  }
  return errors;
}

export function parseMatrix(yaml) {
  const runtimes = {};
  let current = null;
  let inRuntimes = false;
  for (const line of yaml.split('\n')) {
    if (/^runtimes:\s*$/.test(line)) { inRuntimes = true; continue; }
    if (!inRuntimes) continue;
    if (/^\S/.test(line)) break;
    const key = line.match(/^ {2}([a-z][a-z0-9-]*):\s*$/);
    if (key) { current = key[1]; runtimes[current] = {}; continue; }
    const field = line.match(/^ {4}(status|dispatch):\s*(\S+)/);
    if (field && current) runtimes[current][field[1]] = field[2];
  }
  return runtimes;
}

export function checkSourceMatrix(fixture, matrix) {
  const errors = [];
  for (const t of fixture.setupTargets) {
    const row = matrix[t.id];
    if (!row) { errors.push(`source matrix has no row for ${t.id}`); continue; }
    if (row.status !== t.support) errors.push(`${t.id}: source status ${row.status} != fixture ${t.support}`);
    if (t.id === 'pi' && row.dispatch !== 'none') errors.push('pi must have no dispatch in the source matrix');
  }
  for (const id of fixture.exportOnly) {
    if (!matrix[id]) errors.push(`source matrix has no row for export-only ${id}`);
    else if (matrix[id].dispatch !== 'none') errors.push(`${id}: export-only target must not have dispatch`);
  }
  return errors;
}

const read = (root, rel, locale) => {
  const file = path.join(root, 'content/docs/beta', `${rel}.${locale}.mdx`);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
};

export function checkProse(fixture, root = ROOT) {
  const errors = [];
  const { documentedPages: pages } = fixture;
  for (const locale of LOCALES) {
    const quick = read(root, pages.quickstart, locale);
    if (quick === null) { errors.push(`missing quickstart (${locale})`); continue; }
    const tabs = quick.match(/<Tabs items=\{\[([^\]]*)\]\}>/g) ?? [];
    const lists = tabs.map((t) => [...t.matchAll(/'([^']+)'/g)].map((m) => m[1]));
    const full = lists.find((l) => l.length > 2);
    if (JSON.stringify(full) !== JSON.stringify(fixture.restrictedLists.quickstartTabs)) {
      errors.push(`quickstart (${locale}): install tabs must list ${fixture.restrictedLists.quickstartTabs.join(', ')}`);
    }
    for (const t of fixture.setupTargets) {
      if (!quick.includes(`--target ${t.id} `)) errors.push(`quickstart (${locale}): missing install command for ${t.id}`);
    }

    const kits = read(root, pages.kitsIndex, locale);
    const adapters = read(root, pages.runtimeAdapters, locale);
    for (const [label, body] of [['kits index', kits], ['runtime adapters', adapters]]) {
      if (body === null) { errors.push(`missing ${label} (${locale})`); continue; }
      for (const t of fixture.setupTargets) {
        if (!body.includes(t.name)) errors.push(`${label} (${locale}): missing ${t.name}`);
      }
    }
    if (adapters !== null) {
      for (const t of fixture.setupTargets) {
        const level = t.support === 'production' ? 'Production' : 'Spike';
        if (!new RegExp(`\\|\\s*${t.name}\\s*\\|\\s*\`${t.id}\`\\s*\\|\\s*${level}\\s*\\|`).test(adapters)) {
          errors.push(`runtime adapters (${locale}): ${t.name} must be listed as \`${t.id}\` with support level ${level}`);
        }
      }
      for (const id of [...fixture.exportOnly, ...fixture.distributionOnly]) {
        const row = new RegExp(`^\\|[^\\n]*\`${id}\`[^\\n]*\\|\\s*(Production|Spike)\\s*\\|$`, 'm');
        if (row.test(adapters)) errors.push(`runtime adapters (${locale}): ${id} must not appear in the setup target table`);
      }
    }

    const installing = read(root, pages.installingKits, locale);
    if (installing !== null) {
      for (const t of fixture.setupTargets.filter((x) => x.id !== 'claude-code')) {
        if (!installing.includes(`--target ${t.id}`) && !installing.includes(`\`${t.id}\``)) {
          errors.push(`installing kits (${locale}): missing --target ${t.id}`);
        }
      }
    }

    // `pi` is projection-only: any `ak run --target pi` mention must sit in a paragraph that negates it.
    for (const [label, body] of [['quickstart', quick], ['kits index', kits], ['runtime adapters', adapters], ['installing kits', installing]]) {
      if (!body) continue;
      for (const block of body.split(/\n\s*\n/)) {
        if (/ak run[^`]*--target pi\b/.test(block) && !/\b(no|not|without|never)\b|không|chưa/i.test(block)) {
          errors.push(`${label} (${locale}): unqualified \`ak run --target pi\` claim: ${block.trim().slice(0, 80)}`);
        }
      }
    }
  }
  return errors;
}

export function runChecks({ root = ROOT, source } = {}) {
  const fixture = loadFixture(root);
  const errors = checkFixtureShape(fixture);
  const catalogPath = path.join(root, 'kit-catalog-identities.json');
  errors.push(...checkCatalog(fixture, JSON.parse(readFileSync(catalogPath, 'utf8'))));
  if (source) {
    const matrix = readFileSync(path.join(source, fixture.source.matrix), 'utf8');
    errors.push(...checkSourceMatrix(fixture, parseMatrix(matrix)));
  }
  errors.push(...checkProse(fixture, root));
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--source');
  const errors = runChecks({ source: i > -1 ? process.argv[i + 1] : undefined });
  if (errors.length) {
    for (const e of errors) console.error(`::error::${e}`);
    process.exit(1);
  }
  console.log('runtime targets: seven setup targets consistent across fixture, catalog and Beta prose');
}
