// docs-bundle manifest contract (v1). This is the single source of truth for
// parsing/validating the manifest that ak-cli's release job ships inside
// `docs-bundle.tar.gz`. All contract knowledge lives here so a future contract
// change (Phase 6 negotiation) touches exactly one module + the fixtures.

export const SCHEMA_VERSION = 1;

export const CHANNELS = ['beta', 'stable'];

// Tag shapes: beta releases are `vX.Y.Z-beta.N`, stable are `vX.Y.Z`.
const BETA_TAG = /^v\d+\.\d+\.\d+-beta\.\d+$/;
const STABLE_TAG = /^v\d+\.\d+\.\d+$/;

export function isValidTag(tag, channel) {
  if (typeof tag !== 'string') return false;
  return channel === 'beta' ? BETA_TAG.test(tag) : STABLE_TAG.test(tag);
}

export class ManifestError extends Error {}

/**
 * Parse raw JSON text into a validated manifest object.
 * @param {string} raw   JSON text of manifest.json
 * @param {{expectedChannel?: 'beta'|'stable'}} [opts]
 * @returns validated manifest
 * @throws {ManifestError} on any contract violation (fail loud, never guess)
 */
export function parseManifest(raw, opts = {}) {
  let m;
  try {
    m = JSON.parse(raw);
  } catch (err) {
    throw new ManifestError(`manifest.json is not valid JSON: ${err.message}`);
  }
  return validateManifest(m, opts);
}

export function validateManifest(m, opts = {}) {
  const { expectedChannel } = opts;

  if (m == null || typeof m !== 'object') {
    throw new ManifestError('manifest must be a JSON object');
  }
  if (m.schemaVersion !== SCHEMA_VERSION) {
    throw new ManifestError(
      `unsupported schemaVersion ${JSON.stringify(m.schemaVersion)} (expected ${SCHEMA_VERSION})`,
    );
  }
  if (!CHANNELS.includes(m.channel)) {
    throw new ManifestError(
      `channel must be one of ${CHANNELS.join(' | ')}, got ${JSON.stringify(m.channel)}`,
    );
  }
  if (expectedChannel && m.channel !== expectedChannel) {
    throw new ManifestError(
      `channel mismatch: manifest says ${m.channel}, this operation expects ${expectedChannel}`,
    );
  }
  if (!isValidTag(m.tag, m.channel)) {
    throw new ManifestError(
      `tag ${JSON.stringify(m.tag)} is not a valid ${m.channel} tag`,
    );
  }
  if (typeof m.sha !== 'string' || m.sha.length < 7) {
    throw new ManifestError(`sha must be a commit SHA string, got ${JSON.stringify(m.sha)}`);
  }
  if (typeof m.version !== 'string' || m.version.length === 0) {
    throw new ManifestError(`version must be a non-empty string, got ${JSON.stringify(m.version)}`);
  }
  // generatedAt is stamped by ak-cli at build time. Sync reuses it verbatim (never
  // a fresh clock read) so re-dispatching the same tag reproduces byte-identical
  // output — the idempotence guarantee.
  if (typeof m.generatedAt !== 'string' || m.generatedAt.length === 0) {
    throw new ManifestError(`generatedAt must be a non-empty ISO timestamp string, got ${JSON.stringify(m.generatedAt)}`);
  }
  if (m.channel === 'stable') {
    if (!isValidTag(m.promotedFrom, 'beta')) {
      throw new ManifestError(
        `stable manifest must carry promotedFrom as a valid beta tag, got ${JSON.stringify(m.promotedFrom)}`,
      );
    }
  }
  return m;
}
