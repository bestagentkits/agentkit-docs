---
name: ak-docs-release-audit
description: Audit an AgentKit release delta, map evidence-backed claims to affected documentation, and author only explicitly approved Beta prose. Read-only V0 evidence phase plus owner-approved V1 authoring phase; the deterministic sync/promote scripts and the docs release orchestrator run outside this skill. Use for release docs syncs, exact tag or SHA comparisons, stale-guide audits, release coverage gaps, or preparing an owner-reviewed Beta documentation update; do not use for Stable hand edits or generated CLI reference edits.
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
[validation-and-handoff.md](references/validation-and-handoff.md).

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
- **Kit catalog and public skill pages.** Bundle does not carry kit
  inventory. Detect by downloading
  `agentkit-kit-<kit>-<runtime>-<tag>.tar.gz` and comparing per-skill
  `SKILL.md` frontmatter (`user-invocable`, `disable-model-invocation`).
  Refresh `kit-catalog-identities.json`, add public skill pages EN+VI,
  update `skills/meta.{json,vi.json}` and skill index tables, bump the
  Kit overview `| Skills | N |` count. Mirror into
  `content/docs/stable/**` so the tree stays whole-copy-ready for the
  next promotion. `disable-model-invocation: true` without
  `user-invocable: true` stays `internal` (no public page).
- **Desktop App section** under `content/docs/beta/desktop-app/**`.
  Bundle does not carry Desktop provenance. Detect by inspecting the
  release page's `ak-gui_*` assets and Desktop-tagged release-note
  lines. Refresh has three layers: **A.** artifact bump (filenames,
  bytes, SHA-256, download URLs); **B.** feature and behavior authoring
  from release-note evidence under owner approval; **C.** screenshots
  captured per `public/gui/README.md` from a running Desktop build.
  Layer C requires the binary and often defers.

Batch the manual passes into the same PR as the sync when the drift lands
on the same release. Full runbook and command examples:
[`docs/workflows/release-and-deploy.md`](../../../docs/workflows/release-and-deploy.md)
under "What Beta sync does *not* refresh".

## Run V0

1. Read the repository `README.md`, `AGENTS.md`, and `CLAUDE.md`.
2. Resolve `from` and `to` to immutable tags and commits. Prefer an exact docs
   bundle; label a reproducible source checkout clearly when no bundle exists.
3. Ensure `plans/releases/` exists and is working-only.
4. Run `scripts/check-docs-release-update.mjs --mode v0` with explicit
   `--from-ref`, `--to-ref`, `--from-source`, `--to-source`, `--channel`,
   `--repo-root`, `--output-root`, and `--target`.
5. Review `source-ledger`, `docs-impact-map`, `unresolved-evidence`, and
   `approval-request` together. Re-run on identical inputs and require an
   equivalent result.
6. Stop without editing public docs. Present the request ID, exact claims,
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

1. Generate a change manifest from the proposed diff.
2. Validate it with `scripts/docs-release-manual-approval.mjs --mode v1`, the
   exact V0 artifacts, local manual approval, docs base SHA, `dev` target,
   current time, and used-nonce ledger.
3. Modify only the existing, approved Beta prose or human-owned metadata paths.
4. Author EN and VI with equivalent meaning and unchanged technical tokens.
5. Re-run V1 validation after the final diff. Stop on stale approval, replay,
   path expansion, missing evidence, or any generated/Stable change.

## Finish

Run the focused checks required by the changed page family, then the repository
catalog, reference, shape, link, and static-export checks as risk warrants.
Return a handoff listing immutable refs, request and approval IDs, claims
covered, paths changed, validation results, remaining blockers, and local
preview routes. Stable promotion stays a separate reviewed whole-copy action.

