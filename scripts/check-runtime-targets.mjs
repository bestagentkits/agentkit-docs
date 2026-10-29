#!/usr/bin/env node
// Drift guard for the AgentKit setup-target claims in the docs.
//
// The fixture records the seven setup targets, their adapter stage, the
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
  for (const t of fixture.setupTargets) {
    if (!['production', 'spike'].includes(t.adapterStage)) errors.push(`${t.id}: adapterStage must be production or spike`);
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
  // Only Beta prose is checked, so only Beta's released runtimes bind the fixture.
  for (const [channel, data] of Object.entries(catalog.channels ?? {}).filter(([c]) => c === 'beta')) {
    const runtimes = data.runtimes ?? [];
    for (const [kit, binding] of Object.entries(data.kits ?? {})) {
      const names = JSON.stringify(binding.artifacts ?? {});
      for (const id of ids) {
        if (!names.includes(`-${id}-`)) errors.push(`${channel}: kit ${kit} has no released package for ${id}`);
      }
    }
    for (const id of ids) {
      if (!runtimes.includes(id)) errors.push(`${channel}: released runtimes miss setup target ${id}`);
    }
    for (const id of fixture.exportOnly) {
      if (runtimes.includes(id)) errors.push(`${channel}: export-only ${id} appears as a released runtime`);
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
    // Matrices before the adapter_stage rename spell the same field `status`.
    const field = line.match(/^ {4}(adapter_stage|status|dispatch):\s*(\S+)/);
    if (field && current) runtimes[current][field[1] === 'status' ? 'adapter_stage' : field[1]] = field[2];
  }
  return runtimes;
}

export function checkSourceMatrix(fixture, matrix) {
  const errors = [];
  for (const t of fixture.setupTargets) {
    const row = matrix[t.id];
    if (!row) { errors.push(`source matrix has no row for ${t.id}`); continue; }
    if (row.adapter_stage !== t.adapterStage) errors.push(`${t.id}: source adapter_stage ${row.adapter_stage} != fixture ${t.adapterStage}`);
    if (t.runDispatch !== (row.dispatch !== 'none')) errors.push(`${t.id}: fixture runDispatch ${t.runDispatch} disagrees with source dispatch ${row.dispatch}`);
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
    const full = lists.find((l) => l.includes('Claude Code') && l.length > 2);
    if (JSON.stringify(full) !== JSON.stringify(fixture.restrictedLists.quickstartTabs)) {
      errors.push(`quickstart (${locale}): install tabs must list ${fixture.restrictedLists.quickstartTabs.join(', ')}`);
    }
    for (const t of fixture.setupTargets) {
      if (!quick.includes(`--target ${t.id} `)) errors.push(`quickstart (${locale}): missing install command for ${t.id}`);
    }

    const kits = read(root, pages.kitsIndex, locale);
    const adapters = read(root, pages.runtimeAdapters, locale);
    if (kits !== null) {
      for (const t of fixture.setupTargets) {
        if (!new RegExp(`^\\|\\s*${t.name}\\s*\\|`, 'm').test(kits)) errors.push(`kits index (${locale}): invocation table has no row for ${t.name}`);
      }
    }
    for (const [label, body] of [['kits index', kits], ['runtime adapters', adapters]]) {
      if (body === null) { errors.push(`missing ${label} (${locale})`); continue; }
      for (const t of fixture.setupTargets) {
        const named = new RegExp(`(?<!My )\\b${t.name}\\b`);
        if (!named.test(body)) errors.push(`${label} (${locale}): missing ${t.name}`);
      }
    }
    if (adapters !== null) {
      for (const t of fixture.setupTargets) {
        const level = t.adapterStage === 'production' ? 'Production' : 'Spike';
        if (!new RegExp(`\\|\\s*${t.name}\\s*\\|\\s*\`${t.id}\`\\s*\\|\\s*${level}\\s*\\|`).test(adapters)) {
          errors.push(`runtime adapters (${locale}): ${t.name} must be listed as \`${t.id}\` with adapter stage ${level}`);
        }
      }
      for (const id of [...fixture.exportOnly, ...fixture.distributionOnly]) {
        const row = new RegExp(`^\\|[^\\n]*\`${id}\`[^\\n]*\\|\\s*(Production|Spike)\\s*\\|\\s*$`, 'm');
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

    // `pi` is projection-only: a sentence naming `ak run` and `--target pi` must
    // carry a negation within 40 characters before the command.
    for (const [label, body] of [['quickstart', quick], ['kits index', kits], ['runtime adapters', adapters], ['installing kits', installing]]) {
      if (!body) continue;
      const joined = body.split('\n').reduce((acc, line) => {
        const isRow = line.trimStart().startsWith('|');
        if (acc.length && line.trim() && !isRow && !acc[acc.length - 1].isRow) acc[acc.length - 1].text += ` ${line.trim()}`;
        else acc.push({ text: line.trim(), isRow });
        return acc;
      }, []);
      for (const sentence of joined.flatMap((p) => (p.isRow ? [p.text] : p.text.split(/(?<=\.)\s/)))) {
        const text = sentence.replace(/`/g, '');
        if (!/ak run\b.*--target pi\b/.test(text)) continue;
        if (!/\b(no|not|without|never)\b[^.]{0,40}\bak run\b|không\b[^.]{0,40}\bak run\b/i.test(text)) {
          errors.push(`${label} (${locale}): unqualified \`ak run --target pi\` claim: ${text.trim().slice(0, 80)}`);
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
  const source = i > -1 ? process.argv[i + 1] : undefined;
  if (i > -1 && !source) {
    console.error('::error::--source needs the path of an AgentKit checkout');
    process.exit(2);
  }
  const errors = runChecks({ source });
  if (errors.length) {
    for (const e of errors) console.error(`::error::${e}`);
    process.exit(1);
  }
  console.log(`runtime targets: seven setup targets consistent across fixture, catalog and Beta prose${source ? ', and the source matrix' : ' (source matrix not compared)'}`);
}
