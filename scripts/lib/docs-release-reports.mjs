import { basename, join } from 'node:path';
import { createApprovalRequest } from './docs-release-approval.mjs';
import { stableJson } from './docs-release-normalize.mjs';
import { assertNoSymlinkPath, atomicWrite, releaseOutputDir } from './docs-release-paths.mjs';

function code(value) {
  return `\`${String(value).replace(/`/g, '\\`')}\``;
}

function tableCell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function provenanceTable(ledger) {
  return [
    '| Side | Ref | Commit | Version | Provenance | Digest |',
    '| --- | --- | --- | --- | --- | --- |',
    ...['from', 'to'].map((side) => {
      const source = ledger[side];
      return `| ${side} | ${code(source.ref)} | ${code(source.resolvedCommit)} | ${code(source.version)} | ${source.provenanceType} | ${code(source.provenanceDigest)} |`;
    }),
  ].join('\n');
}

export function renderSourceLedger(ledger) {
  const rows = ledger.claims.map((claim) =>
    `| ${code(claim.id)} | ${tableCell(claim.kind)} | ${code(claim.entityId)} | ${claim.classification} | ${claim.confidence} | ${claim.anchors.length} |`,
  );
  return `# Source ledger\n\nSchema: ${code(ledger.schemaVersion)}\n\nStatus: **${ledger.status}**\n\n${provenanceTable(ledger)}\n\n## Claims\n\n| Claim | Kind | Entity | Classification | Confidence | Anchors |\n| --- | --- | --- | --- | --- | ---: |\n${rows.join('\n')}\n`;
}

export function renderDelta(ledger) {
  const changed = ledger.claims.filter((claim) => claim.classification !== 'no-change');
  const body = changed.length
    ? changed.map((claim) => `- ${code(claim.id)} — **${claim.classification}** ${code(`${claim.kind}:${claim.entityId}`)}`).join('\n')
    : '- No source changes. This V0 run is an explicit no-op.';
  return `# Delta from ${ledger.from.version}\n\nCompared immutable ${code(ledger.from.ref)} to ${code(ledger.to.ref)}.\n\n${body}\n`;
}

export function renderImpactMap(map) {
  const rows = map.pages.map((page) =>
    `| ${page.path ? code(page.path) : '—'} | ${tableCell(page.family)} | ${page.classification} | ${page.claimIds.map(code).join(', ')} |`,
  );
  const table = rows.length ? rows.join('\n') : '| — | — | no-change | — |';
  return `# Docs impact map\n\nSchema: ${code(map.schemaVersion)}\n\nStatus: **${map.status}**\n\n| Path | Family | Classification | Claims |\n| --- | --- | --- | --- |\n${table}\n`;
}

export function renderUnresolved(ledger, map) {
  const claims = ledger.claims.filter((claim) => claim.classification === 'blocked');
  const pages = map.pages.filter((page) => page.classification === 'blocked');
  if (!claims.length && !pages.length) return '# Unresolved evidence\n\nNone.\n';
  const lines = [
    '# Unresolved evidence',
    '',
    ...claims.map((claim) => `- ${code(claim.id)}: ${claim.blockedReasons.map(tableCell).join('; ')}`),
    ...pages.map((page) => `- ${page.path ? code(page.path) : code(page.family)}: ${page.reasons.map(tableCell).join('; ')}`),
  ];
  return `${lines.join('\n')}\n`;
}

function safeVersion(version) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(version)) throw new Error(`unsafe version for delta filename: ${JSON.stringify(version)}`);
  return version;
}

export async function writeV0Reports({ ledger, impactMap, outputRoot, target }) {
  const outputDir = releaseOutputDir(outputRoot, target);
  await assertNoSymlinkPath(outputRoot, outputDir);
  const request = createApprovalRequest({ ledger, impactMap, target });
  const files = new Map([
    ['source-ledger.json', stableJson(ledger)],
    ['source-ledger.md', renderSourceLedger(ledger)],
    [`delta-from-${safeVersion(ledger.from.version)}.md`, renderDelta(ledger)],
    ['docs-impact-map.json', stableJson(impactMap)],
    ['docs-impact-map.md', renderImpactMap(impactMap)],
    ['unresolved-evidence.md', renderUnresolved(ledger, impactMap)],
    ['approval-request.json', stableJson(request)],
  ]);
  for (const [name, contents] of files) {
    const path = join(outputDir, basename(name));
    await atomicWrite(path, contents);
  }
  return { outputDir, files: [...files.keys()], request };
}
