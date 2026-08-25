---
name: ak:release-update
description: "Orchestrate an AgentKit docs release update end-to-end — resolve evidence, detect audit gaps, delegate audit + V1 authoring to ak-docs-release-audit, run deterministic sync and promote scripts, validate, and open the PR. Use for beta sync PRs, stable promotion PRs, and multi-hop catch-up runs against an audit trail."
user-invocable: true
when_to_use: "Invoke when publishing a docs update for a new upstream beta or stable release, catching up prose that drifted across a stretch of releases without audit passes, or preparing a stable promote after a beta sync PR lands."
category: utilities
keywords: [release, sync, promote, audit, evidence, orchestrator, beta, stable, catchup]
argument-hint: "--tag <tag> | --beta <tag> --stable <tag> [--from <ref>] [--catchup] [--no-audit-check] | --stable-docs-exception <paths...>"
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
/ak:release-update --stable-docs-exception <beta-route-or-path>...
```

| Flag | Meaning |
| --- | --- |
| `--tag <tag>` | Single release. Channel is inferred: `-beta.N` suffix ⇒ beta, otherwise stable. |
| `--beta <tag>` | Explicit beta tag. Pairs with `--stable` for a two-PR sequence. |
| `--stable <tag>` | Explicit stable tag. Runs after the beta PR merges. |
| `--from <ref>` | Override the audit `from-ref`. Skips auto-detection. |
| `--catchup` | Force multi-hop audit with `from` = source of current `channels.stable.tag` (i.e., its `promotedFrom`). |
| `--no-audit-check` | Skip audit-gap detection and default single-hop. Logs a warning in the PR body. |
| `--stable-docs-exception <paths...>` | Owner-approved docs-only copy from Beta to Stable when no new stable `ak` version exists. See Stable docs exception. |

See [`references/syntax.md`](references/syntax.md) for the full flag surface,
examples, and error paths.

## Stable docs exception

Use this only when the owner explicitly asks to publish a small set of
channel-neutral authored Beta docs to Stable before the next stable `ak`
release exists. This is not a release promote and must not change
`channels.json.stable`.

Allowed scope:

- Existing or new route families under
  `content/docs/{beta,stable}/{concepts,guides,getting-started,troubleshooting}/`.
- Matching EN and VI pages for each route.
- The minimal `meta.json` and `meta.vi.json` entries needed to make those
  copied Stable routes navigable.
- Reviewed quality baselines only after a fresh build proves the new Stable
  route/search counts.

Forbidden scope:

- `content/docs/*/reference/**`, `reference-derived/**`, `changelog/**`,
  `release-notes.*`, generated directories, generated CLI reference, Kit
  catalog pages, Desktop release artifacts, screenshots, and `channels.json`.
- Any prose that claims a Beta-only product behavior is available in Stable.
- Any partial locale copy. EN and VI route shape must stay aligned.
- Any broad directory copy that would amount to a Stable promotion.

Procedure:

1. Confirm there is no new stable `ak` release or stable docs bundle to promote.
2. Require explicit owner approval naming each route or repo path.
3. For each approved route, copy the Beta EN/VI source files to the same Stable
   route. Keep content channel-neutral; remove or reject Beta-only claims.
4. Update only the matching Stable nav metadata required for the approved
   routes.
5. Run `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm check:quality`.
   If Stable route or search counts change, update reviewed baselines only from
   that fresh build.
6. In the handoff, label the change as a stable docs exception, list every
   copied route, state that `channels.json.stable` was unchanged, and say which
   stable release gap made promotion unavailable.

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
3. **Invoke `ak-docs-release-audit` V0.** Before the final V0 run, complete
   the read-only blind-spot classification for CLI prose, Kit identity/body
   drift, runtime target/status drift, Desktop, and generated bundle claims. If
   release assets add or remove a runtime package, change runtime manifests, or
   change public `SKILL.md` bodies, `paths: []` is allowed only with an explicit
   evidence-backed no-prose-impact note. Distinguish registry Kit projection
   targets (for example `ak kit init --target pi`) from `ak run` / `ak setup`
   adapters (for example `omp`); never infer one surface from the other. Present
   the choice and, on owner confirmation, run
   `scripts/check-docs-release-update.mjs --mode v0` with the chosen refs and
   channel. When a manual blind-spot pass finds exact existing Beta prose for an
   actionable pathless claim, write EN/VI-paired paths as a JSON array and pass
   `--owner-paths <file>`; nested human-owned
   `content/docs/beta/reference/cli/**` paths are allowed. The request records
   them in `ownerDirectedPaths` and binds the complete final `paths` set without
   rewriting the source-derived impact map. The audit skill emits the ledger,
   impact map, unresolved evidence, and approval request under
   `plans/releases/<target>/`.
4. **Stop for owner approval.** Present the request ID, digests, and the
   proposed nested prose paths, including any `ownerDirectedPaths`. Await the
   exact statement `approve REQ-…`.
5. **Handle contract v1 blind spots.** Run the manual passes in one PR:
   - **CLI prose** — V1 authoring inside the approved Beta paths only.
   - **Kits** — diff kit tar bundles, author public Beta skill pages EN+VI,
     refresh `kit-catalog-identities.json`, update meta and skill index.
     See [`references/default-tab-detection.md`](references/default-tab-detection.md)
     for the diff-first classification. Also run the body-diff pass in
     the audit skill's
     [`references/kit-prose-drift.md`](../ak-docs-release-audit/references/kit-prose-drift.md)
     against existing kit skill pages — identity checks miss prose drift
     when a skill's SKILL.md body, `.env.example`, or `skill.yaml`
     changes while frontmatter stays stable. Do not copy Beta-only Kit or
     CLI changes into Stable; `stable ⊆ beta` is the cross-channel contract,
     and Stable changes only through promotion. The current `check:catalog`
     guard still assumes identical Kit routes and counts across channels; if a
     Beta-only Kit addition trips it, fix that guard contract instead of
     mirroring the addition into Stable.
   - **Runtime targets** — diff release notes, docs-bundle reference text, kit
     registry manifests, runtime support matrices, and package tar layouts for
     runtime lifecycle changes (`claude-code`, `codex`, `cursor`, `grok`, `omp`,
     `pi`, and future targets). Classify each changed runtime separately as a Kit
     projection target, `ak run` dispatch adapter, `ak setup` adapter, native
     harness target, local-source spike, signed registry target, or unsupported
     surface. When a runtime moves between these states, route all existing Beta
     prose that names the old status through owner-directed scope (EN + VI):
     getting-started install, quickstart, onboarding, runtime-adapters,
     architecture, installing-kits, runtime discovery troubleshooting,
     kit-installation troubleshooting, runtime-specific troubleshooting, and
     human-owned CLI reference prose. Do not assume Kit identity diffs or V0 docs
     mappings catch runtime status drift; manifests may change while public
     routes stay unchanged, and generated CLI help may lag a newly registered
     Kit projection target.
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
   For a `--stable-docs-exception` run, skip both release scripts and follow
   the Stable docs exception procedure instead.
7. **Validate, commit, and open PR.**
   Preserve exact EN/VI source, published, and searchable route parity within
   each channel and `stable ⊆ beta` across channels. Per-channel route and search counts may differ when Beta contains
   features awaiting promotion; update reviewed baselines only from a fresh
   build, never by copying those features into Stable.
   Run `pnpm install --frozen-lockfile`, `test`, `typecheck`, `lint`,
   `check:catalog`, `check:reference`, `build`, `check:quality`,
   `check:assets`, `check:links`. Commit per pass with descriptive
   subjects. Push and open a normal PR into `dev`.

   Treat `.next/` and `out/` as disposable, repo-local build output. Before
   every `pnpm build` or rebuild, verify both paths resolve inside the current
   repository, then remove stale copies with `rm -rf -- .next out`; a failed
   static export can otherwise leave multiple gigabytes behind. Keep the fresh
   `out/` only through `check:quality`, `check:assets`, `check:links`, and local
   browser smoke. After those build-dependent checks finish, remove `.next/`
   and `out/` again to release disk space. Never apply this cleanup to source,
   release evidence, `node_modules`, or caches outside the repository.

After the PR merges, the orchestrator (or a follow-up run) creates
`audit/<to-tag>` at the merged commit and pushes it, sealing the audit trail
for the next run.

## Delegation rules

- Never edit prose without going through V0 → approval → V1 authoring in the
  audit skill's guardrail.
- Never accept a V0 `paths: []` result when runtime packages, runtime manifests,
  or public Skill bodies changed until the blind-spot pass records why no Beta
  prose needs owner-directed scope.
- Never invoke `promote-docs.mjs` without a verified `docs/<promotedFrom>`
  tag whose beta snapshot's `channels.json.beta.tag` matches the manifest
  `promotedFrom`.
- Never use Stable docs exception for release notes, generated reference,
  Kit/CLI release drift, Desktop artifact bumps, or Beta-only product behavior.
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
