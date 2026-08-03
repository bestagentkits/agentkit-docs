# Release-control preflight

This runbook turns the release-control contract into a read-only report before
an administrator changes GitHub. The checker fails closed when a control is
missing, invalid, or not observable. It requests secret and variable **names
only**. It never requests or prints their values.

## Run the preflight

Prerequisites: GitHub CLI authenticated with read access to
`bestagentkits/agentkit-docs`, read access to the private upstream
`bestagentkits/agentkit`, and `read:org` plus administration metadata visibility
when App installation membership must be proven.

```bash
node scripts/check-release-control-preflight.mjs
node scripts/check-release-control-preflight.mjs --json
```

The default command exits non-zero for either a failed or unknown check. Use
`--allow-blockers` only to capture an expected red report during provisioning;
it does not turn any check green.

```bash
node scripts/check-release-control-preflight.mjs --json --allow-blockers \
  > release-control-preflight.json
```

Offline review uses a previously redacted snapshot with `--snapshot <file>`.
Do not place secret values in snapshots. Fixture coverage lives in
`scripts/check-release-control-preflight.test.mjs`.

The green contract is:

- all eight required repo secret names and `AK_CLI_REPO` exist;
- `docs-agent` and `docs-promotion` labels exist;
- `agentkit-docs-bot` and `agentkit-docs-agent` resolve and are actively
  installed on the docs repository;
- CODEOWNERS has no resolution error;
- `dev` and `main` require pull requests, one approval, CODEOWNERS review,
  dismissal of stale approvals, `build` and `guard`, and block force pushes and
  deletion;
- only `agentkit-docs-bot` bypasses `dev`; no App, user, or team bypasses
  `main`; `agentkit-docs-agent` never bypasses either branch;
- staging and production restrict deployment branches, and production requires
  an explicit reviewer;
- receiver workflows are active;
- upstream has `AK_DOCS_DISPATCH_TOKEN`, a `gen-docs` producer, bundle upload,
  checksum/provenance, and `release-docs` dispatch wiring;
- current Beta and Stable releases carry the bundle and checksum/provenance;
- current docs run/tag evidence proves successful Beta and Stable delivery.

Required repo secret names:

```text
AK_CLI_READ_TOKEN
ANTHROPIC_API_KEY
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
DOCS_AGENT_APP_ID
DOCS_AGENT_PRIVATE_KEY
DOCS_BOT_APP_ID
DOCS_BOT_PRIVATE_KEY
```

The checker deliberately treats App installation membership as `unknown` when
the caller cannot observe it. A guessed installation is not evidence.

## Current live blockers

Read-only inspection on 2026-08-04 against
`bestagentkits/agentkit-docs@dev` (`a3d1c4d48ed1bfe697d8f127f674b8abef6d2a98`)
found:

- only `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` exist; the six docs
  bot/agent/source/Anthropic secret names and `AK_CLI_REPO` are absent;
- `docs-agent` and `docs-promotion` labels are absent;
- public App lookup for both expected logins returns 404; organization
  installation membership is not observable with the current token scope;
- `.github/CODEOWNERS` produces four unknown-owner errors for
  `@bestagentkits/docs-maintainers`; the team endpoint also returns 404;
- the only repository ruleset is `main`, and it is disabled; neither `dev` nor
  `main` has classic branch protection;
- `staging` and `production` exist but have no protection rules or deployment
  branch policy;
- `docs-sync`, `docs-agent`, and `agent-guard` are active, but `docs-sync` and
  `docs-agent` have no runs; the repository has no `docs/*` tags or releases;
- `agent-guard.yml` checks for `agentkit-docs-bot[bot]`, not the actual expected
  `agentkit-docs-agent[bot]` author identity, so an unlabeled agent PR would not
  receive the identity-based defense-in-depth trigger;
- current CI and staging/production deploy evidence is green, but it does not
  prove release sync authority or delivery.

Upstream read-only inspection at
`bestagentkits/agentkit@dev` (`a2ffc9d1bfdf5b6f15a1f108037e0d583347c22f`)
found healthy recent publisher runs and Beta/Stable release assets, but:

- no release contains `docs-bundle.tar.gz` or its checksum/provenance;
- `AK_DOCS_DISPATCH_TOKEN` is absent;
- `apps/cli/cmd/gen-docs` does not exist;
- the release workflows do not upload a docs bundle or dispatch `release-docs`.

Do not apply any control while the real docs owner/approver is unresolved. Do
not replace CODEOWNERS with a guessed login.

The `agent-guard.yml` identity correction belongs to the Phase 5 workflow owner.
This preflight task reports it but does not edit the workflow.

## Durable approval record

The versioned contract is `docs-approvals/v1.schema.json`; a non-production
example is `docs-approvals/v1.example.json`. A real approval is a new
`docs-approvals/<tag>-<nonce>.json` file merged through a protected, reviewed PR.
Never overwrite or reuse an approval record.

The record binds:

- upstream repository, exact release tag, and 40-character source SHA;
- docs repository, exact base SHA, and `dev` target;
- SHA-256 digests of the release manifest and impact map;
- exact claim IDs;
- exact repository-relative paths and permitted actions;
- resolved approver identity plus the issue and approval PR;
- issue time, expiry time, and a unique UUIDv4 nonce.

JSON Schema validates shape. A consumer must additionally fail closed unless all
of these semantic checks pass:

1. The tag resolves to `subject.sourceSha`, and the docs branch still contains
   `subject.docsBaseSha` as the reviewed base.
2. Recomputed lowercase SHA-256 digests equal both evidence digests.
3. `issuedAt <= now < expiresAt`; timestamps are UTC and expiry is no more than
   seven days after issue unless the approved policy explicitly changes.
4. `nonce` is unique across all merged approval records, has never been
   consumed, and equals the nonce suffix in `approvalId`.
5. The issue and PR exist in the named repository; the PR is merged through the
   protected branch with the stated approver as an authorized CODEOWNER.
6. Every proposed path and action is an exact subset of `scope`; no glob or
   path normalization may widen it.
7. Stable, generated-marker directories, `reference-derived`, workflows,
   CODEOWNERS, and `docs-approvals` remain denied even if a malformed record
   tries to name them.
8. The executing identity is not the approver, and the approval is consumed at
   most once.

## Provisioning checklist

Every change follows preview → reviewed apply → preflight → rollback rehearsal.
Commands below are administrator procedures; this implementation did not run
them.

### 1. Capture a rollback baseline

- [ ] Create a private local directory outside the repository and restrict it
  to the administrator account.
- [ ] Export metadata. These files contain control configuration, not secret
  values.

```bash
export DOCS_REPO=bestagentkits/agentkit-docs
export UPSTREAM_REPO=bestagentkits/agentkit
export CONTROL_BACKUP_DIR=/absolute/private/path/release-control-backup

mkdir -p "$CONTROL_BACKUP_DIR"
chmod 700 "$CONTROL_BACKUP_DIR"
gh api "repos/$DOCS_REPO/rulesets?includes_parents=true" \
  > "$CONTROL_BACKUP_DIR/rulesets.json"
gh api "repos/$DOCS_REPO/environments" \
  > "$CONTROL_BACKUP_DIR/environments.json"
gh api "repos/$DOCS_REPO/labels?per_page=100" \
  > "$CONTROL_BACKUP_DIR/labels.json"
gh secret list --repo "$DOCS_REPO" --json name,updatedAt \
  > "$CONTROL_BACKUP_DIR/repo-secret-names.json"
gh variable list --repo "$DOCS_REPO" --json name,updatedAt \
  > "$CONTROL_BACKUP_DIR/repo-variable-names.json"
```

- [ ] Record existing App installation IDs and repository selection from the
  organization installation page. Secret values cannot be backed up; record
  rotation owners and recovery sources instead.

### 2. Resolve ownership and Apps

Preview:

```bash
gh api repos/bestagentkits/agentkit-docs/codeowners/errors
gh api orgs/bestagentkits/teams/<approved-docs-team>
gh api apps/agentkit-docs-bot
gh api apps/agentkit-docs-agent
gh api orgs/bestagentkits/installations
```

Apply after the owner is approved:

- [ ] Give the owner/team write access and make it visible enough for
  CODEOWNERS resolution.
- [ ] Update CODEOWNERS in its own reviewed PR.
- [ ] Create/install `agentkit-docs-bot` with contents and pull-request write on
  this repository only.
- [ ] Create/install `agentkit-docs-agent` with the same repository selection;
  never grant it ruleset bypass.
- [ ] Record App IDs and private keys in the repository secret store through
  the GitHub UI or an approved secret manager. Never pass values on a shell
  command line.

Rollback:

- [ ] Suspend or uninstall the two Apps from this repository.
- [ ] Rotate/revoke their private keys.
- [ ] Revert the CODEOWNERS PR only to the last known resolving owner, never to
  the current unresolved placeholder.

### 3. Add names, variables, and labels

Preview:

```bash
gh secret list --repo "$DOCS_REPO" --json name,updatedAt
gh variable list --repo "$DOCS_REPO" --json name,updatedAt
gh label list --repo "$DOCS_REPO" --limit 200 --json name,color,description
gh secret list --repo "$UPSTREAM_REPO" --json name,updatedAt
```

Apply. `gh secret set` reads a value securely from standard input; source each
value from the administrator-approved secret manager without echoing it:

```bash
gh secret set DOCS_BOT_APP_ID --repo "$DOCS_REPO"
gh secret set DOCS_BOT_PRIVATE_KEY --repo "$DOCS_REPO"
gh secret set DOCS_AGENT_APP_ID --repo "$DOCS_REPO"
gh secret set DOCS_AGENT_PRIVATE_KEY --repo "$DOCS_REPO"
gh secret set AK_CLI_READ_TOKEN --repo "$DOCS_REPO"
gh secret set ANTHROPIC_API_KEY --repo "$DOCS_REPO"
gh variable set AK_CLI_REPO --repo "$DOCS_REPO" --body bestagentkits/agentkit
gh label create docs-agent --repo "$DOCS_REPO" --color 1d76db \
  --description 'Guarded docs-agent pull request'
gh label create docs-promotion --repo "$DOCS_REPO" --color 0e8a16 \
  --description 'Reviewed stable docs promotion'
gh secret set AK_DOCS_DISPATCH_TOKEN --repo "$UPSTREAM_REPO"
```

The two existing Cloudflare secrets remain untouched.

Rollback:

```bash
gh secret delete DOCS_BOT_APP_ID --repo "$DOCS_REPO"
gh secret delete DOCS_BOT_PRIVATE_KEY --repo "$DOCS_REPO"
gh secret delete DOCS_AGENT_APP_ID --repo "$DOCS_REPO"
gh secret delete DOCS_AGENT_PRIVATE_KEY --repo "$DOCS_REPO"
gh secret delete AK_CLI_READ_TOKEN --repo "$DOCS_REPO"
gh secret delete ANTHROPIC_API_KEY --repo "$DOCS_REPO"
gh variable delete AK_CLI_REPO --repo "$DOCS_REPO"
gh label delete docs-agent --repo "$DOCS_REPO" --yes
gh label delete docs-promotion --repo "$DOCS_REPO" --yes
gh secret delete AK_DOCS_DISPATCH_TOKEN --repo "$UPSTREAM_REPO"
```

Delete only names created by this change and only after comparing the rollback
baseline. Revoking the underlying credentials is mandatory after deletion.

### 4. Apply branch controls

Preview exact reviewed payloads before mutation:

```bash
jq . /absolute/reviewed/dev-ruleset.json
jq . /absolute/reviewed/main-ruleset.json
gh api "repos/$DOCS_REPO/rulesets?includes_parents=true"
```

The `dev` payload must target only `refs/heads/dev`, require `build` and `guard`,
one approval, CODEOWNERS, stale-review dismissal, and block force push/deletion.
Its only bypass actor is the numeric Integration ID resolved for
`agentkit-docs-bot`. The `main` payload targets only `refs/heads/main` and has an
empty `bypass_actors` array.

Apply reviewed payloads:

```bash
gh api --method POST "repos/$DOCS_REPO/rulesets" \
  --input /absolute/reviewed/dev-ruleset.json
gh api --method POST "repos/$DOCS_REPO/rulesets" \
  --input /absolute/reviewed/main-ruleset.json
node scripts/check-release-control-preflight.mjs --allow-blockers
```

Do not enable the rulesets until a test PR proves the named checks report on
both target branches. Rollback uses the exact IDs returned by the POST calls:

```bash
gh api --method DELETE "repos/$DOCS_REPO/rulesets/<new-dev-ruleset-id>"
gh api --method DELETE "repos/$DOCS_REPO/rulesets/<new-main-ruleset-id>"
```

If replacing an existing rule, restore its captured JSON with an administrator-
reviewed `PUT` rather than guessing prior settings.

### 5. Apply environment controls

Preview:

```bash
gh api "repos/$DOCS_REPO/environments/staging"
gh api "repos/$DOCS_REPO/environments/production"
```

Apply reviewed environment payloads. Staging permits `dev`; production permits
`main` and names at least one resolved reviewer:

```bash
gh api --method PUT "repos/$DOCS_REPO/environments/staging" \
  --input /absolute/reviewed/staging-environment.json
gh api --method PUT "repos/$DOCS_REPO/environments/production" \
  --input /absolute/reviewed/production-environment.json
```

Rollback by `PUT` of the captured environment JSON. Deleting an environment is
not an acceptable first rollback because it also destroys deployment history
and configuration.

### 6. Rehearse authority boundaries

- [ ] Human direct push to `dev` and `main` is rejected.
- [ ] Docs-agent direct push to both branches is rejected.
- [ ] Sync-bot direct push is rejected on `main`.
- [ ] Sync-bot can perform only the intended Beta sync push/tag to `dev`.
- [ ] An unlabeled PR authored by the actual docs-agent login still schedules
  `guard`.
- [ ] A labeled human PR also schedules `guard`.
- [ ] Production deployment waits for the configured reviewer.

Use a safe rehearsal tag/repository and retain URLs, run IDs, exact SHAs, and
asset digests. Do not dispatch a production release for a permission test.

### 7. Verify and stop conditions

```bash
node scripts/check-release-control-preflight.mjs
```

Stop and roll back the affected control if any check is failed or unknown, if
the GitHub plan cannot enforce required review, if a bypass actor cannot be
resolved to the exact App ID, or if the Beta/Stable rehearsal evidence is not
reproducible.

## Upstream follow-up ownership

Do not modify `ak-cli` from this task. A separate task based on current upstream
`dev` owns exactly these producer surfaces:

Create:

- `apps/cli/cmd/gen-docs/main.go` — build the real `cmdtree` and emit MDX with
  title, description, and `generated: true` frontmatter;
- `apps/cli/cmd/gen-docs/main_test.go` — non-empty tree, frontmatter, stable
  links, and error-path tests, mirroring `gen-man`;
- `tools/release/build-docs-bundle.py` — construct manifest v1 from the exact
  annotated release ref, copy the already-rendered release notes, validate safe
  paths, create a deterministic archive, and emit its SHA-256 sidecar;
- `tools/release/build-docs-bundle-test.py` — Beta/Stable fixtures, exact SHA,
  `promotedFrom`, deterministic bytes, path traversal rejection, and malformed
  input tests.

Modify:

- `apps/cli/go-test-shards.json` — register `./cmd/gen-docs` in the complete Go
  package universe;
- `.github/workflows/release-kits.yml` — after exact source/provenance resolution,
  build and upload `docs-bundle.tar.gz` plus its SHA-256 sidecar before the
  serialized finalizer captures the pre-provenance asset cohort; dispatch
  `release-docs` only after final asset validation and upload succeed;
- `tools/release/release-contract.json` — add the two docs asset identities to
  the contract-defined pre-provenance cohort;
- `tools/release/generate-stable-release-notes-test.py` — assert producer,
  upload, final validation, and dispatch ordering, and prove the finalizer stays
  the sole release-provenance/notes writer.

No change is needed in `auto-semver-release.yml`: it already dispatches the
serialized `release-kits.yml` finalizer for Beta and staging, while Stable tag
fan-out triggers it natively. No change is needed in `release.yml`: GoReleaser
remains the CLI publisher. `run-release-helper-tests.sh` discovers the new
`*-test.py` automatically, so it should not gain a hard-coded test entry.

The upstream task must provision `AK_DOCS_DISPATCH_TOKEN` separately, upload
before dispatch, send only `{ channel, tag, sha }`, and rehearse Beta and Stable
without changing or reusing production releases.
