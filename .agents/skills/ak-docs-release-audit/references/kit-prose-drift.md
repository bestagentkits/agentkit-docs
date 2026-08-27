# Kit prose drift

Bundle contract v1 does not carry Kit inventory or
`content/docs/<channel>/kits/**`. V0 therefore needs a separate artifact and
docs-closure pass. Frontmatter-only detection catches identity changes such as
`user-invocable`, `disable-model-invocation`, `name`, and `keywords`, but misses
body and support-file drift.

Real example: `v2.12.1-beta.6` moved `ak-ai-multimodal` from
`@mrgoonie/multix@0.2.0` to `@latest`. Frontmatter was unchanged, while
`SKILL.md`, `.env.example`, and `skill.yaml` changed. The identity-only detector
reported no-op, leaving the retired pin on Kit pages and cross-referencing
pages.

## Artifact matrix

Build this matrix before interpreting tag, version, or source-commit deltas.

1. Resolve the exact release bound to the resulting `channels.stable` and
   `channels.beta` states. This current-channel comparison is mandatory before
   `dev` → `main`, even when Beta is newer. For a Stable promotion, also verify
   the target Stable release against the exact Beta release named by
   `promotedFrom`; do not substitute an arbitrary Beta snapshot.
2. Derive the authoritative expected `kitId` set from the immutable release
   provenance or signed asset cohort. Expand it across `claude-code`, `codex`,
   `cursor`, `grok`, `omp`, and `pi`; record every expected `(kitId, runtime)`
   key. If no independent evidence binds the expected set, block.
3. For every expected key, require exactly one manifest, archive, and `.sha256`
   sidecar. Verify the manifest and sidecar file bytes against their own
   release-page digests. Verify manifest channel, version/release binding,
   runtime, Kit ID, and archive metadata, then require the archive SHA-256 to
   agree across downloaded bytes, manifest, sidecar, and release-page digest.
   Missing, duplicate, extra-unbound, or mismatched evidence blocks the pass.
4. Compare complete matrices by exact key inventory and archive SHA-256. Ignore
   differing tag, version, timestamp, URL, signature, and source-commit metadata
   until payload equivalence is decided.

Compute `manifestSetDigest` as SHA-256 over the UTF-8 bytes of canonical JSON
for the array of `{channel, kitId, runtime, manifest}` rows projected from the
triad rows and tuple-sorted by `(channel, kitId, runtime)`. Compute
`matrixDigest` as SHA-256 over the UTF-8 bytes of canonical JSON for the complete
`{channel, kitId, runtime, archive, manifest, sidecar}` triad rows, sorted by the
same tuple. Canonical JSON has no insignificant whitespace or trailing newline;
these are not newline-delimited row hashes. Record exact expected and observed
per-channel inventories with both digests. Do not summarize a partial matrix as
"unchanged."

| Matrix result | Required route |
| --- | --- |
| Either channel incomplete or invalid | Block; repair evidence first. |
| Complete inventories or archive hashes differ | Run the normal release audit below. |
| Complete matrices are identical and Kit-doc closures are identical | Kit parity passes. |
| Complete matrices are identical but Kit-doc closures differ | Block `dev` → `main`; use deterministic Kit-closure reconciliation only. |

## Kit-doc closure

For a channel, the Kit-doc closure is:

- the exact channel-relative path and byte-hash inventory under
  `content/docs/<channel>/kits/**`, including EN/VI pages, indexes, navigation,
  workflows, overview counts, and lifecycle pages;
- any channel-specific catalog projection used to validate that tree; and
- a deterministic ledger of Kit-artifact-derived claims outside `kits/**`.
  Every ledger row is an exact object with these fields and no others:
  `ledgerSchemaVersion`, `claimId`, `rationale`, `pairId`, `locale`,
  `sourcePath`, `targetPath`, `normalizedPath`, `byteSpan`, `evidenceAnchor`,
  `oldFragment`, `newFragment`, `occurrence`, `sourceSha256`,
  `wholeFilePreimageSha256`, and `wholeFilePostimageSha256`.
  `ledgerSchemaVersion` is the integer `1`. `normalizedPath` is `targetPath`
  with the exact `content/docs/stable/` prefix removed. `byteSpan` is the exact
  `{start,end}` range of `oldFragment` in the raw whole-file preimage: offsets
  are zero-based UTF-8 byte offsets, `start` is inclusive, and `end` is
  exclusive. Preserve BOMs, line endings, Unicode normalization, and all claim
  bytes; do not compute spans from JavaScript string indexes or normalized
  prose. The preimage bytes in `[start,end)` must decode to `oldFragment`.
  `evidenceAnchor` is exactly `matrix-sha256:<matrixDigest>` for the selected,
  verified catalog matrix embedded in or live-selected for that ledger.

Build the external claim ledger by scanning every human-owned channel MDX page,
not only pages whose filenames mention Kits. Include installation, quickstart,
onboarding, Kit guides, runtime concepts, troubleshooting, and human-owned CLI
prose. Search for public Skill names and aliases, invocation forms, counts,
runtime availability, install locations, required packages and versions,
configuration keys, lifecycle behavior, and retired tokens or phrases found in
the archive comparison.

Sort Kit-tree rows by normalized path. Sort external ledger rows canonically by
`normalizedPath`, `locale`, numeric `byteSpan.start`, `evidenceAnchor`, then
`claimId`, in that precedence, using ascending ordinal/code-unit comparison for
string keys. No unlisted tie-breaker is permitted. `externalClaimsDigest` is
SHA-256 over the UTF-8 canonical JSON of that complete array in exactly this
order; validators must reject a differently ordered array rather than sorting
only for hashing. Preserve claim bytes without prose normalization. Record
separate SHA-256 digests for the Kit tree and external ledger. Compute
`closureDigest = sha256(UTF8(canonical-json({postimageInventoryDigest, externalClaimsDigest})))`,
where canonical JSON has no insignificant whitespace or trailing newline.
`manifestDigest` remains a separate digest of the reconciliation manifest.
Exact closure equality means equal inventories and all three closure digests. Do
not require whole-file equality for an external page that also carries unrelated
CLI or release claims; compare the bound Kit claim spans. A shared catalog file
that represents only one channel is not evidence for the other channel; require
per-channel projections or report a support gap.

## Normal artifact-delta detection

Run this whenever complete matrices differ, in addition to identity comparison:

1. Within the target channel, diff every changed
   `agentkit-kit-<kit>-<runtime>-<from-tag>.tar.gz` against its `to` counterpart.
   Classify every added, removed, or changed member, including top-level
   manifests, Skills, Agents, Hooks, scripts, templates, and runtime files.
2. For each Skill, compare complete `SKILL.md` frontmatter and body. Hash every
   support file; always call out `skill.yaml`, `.env.example`, scripts,
   templates, and runtime configuration separately. A support-file-only change
   is not a no-op.
3. Extract per-file evidence fingerprints from both sides:
   - backtick-fenced tokens such as `ak config` or `journal.auto`;
   - version pins such as `@scope/pkg@1.2.3` or `pkg==1.2.3`;
   - distinctive prose phrases of at least five words; and
   - public identities, aliases, invocation forms, config keys, and runtime
     support statements.
4. Use the symmetric difference to scan the complete target-channel closure.
   A page is a stale candidate when it retains a `from`-only form or omits a
   required public identity. Report each matching path and locale; there is no
   aggregate threshold.
5. Route exact existing Beta candidates through owner-directed scope. Record
   `kit-prose-drift: no candidates` only after inventory, body/support-file, and
   cross-page scans all ran.

## Owner prompt

```text
Kit prose drift candidates from <from-ref> → <to-ref>:

  ak-ai-multimodal (engineer + marketing):
    - kits/engineer/skills/ai-multimodal.{en,vi}.mdx — retired pin
    - kits/marketing/skills/ai-multimodal.{en,vi}.mdx — retired pin
    - guides/installing-kits.{en,vi}.mdx — cross-page claim

Compile refresh under owner-directed scope?

Reply:
  approve REQ-<id> paths <list>   — refresh subset
  approve REQ-<id> all            — refresh every candidate
  skip                            — defer to a follow-up PR
```

Append the owner reply to the V0 approval request alongside any CLI prose
approval.

## Authoring and reconciliation

For a normal artifact delta:

- author Beta only through approved V1 scope;
- preserve EN/VI meaning and exact technical tokens;
- do not invent claims beyond the new archive evidence; and
- make token-scoped replacements and small phrase rewrites, not unrelated
  full-page rewrites.

When complete Stable and Beta matrices are identical, Stable cannot retain a
different Kit-doc closure. This is not authority for ordinary Stable hand
editing, the Stable docs exception, or whole-copying Beta when unrelated CLI or
release evidence differs. Use only a deterministic reconciliation operation
that binds:

- both channel release refs and manifest-set digests;
- both verified matrix inventories and digests;
- the exact Beta source commit and source blob hashes;
- the Stable destination commit and preimage blob hashes;
- an exact allowlist of closure paths or claim spans;
- every resulting path and blob hash; and
- proof that no non-allowlisted path changed and exact closure equality holds.

The Beta source closure must first pass artifact-to-doc evidence review; byte
equality alone cannot authorize copying stale Beta prose. The reconciliation
tool validates only the finite external-claim ledger supplied by this audit; it
does not discover arbitrary cross-page claims. The audit must finish the full
human-owned MDX scan and bind every actionable claim before reconciliation. If
no tool can produce and verify the reconciliation record, keep `dev` → `main`
blocked. Governance approval does not authorize manual reconstruction.

## Validation and handoff

Run `git diff --check` plus catalog, reference, route-shape, link, and build
checks as risk requires. Recompute both closure inventories after any
reconciliation and require exact equality.

Report Beta and Stable separately: bound tag/SHA, exact expected/observed
artifact inventory, sidecar/hash result, manifest-set and matrix digests,
Kit-tree and external-ledger digests, closure result, body/support-file scan,
external claim scan, blockers, and reconciliation status. Report both pairwise
checks separately: target Stable ↔ exact `promotedFrom`, then resulting Stable ↔
current/resulting Beta. Include the completed normal-audit record when artifacts
differ, followed by the explicit `dev` → `main` decision.
