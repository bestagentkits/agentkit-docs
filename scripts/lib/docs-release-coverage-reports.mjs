import { join } from 'node:path';
import { stableJson } from './docs-release-normalize.mjs';
import { assertNoSymlinkPath, atomicWrite, releaseOutputDir } from './docs-release-paths.mjs';

function code(value) {
  return `\`${String(value).replace(/`/g, '\\`')}\``;
}

function renderLedger(ledger) {
  const rows = ledger.claims.map((claim) =>
    `| ${code(claim.id)} | ${code(claim.sourceId)} | ${claim.coverageStatus} | ${claim.classification} | ${claim.confidence} |`,
  );
  return `# Coverage-gap source ledger\n\nSchema: ${code(ledger.schemaVersion)}\n\nAudit: ${code(`${ledger.audit.kind}/v${ledger.audit.version}`)}\n\nStatus: **${ledger.status}**\n\nSource: ${code(`${ledger.source.repository}@${ledger.source.tag}`)} (${code(ledger.source.sha)})\n\nDocs base: ${code(`${ledger.docs.repository}@${ledger.docs.baseSha}`)}\n\nIssue: ${code(`${ledger.issue.repository}#${ledger.issue.number}`)}\n\n| Claim | Source claim | Coverage | Classification | Confidence |\n| --- | --- | --- | --- | --- |\n${rows.join('\n')}\n`;
}

function renderImpact(map) {
  const rows = map.pages.map((page) =>
    `| ${code(page.path)} | ${page.assertions.join(', ')} | ${page.classification} | ${code(page.routeDigest)} |`,
  );
  return `# Coverage-gap impact map\n\nSchema: ${code(map.schemaVersion)}\n\nStatus: **${map.status}**\n\n| Existing route | Assertions | Classification | Base digest |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n`;
}

function renderUnresolved(ledger) {
  const blocked = ledger.claims.filter((claim) => claim.classification === 'blocked');
  if (!blocked.length) return '# Coverage-gap unresolved evidence\n\nNone.\n';
  return `# Coverage-gap unresolved evidence\n\n${blocked.map((claim) => `- ${code(claim.id)}: ${claim.blockedReasons.join('; ')}`).join('\n')}\n`;
}

export async function writeCoverageGapReports({ ledger, impactMap, request, outputRoot, target }) {
  const outputDir = releaseOutputDir(outputRoot, target);
  await assertNoSymlinkPath(outputRoot, outputDir);
  const files = new Map([
    ['coverage-source-ledger.json', stableJson(ledger)],
    ['coverage-source-ledger.md', renderLedger(ledger)],
    ['coverage-impact-map.json', stableJson(impactMap)],
    ['coverage-impact-map.md', renderImpact(impactMap)],
    ['coverage-unresolved-evidence.md', renderUnresolved(ledger)],
    ['coverage-approval-request.json', stableJson(request)],
  ]);
  for (const [name, contents] of files) await atomicWrite(join(outputDir, name), contents);
  return { outputDir, files: [...files.keys()], request };
}
