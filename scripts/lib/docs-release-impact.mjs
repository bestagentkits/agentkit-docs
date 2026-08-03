import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { digest, compareText, sortedUnique } from './docs-release-normalize.mjs';
import { IMPACT_SCHEMA, validateImpactMap, validateLedger } from './docs-release-schema.mjs';
import { isHumanOwnedBetaFile, normalizeRepoPath, resolveWithin } from './docs-release-paths.mjs';

function pageClassification(entries) {
  const classes = new Set(entries.map((entry) => entry.classification));
  if (classes.has('blocked')) return 'blocked';
  if (classes.size === 1 && classes.has('no-change')) return 'no-change';
  if (entries.every((entry) => entry.role === 'mirror' || entry.classification === 'no-change')) return 'mirror';
  for (const action of ['remove', 'new', 'update']) if (classes.has(action)) return action;
  return 'no-change';
}

function routeReason(path, repoRoot) {
  try {
    normalizeRepoPath(path);
    resolveWithin(repoRoot, path);
  } catch (error) {
    return error.message;
  }
  if (!isHumanOwnedBetaFile(path)) return 'path is outside V1 human-owned Beta prose/metadata scope';
  if (!existsSync(resolve(repoRoot, path))) return 'path does not exist; V1 is modify-only';
  return null;
}

export function createImpactMap(ledgerInput, options) {
  const ledger = validateLedger(ledgerInput);
  const repoRoot = resolve(options.repoRoot);
  const grouped = new Map();
  const unrouted = [];
  for (const claim of ledger.claims) {
    if (claim.docs.length === 0) {
      if (claim.classification !== 'no-change') {
        unrouted.push({
          path: null,
          family: claim.kind,
          classification: 'blocked',
          proposedClassification: claim.classification,
          claimIds: [claim.id],
          reasons: ['no exact docs path supplied by source evidence'],
        });
      }
      continue;
    }
    for (const doc of claim.docs) {
      const entries = grouped.get(doc.path) ?? [];
      entries.push({
        claimId: claim.id,
        classification: claim.classification,
        role: doc.role,
        blockedReasons: claim.blockedReasons,
      });
      grouped.set(doc.path, entries);
    }
  }
  const pages = [];
  for (const [path, entries] of [...grouped.entries()].sort(([a], [b]) => compareText(a, b))) {
    const proposedClassification = pageClassification(entries);
    const reason = proposedClassification === 'no-change' ? null : routeReason(path, repoRoot);
    const claimReasons = entries.flatMap((entry) => entry.blockedReasons);
    const blocked = reason || claimReasons.length;
    pages.push({
      path,
      family: path.split('/').slice(3, 5).join('/'),
      classification: blocked ? 'blocked' : proposedClassification,
      ...(blocked ? { proposedClassification } : {}),
      claimIds: sortedUnique(entries.map((entry) => entry.claimId)),
      reasons: sortedUnique([...(reason ? [reason] : []), ...claimReasons]),
    });
  }
  pages.push(...unrouted);
  pages.sort((a, b) => compareText(a.path ?? `~${a.family}`, b.path ?? `~${b.family}`));
  const actionable = pages.some((page) => !['no-change', 'blocked'].includes(page.classification));
  const blocked = pages.some((page) => page.classification === 'blocked');
  return validateImpactMap({
    schemaVersion: IMPACT_SCHEMA,
    channel: ledger.channel,
    generatedAt: ledger.generatedAt,
    ledgerDigest: digest(ledger),
    status: actionable ? 'changed' : (blocked ? 'blocked' : 'no-op'),
    pages,
  });
}
