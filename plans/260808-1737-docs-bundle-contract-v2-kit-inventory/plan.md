# Docs-bundle contract v2 — kit inventory + prose delta hints

Owner: TBD · Status: proposed · Opened: 2026-08-08

## Outcome

Extend the upstream docs-bundle contract so that the `ak-docs-release-update`
SKILL's V0 audit surfaces two classes of drift it cannot see today:

1. **Kit inventory drift** — new, removed, or reclassified skills per kit.
2. **Human-owned prose drift hints** — commands whose `--help` semantics
   changed and whose narrative pages therefore likely need a manual pass.

Success is that a single V0 run on the new bundle emits `update`/`new`/
`remove` claims for **kit-detail routes** and marks **CLI prose pages**
whose backing raw help changed, so the owner-approved V1 authoring loop can
route those pages without a separate manual audit.

## Constraints

- Backwards-compatible for the ak-docs side: `sync-release.mjs` and
  `promote-docs.mjs` keep operating on v1 bundles, gated by the manifest's
  `schemaVersion`.
- No new evidence source. All inputs come from what upstream already builds
  for a release (kit tar bundles + the CLI help projection).
- No prose or catalog authorship inside the bundle. The bundle carries
  **inventory + hashes**, not human prose or narrative.
- V0 must stay deterministic and offline; digests over strings and paths
  only.

## Non-goals

- Auto-generating kit skill prose. That stays human/LLM-authored under
  owner approval.
- Auto-promoting kit changes into `content/docs/stable/**`. Stable stays a
  whole-copy of the exact beta docs snapshot.
- Backfilling old bundles. v2 applies from `bundle.schemaVersion >= 2`
  forward; older bundles are audited under v1 semantics.

## Proposed schema (bundle-side, upstream ak-cli owns)

Bundle root layout gains one file per Kit plus a top-level manifest bump:

```
manifest.json               # { schemaVersion: 2, channel, tag, sha, version,
                            #   generatedAt, promotedFrom?,
                            #   kits: ["engineer", "marketing", …],
                            #   proseHints?: {…} }
reference/cli/              # unchanged v1 raw help MDX projection
release-notes.md            # unchanged
kits/<kit>/inventory.json   # per-kit inventory, schema below
```

### `kits/<kit>/inventory.json`

```json
{
  "schemaVersion": 1,
  "kit": "engineer",
  "generatedFrom": "agentkit-kit-engineer-claude-code-<version>.tar.gz",
  "assetDigest": "sha256:<same hash as the release asset>",
  "identities": [
    {
      "sourceIdentity": "ak-github",
      "declaredInvocation": "ak:github",
      "userInvocable": true,
      "disableModelInvocation": false,
      "skillDigest": "sha256:<hash of SKILL.md>",
      "referenceDigests": {
        "SKILL.md": "sha256:…",
        "references/issue-workflows.md": "sha256:…"
      }
    },
    {
      "sourceIdentity": "ak-common",
      "declaredInvocation": "ak:common",
      "userInvocable": false,
      "disableModelInvocation": true,
      "skillDigest": "sha256:…"
    }
  ]
}
```

Fields are all facts extractable from each skill's frontmatter plus stable
digests. The bundle **does not** ship user-facing prose.

### `proseHints` (optional, top-level manifest)

```json
{
  "proseHints": {
    "cliDeltaSlugs": ["ak_config_prefs", "ak_config_prefs_set", "ak_plan_list"],
    "previousReleaseTag": "v<older>"
  }
}
```

Upstream computes `cliDeltaSlugs` as the set of `reference/cli/*.mdx` whose
raw help bytes differ from `previousReleaseTag`. This lets V0 route CLI
prose updates without ak-docs re-downloading the previous bundle. Optional;
V0 falls back to comparing the two supplied `--from-source`/`--to-source`
bundles.

## ak-docs side changes

### 1. Source loader (`scripts/lib/docs-release-source.mjs`)

- Detect `manifest.schemaVersion` and load `kits/<kit>/inventory.json` when
  present.
- Emit release-source items for each kit skill with:
  - `kind: 'skill'`, `id: '<kit>:<sourceIdentity>'`,
  - `docs: [{ path: 'content/docs/beta/kits/<kit>/skills/<slug>.en.mdx', role: 'primary' },
             { path: 'content/docs/beta/kits/<kit>/skills/<slug>.vi.mdx', role: 'vi-mirror' }]`
    when `userInvocable === true`,
  - `docs: []` and `blockedReasons: ['internal-support']` when
    `userInvocable === false`.
- Emit a `kind: 'kit-inventory'` item with the kit-level `assetDigest` so
  the impact-map sees the aggregate.

### 2. Ledger + impact-map

- No schema change. The existing `blocked`/`update`/`new`/`remove` machinery
  already handles this once the source items carry `docs` paths.
- For the CLI-prose case: when `proseHints.cliDeltaSlugs` is present, the
  loader adds `docs` paths for the nested prose targets
  (`content/docs/beta/reference/cli/<nested>.{en,vi}.mdx`) to the cli source
  items. Without hints, the loader stays conservative and leaves `docs: []`
  (today's behavior).

### 3. `sync-release.mjs`

- Under `schemaVersion >= 2`, additionally refresh
  `kit-catalog-identities.json`: bump `evidence`, update each kit's
  `evidenceAsset`, rewrite each identity's `evidenceRef` from the new
  digests, and add rows for new upstream skills with the exact classification
  the inventory declares.
- Add nothing to `content/docs/beta/kits/**`. Skill page authoring is still
  a V1 authoring step behind owner approval.
- Idempotent: re-running the same bundle produces byte-identical output.

### 4. `promote-docs.mjs`

- No change. Whole-copy semantics still apply. The catalog refresh happens
  in the sync PR that lands the beta snapshot; the promote PR then binds
  that snapshot and copies the updated kit tree into stable.

### 5. `check-kit-catalog.mjs`

- Add a "catalog freshness" mode that verifies `kit-catalog-identities.json.
  evidence.releaseTag` matches `channels.json.beta.tag`. Warn (do not fail)
  when the catalog trails the beta channel by more than one release. Keeps
  the drift visible without blocking legitimate mid-cycle work.

### 6. Skill V0 behavior

With the loader change, the wider-base V0 that ak-docs ran during the
v2.11.0-beta.1 catch-up would surface `update kits/engineer/skills/github`
etc. directly in `docs-impact-map.md`, and the approval request's `paths`
would be non-empty. That lets V1 authoring go through the strict validator
instead of the "owner-directed scope" workaround.

## Migration

1. Land ak-docs loader + sync-release changes behind a
   `schemaVersion === 2` gate. Existing v1 bundles keep working unchanged.
2. Coordinate with upstream ak-cli to publish `docs-bundle.tar.gz` at
   `schemaVersion: 2` starting with the next beta. Attach kit inventories
   from the same tar-bundle build step that already exists.
3. First v2 release exercises the loop end-to-end on a small delta.
4. Once a v2 sync + promote succeeds, the runbook in
   `docs/workflows/release-and-deploy.md` reduces the "Manual catch-up
   between betas" section to a note that V0 now flags kit and prose deltas
   automatically.

## Risk and rollback

- **Rollback**: the version gate means dropping back to v1 bundles is a
  no-op on ak-docs side. Delete the v2 loader branch; sync-release still
  runs.
- **Risk — inventory divergence**: upstream ships an inventory that
  disagrees with the actual tar contents (missing skill, extra skill).
  Mitigation: `assetDigest` compare on load; refuse when it does not match
  the release asset the maintainer downloaded separately.
- **Risk — over-eager prose hints**: `cliDeltaSlugs` false positives route
  V1 authoring to pages that do not actually need refresh. Mitigation:
  V0's impact-map still requires an explicit prose path mapping; the hint
  narrows the routing, it does not force an edit.

## Acceptance

- V0 run on a v2 bundle emits `update`/`new`/`remove` claims for
  `content/docs/beta/kits/**/skills/*.{en,vi}.mdx` when the inventory shifts.
- V0 run with `proseHints.cliDeltaSlugs` emits `update` claims for the
  nested CLI prose paths behind those slugs, with `paths: [...]`
  non-empty in the approval-request.
- `sync-release.mjs --bundle <v2-bundle>` refreshes
  `kit-catalog-identities.json` to the bundle's `assetDigest`s and adds
  identities for new upstream skills without touching skill prose files.
- Re-running the same v2 bundle is byte-identical (idempotency check in
  tests).
- `check:catalog` catalog-freshness warning fires when `evidence.releaseTag`
  trails `channels.beta.tag` by more than one release.

## Phases

1. **Loader + schema** — extend `docs-release-source.mjs` and add v2
   validation. Unit tests over fixture bundles.
2. **Sync integration** — teach `sync-release.mjs` to refresh
   `kit-catalog-identities.json` under v2. Property test for idempotency.
3. **Impact routing** — ensure ledger + impact-map produce non-empty
   `paths` for kit + hinted CLI claims. Update SKILL references only if
   the classification vocabulary changes (it should not).
4. **Runbook + docs** — replace the "Manual catch-up" section in
   `docs/workflows/release-and-deploy.md` with the v2 flow.
5. **Upstream coordination** — spec handoff to ak-cli, agree on
   `manifest.schemaVersion: 2` release cadence.

## Open questions

1. Should `proseHints` be mandatory in v2, or opt-in per release? Mandatory
   forces upstream to compute deltas; opt-in keeps the door open for
   maintainer-run computes.
2. Where does `kit-catalog-identities.json` live once sync refreshes it —
   still repo-root, or move into `plans/` as a versioned artifact? Root
   keeps `check:catalog` simple; `plans/` improves audit trail.
3. Do we introduce `intentionally-unlisted` as a first-class classification
   in v2, or keep piggybacking on `internal` (as `ak-common` does today)?
