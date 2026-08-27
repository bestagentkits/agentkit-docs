#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { repoRoot } from './lib/paths.mjs';
import { DEFAULT_MANIFEST_PATH } from './lib/kit-docs-reconciliation.mjs';

export const STABLE_PREFIX = 'content/docs/stable/';
export const PROMOTIONS_PREFIX = 'docs-promotions/';
export const STABLE_PROMOTION_EVIDENCE_PREFIX = 'release-evidence/stable-promotions/';

function fail(message) {
  throw new Error(`Kit docs CI routing: ${message}`);
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { maxBuffer: 128 * 1024 * 1024 });
  if (result.error) fail(`cannot run git ${args.join(' ')}: ${result.error.message}`);
  if (result.status !== 0) fail(`git ${args.join(' ')} failed: ${(result.stderr || '').toString().trim()}`);
  return result.stdout;
}

export function parseNameStatus(output) {
  const tokens = Buffer.isBuffer(output) ? output.toString('utf8').split('\0') : String(output).split('\0');
  if (tokens.at(-1) !== '') fail('Git diff status is not NUL terminated');
  tokens.pop();
  const rows = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    const similarity = /^([RC])([0-9]{1,3})$/.exec(status ?? '');
    const supported = /^[ACDMT]$/.test(status ?? '') ||
      (similarity !== null && Number(similarity[2]) <= 100);
    if (!supported) fail(`unsupported Git diff status ${JSON.stringify(status)}`);
    const oldPath = tokens[index++];
    if (!oldPath) fail('Git diff contains an empty or missing path');
    if (status.startsWith('R') || status.startsWith('C')) {
      const path = tokens[index++];
      if (!path) fail(`Git ${status} record is missing its destination path`);
      rows.push({ status, oldPath, path });
    } else {
      rows.push({ status, path: oldPath });
    }
  }
  return rows;
}

function touchesPath(row, path) {
  if (row.status.startsWith('C')) return row.path === path;
  return row.path === path || row.oldPath === path;
}

function touchesStable(row) {
  if (row.status.startsWith('C')) return row.path.startsWith(STABLE_PREFIX);
  return row.path.startsWith(STABLE_PREFIX) || row.oldPath?.startsWith(STABLE_PREFIX);
}

function touchesPromotionReceipt(row) {
  return row.path.startsWith(PROMOTIONS_PREFIX) || row.oldPath?.startsWith(PROMOTIONS_PREFIX);
}

function touchesPromotionEvidence(row) {
  return row.path.startsWith(STABLE_PROMOTION_EVIDENCE_PREFIX) || row.oldPath?.startsWith(STABLE_PROMOTION_EVIDENCE_PREFIX);
}

function validateReceiptRows(rows) {
  for (const row of rows) {
    if (row.status !== 'A' || row.oldPath || !/^docs-promotions\/v\d+\.\d+\.\d+\.json$/.test(row.path)) {
      fail(`promotion receipts are add-only and require Git status A: ${row.status} ${row.oldPath ? `${row.oldPath} -> ` : ''}${row.path}`);
    }
  }
}

function validateEvidenceRows(rows) {
  for (const row of rows) {
    if (row.status !== 'A' || row.oldPath || !/^release-evidence\/stable-promotions\/v\d+\.\d+\.\d+\/(?:manifest\.json|release-notes\.md)$/.test(row.path)) {
      fail(`Stable promotion evidence is add-only and closed-world: ${row.status} ${row.oldPath ? `${row.oldPath} -> ` : ''}${row.path}`);
    }
  }
}

function stableTagFromReceiptPath(path) {
  return path.slice(PROMOTIONS_PREFIX.length, -'.json'.length);
}

function expectedEvidencePaths(stableTag) {
  const prefix = `${STABLE_PROMOTION_EVIDENCE_PREFIX}${stableTag}/`;
  return [`${prefix}manifest.json`, `${prefix}release-notes.md`];
}

export function selectKitDocsCiMode(rows, { manifestPath = DEFAULT_MANIFEST_PATH } = {}) {
  const manifestRows = rows.filter((row) => touchesPath(row, manifestPath));
  if (manifestRows.some((row) => row.status === 'D' || (row.status.startsWith('R') && row.oldPath === manifestPath))) {
    fail(`reconciliation manifest was deleted or renamed away: ${manifestPath}`);
  }
  if (manifestRows.some((row) => !['A', 'M'].includes(row.status) || row.path !== manifestPath)) {
    fail(`reconciliation manifest has an unsupported change: ${manifestRows.map((row) => `${row.status} ${row.oldPath ? `${row.oldPath} -> ` : ''}${row.path}`).join(', ')}`);
  }

  const receiptRows = rows.filter(touchesPromotionReceipt);
  const evidenceRows = rows.filter(touchesPromotionEvidence);
  validateReceiptRows(receiptRows);
  validateEvidenceRows(evidenceRows);

  const stableChanged = rows.some(touchesStable);
  if (!stableChanged) {
    if (receiptRows.length || evidenceRows.length) fail('promotion receipt/evidence changed without a Stable diff');
    return { mode: 'history', reason: 'no Stable diff' };
  }

  if (manifestRows.length) {
    if (receiptRows.length || evidenceRows.length) fail('reconciliation and promotion transaction changes cannot share a Stable diff');
    return { mode: 'diff', reason: 'Stable diff with reconciliation manifest change' };
  }

  if (receiptRows.length !== 1 || evidenceRows.length !== 2) {
    fail('Stable changed without reconciliation evidence or exactly one added receipt plus two added promotion evidence files');
  }
  const stableTag = stableTagFromReceiptPath(receiptRows[0].path);
  const actualEvidencePaths = evidenceRows.map((row) => row.path).sort();
  if (JSON.stringify(actualEvidencePaths) !== JSON.stringify(expectedEvidencePaths(stableTag).sort())) {
    fail('promotion receipt and evidence files must belong to the same Stable version directory');
  }
  return {
    mode: 'promotion',
    reason: 'Stable diff with deterministic promotion receipt and source evidence',
    receiptPath: receiptRows[0].path,
  };
}

function defaultRunValidation({ root, mode, base, receiptPath }) {
  const promotion = mode === 'promotion';
  const script = fileURLToPath(new URL(promotion ? './check-stable-promotion.mjs' : './reconcile-kit-docs.mjs', import.meta.url));
  const args = promotion
    ? [script, base, receiptPath]
    : mode === 'diff'
      ? [script, '--check-diff', base]
      : [script, '--check-history'];
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  const label = promotion ? 'promotion' : 'reconciliation';
  if (result.error) fail(`cannot run ${label} validator: ${result.error.message}`);
  if (result.signal) fail(`${label} validator terminated by ${result.signal}`);
  if (result.status !== 0) fail(`${label} validator failed with exit ${result.status}`);
}

export async function checkKitDocsCi({
  root = repoRoot,
  base,
  manifestPath = DEFAULT_MANIFEST_PATH,
  runValidation = defaultRunValidation,
} = {}) {
  if (typeof base !== 'string' || !base) fail('a Git base revision is required');
  const resolvedBase = git(root, ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).toString('utf8').trim();
  if (!/^[a-f0-9]{40}$/.test(resolvedBase)) fail(`invalid Git base revision ${base}`);
  const rows = parseNameStatus(git(root, ['diff', '--name-status', '-z', '--find-renames', '--find-copies-harder', resolvedBase, 'HEAD', '--']));
  const route = selectKitDocsCiMode(rows, { manifestPath });
  console.log(`Kit docs CI route: ${route.mode} (${route.reason}); base=${resolvedBase}`);
  await runValidation({ root: resolve(root), mode: route.mode, base: resolvedBase, rows, receiptPath: route.receiptPath });
  return { ...route, base: resolvedBase, rows };
}

export async function run(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || !argv[0]) throw new Error('usage: node scripts/check-kit-docs-ci.mjs <base>');
  return checkKitDocsCi({ base: argv[0] });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
