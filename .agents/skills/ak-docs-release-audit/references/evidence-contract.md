# Evidence contract

## Source priority

Use exact release tags and commits, signed release metadata, docs-bundle
manifests, implementation, tests, Kit manifests, and generated inventories.
Treat release notes as routing input, not sole proof. Record missing or
conflicting evidence instead of inferring behavior.

## Required claim fields

Each publishable claim needs a stable claim ID, surface, old and new behavior,
immutable source anchors, test anchors where available, user impact, affected
page families, confidence, and non-publishable notes. Exact commands, flags,
fields, paths, compatibility, mutation, and recovery boundaries require a
source or test anchor.

## Provenance rules

- Bind a docs bundle to its manifest, tag, commit, channel, and digest.
- Bind checkout evidence to the resolved commit and normalized source identity.
- Keep extraction and ledger artifacts under `plans/releases/<target>/`; never
  publish their prose directly.
- Preserve request, ledger, impact-map, and optional manifest digests through
  approval and V1.
- Mark unsupported surfaces `blocked`; do not borrow evidence from another
  version or runtime.

The executable schema and path checks in `scripts/lib/docs-release-*.mjs` are
authoritative when this reference and code differ.

