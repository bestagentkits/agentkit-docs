#!/usr/bin/env node
// CI-ready default: node scripts/check-kit-catalog.mjs
// Optional exact inventories: --inventory stable:engineer=engineer.json
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { repoRoot } from './lib/paths.mjs';
import {
  CHANNELS,
  formatReport,
  observeKitDocs,
  parseJsonStrict,
  validateCatalogEvidence,
  validateInventory,
  validateMirrorClosure,
  validateRegistry,
} from './lib/kit-catalog.mjs';

async function readJson(path) {
  return parseJsonStrict(await readFile(path, 'utf8'), path);
}

export class KitCatalogError extends Error {
  constructor(errors, reports) {
    super(`Kit catalog check failed:\n- ${errors.sort().join('\n- ')}`);
    this.name = 'KitCatalogError';
    this.errors = errors;
    this.reports = reports;
  }
}

export async function checkKitCatalog({
  root = repoRoot,
  registryPath = join(root, 'kit-catalog-identities.json'),
  channelsPath = join(root, 'channels.json'),
  docsRoot = join(root, 'content', 'docs'),
  inventories = {},
} = {}) {
  const [registry, channelIdentities] = await Promise.all([readJson(registryPath), readJson(channelsPath)]);
  const errors = validateRegistry(registry, channelIdentities);
  if (errors.length === 0) errors.push(...await validateCatalogEvidence({ registry, channelsIdentity: channelIdentities, root }));
  const reports = [];
  const observations = new Map();

  if (errors.length === 0 && registry.schemaVersion === 2 && registry.channels && registry.inventorySnapshots) {
    for (const channel of CHANNELS) {
      for (const [kitId, binding] of Object.entries(registry.channels[channel]?.kits ?? {})) {
        const snapshot = registry.inventorySnapshots[binding?.snapshotDigest];
        if (!snapshot || !Array.isArray(snapshot.identities)) continue;
        const observed = await observeKitDocs({ docsRoot, channel, kitId, snapshot, errors });
        observations.set(`${channel}:${kitId}`, observed);
        const inventoryKey = `${channel}:${kitId}`;
        const inventoryChecked = await validateInventory(snapshot, inventories[inventoryKey], inventoryKey, errors);
        reports.push({
          channel,
          kitId,
          total: snapshot.identities.length,
          public: snapshot.identities.filter((entry) => entry.classification === 'public').length,
          internal: snapshot.identities.filter((entry) => entry.classification === 'internal').length,
          details: observed.en.size,
          nav: observed.nav.size,
          artifacts: Object.keys(binding.artifacts ?? {}).length,
          inventoryChecked,
        });
      }
    }
    if (registry.channels.stable?.kits && registry.channels.beta?.kits) await validateMirrorClosure(registry, root, docsRoot, errors);
  }

  const knownInventories = new Set(reports.map((report) => `${report.channel}:${report.kitId}`));
  for (const key of Object.keys(inventories)) {
    if (!knownInventories.has(key)) errors.push(`inventory ${key}: no matching channel Kit binding`);
  }
  if (errors.length) throw new KitCatalogError(errors, reports);
  return reports;
}

async function main() {
  const { values } = parseArgs({
    options: {
      registry: { type: 'string', default: 'kit-catalog-identities.json' },
      channels: { type: 'string', default: 'channels.json' },
      'docs-root': { type: 'string', default: 'content/docs' },
      inventory: { type: 'string', multiple: true, default: [] },
      json: { type: 'boolean', default: false },
    },
  });
  const inventories = {};
  for (const value of values.inventory) {
    const separator = value.indexOf('=');
    const key = value.slice(0, separator);
    if (separator < 1 || !/^(stable|beta):[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) {
      throw new Error(`invalid --inventory ${value}; expected channel:kit=path`);
    }
    if (Object.hasOwn(inventories, key)) throw new Error(`duplicate --inventory ${key}`);
    inventories[key] = resolve(repoRoot, value.slice(separator + 1));
  }
  const reports = await checkKitCatalog({
    registryPath: resolve(repoRoot, values.registry),
    channelsPath: resolve(repoRoot, values.channels),
    docsRoot: resolve(repoRoot, values['docs-root']),
    inventories,
  });
  if (values.json) console.log(JSON.stringify(reports, null, 2));
  else reports.forEach((report) => console.log(formatReport(report)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    if (Array.isArray(error.reports)) error.reports.forEach((report) => console.error(formatReport(report)));
    console.error(error.message);
    process.exit(1);
  });
}
