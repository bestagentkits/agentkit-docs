---
name: ak-docs-release-audit
description: Audit an AgentKit release delta, verify Beta/Stable Kit evidence, map evidence-backed claims to affected documentation, and author only explicitly approved Beta prose. Read-only V0 evidence phase plus owner-approved V1 authoring phase; deterministic sync, promote, and Kit-closure reconciliation run outside this skill. Use for release docs syncs, exact tag or SHA comparisons, stale-guide audits, release coverage gaps, or preparing an owner-reviewed Beta documentation update; do not use for Stable hand authoring or generated CLI reference edits.
user-invocable: true
when_to_use: "Invoke for release docs syncs, exact tag or SHA comparisons, Stable/Beta Kit evidence checks, stale-guide audits, release coverage gaps, or preparing an owner-reviewed Beta documentation update. Do not use for Stable hand authoring or generated CLI reference edits."
category: utilities
keywords: [docs, release, audit, evidence, beta]
---

# AgentKit Docs Release Audit

Maintain release-sensitive documentation through a read-only evidence phase and
an owner-approved authoring phase. Keep release workflow automation deferred;
this Skill is manually invoked.

## Select the mode

- Use **V0 release delta** when comparing two immutable AgentKit releases.
- Use **coverage-gap** when a current product behavior or issue is missing from
  docs without representing a release delta.
- Use **V1 authoring** only after the owner supplies the exact statement
  `approve <request-id>` for the generated request.

Read [evidence-contract.md](references/evidence-contract.md) before V0 or
coverage-gap work. Read
[release-diff-routing.md](references/release-diff-routing.md) and
[impact-map-contract.md](references/impact-map-contract.md) when classifying
impact. Before V1, read
[authoring-guardrails.md](references/authoring-guardrails.md) and
[validation-and-handoff.md](references/validation-and-handoff.md). Read
[kit-prose-drift.md](references/kit-prose-drift.md) before every Kit pass,
including Stable promotion verification.

## Docs-bundle contract v1 blind spots

The bundle carries only `manifest.json`, `reference/cli/**`, and
`release-notes.md`. V0 audits what the bundle carries; three surfaces drift
outside its evidence and need matched manual passes on the same Beta PR:

- **Human-owned CLI prose** under `content/docs/beta/reference/cli/**/*.mdx`.
  Bundle-derived source items have empty `docs` mappings, so V0's
  impact-map returns `paths: []` under `blocked` classification even when
  `cli:*` `update` claims are surfaced. Route under owner-directed scope:
  present the surfaced claims with proposed nested prose paths, wait for
  `approve REQ-…`, then V1 authoring refreshes those paths (EN + VI
  parity, technical tokens unchanged).
- **Kit catalog and public skill pages.** The bundle does not carry Kit
  inventory. Verify release assets for all six runtimes, then compare archive
  hashes before interpreting tag, version, or source-commit differences. For a
  normal artifact delta, compare per-skill identity and every changed
  `SKILL.md` body or support file as defined in
  [`references/kit-prose-drift.md`](references/kit-prose-drift.md). Refresh
  `kit-catalog-identities.json`, public skill pages EN+VI,
  `skills/meta.{json,vi.json}`, skill indexes, and Kit overview counts in Beta
  only. `disable-model-invocation: true` without `user-invocable: true` stays
  `internal` with no public page. For complete, hash-identical Stable/Beta
  artifact matrices, exact Kit-doc closure equality is a production invariant,
  not a tag-delta authoring decision; use the blocked reconciliation route
  below when it fails.
- **Desktop App section** under `content/docs/beta/desktop-app/**`.
  Bundle does not carry Desktop provenance. Detect by inspecting the
  release page's `ak-gui_*` assets and Desktop-tagged release-note
  lines. Refresh has three layers: **A.** artifact bump (filenames,
  bytes, SHA-256, download URLs); **B.** feature and behavior authoring
  from release-note evidence under owner approval; **C.** screenshots
  captured per `public/gui/README.md` from a running Desktop build.
  Layer C requires the binary and often defers.

## Stable/Beta Kit artifact-equivalence gate

Run this read-only gate before using tag differences to choose a Kit audit or
before approving `dev` → `main`:

1. For each channel's exact bound tag, record the complete sorted Kit artifact
   inventory keyed by `(kitId, runtime)` for `claude-code`, `codex`, `cursor`,
   `grok`, `omp`, and `pi`. Each key must have one manifest, archive, and
   `.sha256` sidecar.
2. Validate manifest channel/tag/runtime/Kit identity and verify the archive
   digest against the manifest, sidecar, and release-page digest. Missing,
   duplicate, unbound, or mismatched evidence blocks the gate.
3. Compare the verified key inventories and archive SHA-256 values. Do this
   before interpreting version, source-commit, or tag metadata.
4. If any key or archive hash differs, use the normal release audit and the
   identity, body/support-file, and cross-page claim scans.
5. If the complete matrices are identical, require exact channel-relative
   Kit-doc closure equality. A mismatch blocks `dev` → `main`; it is not
   authority for Stable V1 authoring, a Stable docs exception, or an ordinary
   whole-Beta promotion when unrelated CLI evidence differs.

The only recovery for the last case is deterministic Kit-closure reconciliation
bound to both manifest-set digests, verified matrix digests, the Beta source blob
hashes, Stable preimage blob hashes, an exact allowlist, and resulting blob
hashes. It must prove no unrelated path changed and end with exact closure
equality. The tool validates only the finite external-claim ledger produced by
the audit; it does not discover arbitrary cross-page claims. If the scan is
incomplete or tooling cannot produce that record, remain blocked. See
[kit-prose-drift.md](references/kit-prose-drift.md) for closure and scan rules.

Executable checks are `pnpm check:catalog` for exact channel inventory and
full-tree equality, `pnpm check:kit-docs` for the reviewed reconciliation
manifest, and `node scripts/reconcile-kit-docs.mjs --check-diff <base-sha>` for
the Stable diff allowlist. Evidence triads live under
`release-evidence/kit-catalog/`; reviewed manifests live under
`docs-reconciliations/`. Run `--apply` only after the manifest and preimages are
reviewed; a rerun resumes exact preimage targets and skips postimages.

### A clean V0 is not evidence of no impact

An empty V0 delta only says the docs bundle did not change. The bundle carries
no adapter code, so a release can reverse a documented compatibility boundary
while every `cli:*` claim reports `no-change` and every Kit archive diffs clean.
`v2.15.0-beta.1` did exactly that: 171 of 171 CLI claims `no-change`, all six
runtime Kit archives byte-identical, and yet
`fix(codex): support Windows directory junctions and symlinks for canonical hooks root`
falsified a refusal claim on nine EN pages plus their VI pairs.

So whenever V0 surfaces no actionable claim, run the **source compare-window
pass** before concluding anything:

1. Resolve the window with
   `gh api repos/<owner>/<repo>/compare/<from-sha>...<to-sha>`.
2. List every changed file that is not a test, a plan, or CI config.
3. Classify each remaining file against a docs surface. Adapter, runtime, and
   installer paths are the ones the bundle hides.
4. Record the classification even when the answer is "no prose impact", with the
   reason. `paths: []` needs that note; it is never self-justifying.

### Read the implementing hunk, not the commit subject

A subject states intent, not the shipped contract. In the same release
`feat(ux): auto-detect and auto-install missing Node.js` reads as unconditional,
but `runtime/noderunner/installer.go` gates auto-install behind explicit consent
(`AllowAutoInstall` or `AK_AUTO_INSTALL_NODE=1`), with a code comment recording
that non-interactive mode must never bypass that gate. Prose written from the
subject would have shipped a false claim.

Consent gates, opt-out switches, version floors, supported-platform lists, and
exit codes must each come from the implementing code or a test, never from the
release note alone.

Batch the manual passes into the same PR as the sync when the drift lands
on the same release. Full runbook and command examples:
[`docs/workflows/release-and-deploy.md`](../../../docs/workflows/release-and-deploy.md)
under "What Beta sync does *not* refresh".

## Run V0

1. Read the repository `README.md`, `AGENTS.md`, and `CLAUDE.md`.
2. For release or promotion work, complete the Stable/Beta Kit
   artifact-equivalence gate before interpreting tag deltas.
3. Resolve `from` and `to` to immutable tags and commits. Prefer an exact docs
   bundle; label a reproducible source checkout clearly when no bundle exists.
4. Ensure `plans/releases/` exists and is working-only.
5. Run `scripts/check-docs-release-update.mjs --mode v0` with explicit
   `--from-ref`, `--to-ref`, `--from-source`, `--to-source`, `--channel`,
   `--repo-root`, `--output-root`, and `--target`. When an actionable release
   claim has no source-supplied docs route but manual review identifies exact
   existing Beta prose, pass a JSON array through `--owner-paths`. The resulting
   request records those entries as `ownerDirectedPaths`; the impact map remains
   blocked so it never misrepresents owner routing as source evidence.
6. Review `source-ledger`, `docs-impact-map`, `unresolved-evidence`, and
   `approval-request` together. Re-run on identical inputs and require an
   equivalent result.
7. Stop without editing public docs. Present the request ID, exact claims,
   paths, unresolved evidence, and recommended decision to the owner.

For an existing-behavior gap, run the same checker with `--mode coverage-gap`
and explicit `--audit-source`, `--source-root`, `--repo-root`, `--output-root`,
and `--target`. Never disguise a coverage gap as a changed release claim.

## Record manual owner approval

Accept only the exact user statement `approve REQ-…` matching the generated
request. Create the local approval with
`scripts/docs-release-manual-approval.mjs --mode create`, binding the request,
ledger, impact map, current docs HEAD, validity window, and a new UUIDv4 nonce.
Use the user's own label; no separate CODEOWNER or approval PR is required for
this manual workflow. Do not widen claims or paths after approval.

## Run V1

1. Before authoring, validate a clean worktree with an empty change manifest.
2. Run `scripts/docs-release-manual-approval.mjs --mode v1` with the exact V0
   artifacts, local manual approval, docs base SHA, `dev` target, current time,
   and used-nonce ledger. The validator requires repository `HEAD` to equal the
   approved base and requires `--changes` to exactly match the tracked Git diff.
3. Modify only the existing, approved Beta prose or human-owned metadata paths.
4. Author EN and VI as a pair with equivalent meaning and unchanged technical
   tokens.
5. Regenerate the change manifest from the final Git diff and re-run V1. Stop on
   stale approval, replay, manifest mismatch, path expansion, missing evidence,
   or any generated/Stable change.

## Finish

Run the focused checks required by the changed page family, then the repository
catalog, reference, shape, link, and static-export checks as risk warrants.
Return a handoff listing immutable refs, request and approval IDs, claims
covered, paths changed, validation results, remaining blockers, and local
preview routes. Report Beta and Stable evidence and docs status separately,
then state their matrix/closure relation and the `dev` → `main` decision.
Ordinary Stable promotion stays a separate reviewed whole-copy action;
equal-artifact Kit-closure reconciliation is a separate deterministic blocked
recovery, never Stable hand authoring.

