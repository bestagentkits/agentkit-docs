# Go-live checklist

The docs code is complete and on `main` (build, i18n routing, channel tabs, seed
content, release-sync pipeline, guardrailed agent). The steps below are the
**operator/console tasks** that turn that code into a live site + working
pipeline. They cannot be done from the repo — do them once, in order.

Deeper reference lives in [`README.md`](./README.md) (pipeline runbook + secrets
table) and [`AGENTS.md`](./AGENTS.md) (governance). This file is the single
ordered checklist.

---

## 1. Ship the site (Cloudflare Pages) — critical path

This alone gives a live site; the pipeline steps below are independent.

- [ ] Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → select `bestagentkits/agentkit-docs`.
- [ ] Build settings: **Framework preset** = None · **Build command** = `pnpm build` · **Build output** = `out` · env **`NODE_VERSION` = `22`**.
- [ ] Leave **preview deployments** on (per-PR previews).
- [ ] Confirm the first production deploy is green, then spot-check `/en/docs/stable`, `/vi/docs/stable`, `/en/docs/beta/...` (beta banner), and that `/` redirects to `/en` (Cloudflare honors `public/_redirects`).
- [ ] Once the domain is confirmed: add custom domain `docs.agentkit.best` + DNS.

Static output is verified deployable (`pnpm build` → `out/`, no server runtime).

---

## 2. Identities + secrets (GitHub Apps)

Two **separate** apps — the split is a security boundary, do not merge them.

- [ ] Create GitHub App **`agentkit-docs-bot`**: repo permissions **Contents: Read & write**, **Pull requests: Read & write**; install on `agentkit-docs` only. This is the sync/promotion identity and the **only** entry on the `main` ruleset bypass list (step 3).
  - [ ] Store its App ID → secret `DOCS_BOT_APP_ID`; generate a private key → secret `DOCS_BOT_PRIVATE_KEY`.
- [ ] Create GitHub App **`agentkit-docs-agent`**: same two permissions, installed on `agentkit-docs` only. This is the docs-agent identity and is **NOT** on the bypass list (so agent PRs must pass all guards).
  - [ ] App ID → secret `DOCS_AGENT_APP_ID`; private key → secret `DOCS_AGENT_PRIVATE_KEY`.
- [ ] Fine-grained PAT with **Contents: Read** on the private `bestagentkits/agentkit` repo only → secret `AK_CLI_READ_TOKEN` (record a rotation owner).
- [ ] Anthropic API key → secret `ANTHROPIC_API_KEY` (docs agent).
- [ ] (Optional) repo **variable** `AK_CLI_REPO` if the source slug ever differs from the default `bestagentkits/agentkit`.

---

## 3. Branch protection / ruleset + review

- [ ] Ruleset on `main`: require the CI check to pass; block direct pushes; **bypass list = the `agentkit-docs-bot` app only** (never the agent app).
- [ ] Edit [`.github/CODEOWNERS`](./.github/CODEOWNERS): replace the placeholder `@bestagentkits/docs-maintainers` with the real team/user, then require CODEOWNER review on `main`.
- [ ] ⚠️ **Private-repo caveat:** enforced rulesets + CODEOWNERS on a **private** repo require a paid GitHub plan. Verify the org tier first. If it's Free, fall back to required status checks + review discipline and note the gap in `AGENTS.md`/`CODEOWNERS`.

---

## 4. Validate the pipeline end-to-end (once secrets exist)

The pipeline is already fixture-validated locally; this confirms it live.

- [ ] Attach `fixtures/docs-bundle-beta` (tarred as `docs-bundle.tar.gz`) to a throwaway release on **this** repo as a stand-in for `ak-cli`, then fire a dispatch:
  ```bash
  gh api repos/bestagentkits/agentkit-docs/dispatches -f event_type=release-docs \
    -F 'client_payload[channel]=beta' -F 'client_payload[tag]=v0.42.0-beta.7' \
    -F 'client_payload[sha]=<sha>'
  ```
- [ ] Verify `docs-sync` commits `docs-sync: beta v0.42.0-beta.7`, tags `docs/v0.42.0-beta.7`, and Cloudflare redeploys.
- [ ] Re-fire the same tag → confirm **no diff** (idempotence).
- [ ] Confirm a human PR editing a `.generated` file fails CI, and the sync-bot commit passed.

---

## 5. Phase 6 — ak-cli owner sign-off (no ak-cli changes until accepted)

- [ ] Deliver [`docs/proposals/ak-cli-issue-text.md`](./docs/proposals/ak-cli-issue-text.md) to the `ak-cli` owner — as an issue in `ak-cli` **or** a direct conversation (owner's preference). Do **not** open an unsolicited PR against `ak-cli`.
- [ ] Record the decision:
  - **Accept** → schedule the `ak-cli` `gen-docs` work as its own plan (in `ak-cli`).
  - **Reject** → activate the polling fallback in `ak-docs` (see the proposal's fallback section).

---

## Open questions (confirm with owner)

- Final domain `docs.agentkit.best` (assumed) — confirm before DNS.
- GitHub plan tier for the private repo (gates step 3 enforcement).
- Ask-AI navbar slot — placeholder in v1, out of scope.
