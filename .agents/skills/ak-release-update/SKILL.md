---
name: ak:release-update
description: "Orchestrate an AgentKit docs release update end-to-end — resolve evidence, detect audit gaps, delegate audit + V1 authoring to ak-docs-release-audit, run deterministic sync and promote scripts, validate, and open the PR. Use for beta sync PRs, stable promotion PRs, and multi-hop catch-up runs against an audit trail."
user-invocable: true
when_to_use: "Invoke when publishing a docs update for a new upstream beta or stable release, catching up prose that drifted across a stretch of releases without audit passes, or preparing a stable promote after a beta sync PR lands."
category: utilities
keywords: [release, sync, promote, audit, evidence, orchestrator, beta, stable, catchup]
argument-hint: "--tag <tag> | --beta <tag> --stable <tag> [--from <ref>] [--catchup] [--no-audit-check]"
metadata:
  author: agentkit
  version: "1.0.0"
---

# AgentKit Docs Release Update Orchestrator

Composition skill for the end-to-end release update pipeline. Delegates
authoritative audit and authoring to
[`ak-docs-release-audit`](../ak-docs-release-audit/SKILL.md); orchestrates the
deterministic steps around it (bundle download, drift detection, script
invocation, validation, PR opening).

Do not replace the audit skill. Do not bypass its owner-approval gate. This
orchestrator provides a consistent pipeline shell around it.

## When to invoke

- Publishing a docs update for a new upstream beta or stable release.
- Catching up prose that drifted across a stretch of releases without audit
  passes.
- Preparing a stable promote after a beta sync PR lands.

## Argument shape

```text
/ak:release-update --tag <exact-tag> [--from <ref>] [--catchup] [--no-audit-check]
/ak:release-update --beta <beta-tag> --stable <stable-tag>
```

| Flag | Meaning |
| --- | --- |
| `--tag <tag>` | Single release. Channel is inferred: `-beta.N` suffix ⇒ beta, otherwise stable. |
| `--beta <tag>` | Explicit beta tag. Pairs with `--stable` for a two-PR sequence. |
| `--stable <tag>` | Explicit stable tag. Runs after the beta PR merges. |
| `--from <ref>` | Override the audit `from-ref`. Skips auto-detection. |
| `--catchup` | Force multi-hop audit with `from` = source of current `channels.stable.tag` (i.e., its `promotedFrom`). |
| `--no-audit-check` | Skip audit-gap detection and default single-hop. Logs a warning in the PR body. |

See [`references/syntax.md`](references/syntax.md) for the full flag surface,
examples, and error paths.

## Pipeline (seven steps)

1. **Resolve evidence.** Read the current `channels.json`, resolve the `to`
   tag via `gh api releases/tags/<tag>`, download the docs bundle and matching
   kit bundles, and verify every SHA-256 against the release-page asset
   digest and the `.sha256` sidecar.
2. **Detect the audit gap.** Read `git tag audit/*`; compare
   `channels.beta.tag` against the audit trail; propose the correct
   `from-ref`. See
   [`references/detection.md`](references/detection.md) and
   [`references/audit-tag-convention.md`](references/audit-tag-convention.md).
3. **Invoke `ak-docs-release-audit` V0.** Present the choice and, on owner
   confirmation, run `scripts/check-docs-release-update.mjs --mode v0` with
   the chosen refs and channel. The audit skill emits the ledger, impact
   map, unresolved evidence, and the approval request under
   `plans/releases/<target>/`.
4. **Stop for owner approval.** Present the request ID, digests, and the
   proposed nested prose paths (owner-directed scope for CLI prose whose
   impact-map returns `paths: []`). Await the exact statement
   `approve REQ-…`.
5. **Handle contract v1 blind spots.** Run the manual passes in one PR:
   - **CLI prose** — V1 authoring inside the approved paths only.
   - **Kits** — diff kit tar bundles, author public skill pages EN+VI,
     refresh `kit-catalog-identities.json`, update meta and skill index.
     See [`references/default-tab-detection.md`](references/default-tab-detection.md)
     for the diff-first classification. Also run the body-diff pass in
     the audit skill's
     [`references/kit-prose-drift.md`](../ak-docs-release-audit/references/kit-prose-drift.md)
     against existing kit skill pages — identity checks miss prose drift
     when a skill's SKILL.md body, `.env.example`, or `skill.yaml`
     changes while frontmatter stays stable.
   - **Desktop** — Layer A bump automatically; Layer B semi-auto with
     owner gate; Layer C deferred. See
     [`references/desktop-3-layer.md`](references/desktop-3-layer.md).
6. **Run deterministic scripts.**
   - Beta: `node scripts/sync-release.mjs --bundle <bundle-dir>`.
   - Stable: verify `git tag docs/<promotedFrom>` matches
     `channels.beta.tag`, then
     `node scripts/promote-docs.mjs --bundle <stable-bundle-dir>`.
     `promote-docs.mjs` whole-copies the bound beta snapshot into
     `content/docs/stable/**`, which pulls the source beta's
     `ak-gui_<beta-tag>_*` references into stable/desktop-app. Right
     after the whole-copy, re-run Layer A against the final stable
     tag's ak-gui evidence (release-page `.sha256` sidecars) so
     stable/desktop-app reflects the stable build, not the beta build.
   Skip if the run does not target that channel.
7. **Validate, commit, and open PR.**
   Run `pnpm install --frozen-lockfile`, `test`, `typecheck`, `lint`,
   `check:catalog`, `check:reference`, `build`, `check:quality`,
   `check:assets`, `check:links`. Commit per pass with descriptive
   subjects. Push and open a normal PR into `dev`.

After the PR merges, the orchestrator (or a follow-up run) creates
`audit/<to-tag>` at the merged commit and pushes it, sealing the audit trail
for the next run.

## Delegation rules

- Never edit prose without going through V0 → approval → V1 authoring in the
  audit skill's guardrail.
- Never invoke `promote-docs.mjs` without a verified `docs/<promotedFrom>`
  tag whose beta snapshot's `channels.json.beta.tag` matches the manifest
  `promotedFrom`.
- Never merge, deploy, force-push, or modify unrelated PRs.
- Never write files outside the current repository.
- Never touch the user's local `../agentkit` checkout. Use temporary clones
  or `gh release download` for evidence.

## Configuration

Threshold defaults are documented per reference file:

- Default-tab phrase gate: 3 phrases, 3 files.
- Desktop Layer B PR gate: 3 PRs, or any breaking-tagged PR.

Owner may override at invocation time via CLI flags described in
[`references/syntax.md`](references/syntax.md).

## Finish

Return a handoff listing every exact ref, request ID, approval nonce,
paths changed, validation results, PR URL, CI status, and remaining
blockers. Point out any `audit/<tag>` tag the run created so the next
release inherits a consistent trail.
