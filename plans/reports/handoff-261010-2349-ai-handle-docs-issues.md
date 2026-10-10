# Handoff: `ai-handle` docs issues (agentkit-docs)

Paused 2026-10-10 23:49 (Asia/Saigon) because the weekly usage limit was hit.
Nothing is running: the watcher loop and all subagents are stopped, and their
worktrees are removed.

## Standing instruction from the user

Handle every open issue labelled `ai-handle` in `bestagentkits/agentkit-docs`.
An issue is DONE when its docs are merged to `dev`, promoted to production
(`dev` → `main` → https://docs.agentkit.best), verified live, and only then
closed. Keep watching for new AgentKit releases and new `ai-handle` issues, and
handle them without asking.

## Current production state

- Production shows Beta 3.0.0-beta.15 and Stable 2.19.0. The last promotion
  was PR #278 (merge `d7f1916`, deploy run 38040979610, verified live).
- `dev` = `main` plus #277 is already in #278. At pause time `dev` has nothing
  unshipped.
- Closed after production verification: #243, #258, #259, #260, #262, plus the
  earlier rounds (#249 and all issues from PRs #245–#256).

## Release gate (why most issues are held)

Only a release whose `release-kits` workflow succeeded counts. Check with
`gh run list -R bestagentkits/agentkit -w release-kits -L 5`.

| Tag | release-kits |
| --- | --- |
| v3.0.0-beta.16 | failure (Windows GUI upload in build-wails; Kits never registered) |
| v3.0.0-beta.15 | success ← latest complete release, Beta is synced to it |
| v3.0.0-beta.14 | failure |

When a newer tag succeeds (or beta.16 is re-run green), sync Beta to it first.

## Open issues and their held drafts

Every draft PR targets `dev`, has CI green or running, and has a `Hold:` line in its body.

| Issue | Draft PR | Blocked on |
| --- | --- | --- |
| #234 Desktop Devices / `ak license devices` | #268 | agentkit#2146 (open) must ship in a complete release. ak-web#551 is merged. The beta.16 `DevicesPage` still says Coming soon. |
| #265 `ak doctor --check semantic_decision` step (Cloudflare part already shipped) | #270 | agentkit `6dc9b7ada` (#2263) is only in beta.16, which is incomplete. |
| #266 dashboard index-not-ready banner | #272 | agentkit#2264 (open). Recheck the wording against the merged code. |
| #273 `.akignore` allowlist | #280 | No product PR. The source is only an unpushed branch at `3cca7085b`. |
| #275 `ak skills external` + Desktop External tab | #282 | No product PR. The source is only an unpushed branch `feat/1518-external-skills-sources` (`5bfb02f51`). |
| #276 Windows update runs inside a non-kill-on-close job | #283 | agentkit#2266 is merged to product `dev` (`eaaeb8a9f`). It needs the next complete release. |
| #279 subagent model management (`ak agents model`) | #281 | agentkit#2077 is an issue with no PR yet. The source is a local branch (`9f12b36e6`). Recheck after it merges. |
| #284 `ak:motion-video` story/shot/bake-off/generated art | #285 | agentkit#2271 (head `5c0e090`). The agent was stopped while running local link/SEO checks, so let CI on #285 confirm. |

## Next steps for whoever resumes

1. Check `release-kits` for a successful run newer than beta.15.
2. If one exists, sync Beta to it. Follow PR #274 (and #257, #255):
   - Verify `docs-bundle.tar.gz` against its sidecar and the release digest.
   - Run `scripts/sync-release.mjs`. On Windows, extract the tarball first and
     pass the directory, because `tar` mis-reads `C:`.
   - Verify all 48 Kit assets.
   - Rebind `kit-catalog-identities.json` and
     `release-evidence/kit-catalog/beta-<tag>/`.
   - Write `release-evidence/desktop/<tag>.json`.
   - Update prose for user-facing changes.
3. For each draft above whose product change is in that release, re-verify it against the tag, rebase, mark it ready, wait for CI, and squash-merge.
   - #281, #282 and #285 each raise route/search baselines in
     `scripts/release-quality-{shape,metrics}.mjs`. Expect conflicts there and
     recompute the numbers.
4. Promote to production:
   - Build the `origin/dev` + `origin/main` merge tree in a scratch worktree.
   - Run `node scripts/check-kit-catalog.mjs` and
     `node scripts/check-kit-docs-ci.mjs <main-sha>`. Expect route `history`
     (no Stable diff) and artifacts=8 for every channel.
   - Open `dev` → `main` and merge it with a merge commit once CI is green.
   - Wait for `deploy-production.yml`, then curl the live pages
     (`/en|vi/beta/...`).
5. Close each issue with a comment that cites the production PR and deploy run.
6. Handle any new `ai-handle` issues the same way: write the docs, then merge them if the change is released or open a draft with a `Hold:` line if not.

## Conventions and gotchas

- Never hand-edit `content/docs/stable`, `reference-raw/` or `reference-derived/`.
  Stable changes only through the promotion pipeline.
- Keep EN `*.en.mdx` and VI `*.vi.mdx` in parity. In VI prose, keep
  Skill/Kit/Agent/Hook in English.
- The product repo `D:/www/claudekit/agentkit` is read-only (`git show/grep/log`,
  `gh pr view/diff`).
- On Windows, Bash needs `eval "$(fnm env --shell bash)"`, and every call prints
  a harmless fnm error line. `pnpm test`, `check:quality` and `check:assets` fail
  on Windows for path-separator reasons; Linux CI is authoritative.
- Remove agent worktrees with long paths via PowerShell
  `Remove-Item -LiteralPath '\\?\<path>' -Recurse -Force`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  PRs end with the Claude Code footer and use `Refs #N`. Close issues only
  after production verification.

## Unresolved questions

- Who opens the product PRs for #273 (`.akignore`) and #275 (external skills)?
  Their docs drafts cannot ship until that happens.
- An agent reported that `check:kit-docs` fails on `dev` because of extra Stable
  Skill pages. That script is not the production gate (`check-kit-docs-ci`
  passed), but it is worth investigating.
- Separate from these issues: CLI prose drift since v2.20.0-beta.1 (carried over
  from #244) still needs its own release audit.
