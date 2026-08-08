# Desktop App section refresh — v2.7.0 → v2.11.0

Owner: TBD · Status: proposed · Opened: 2026-08-08

## Outcome

`content/docs/beta/desktop-app/**` and its stable mirror describe AgentKit
Desktop **v2.11.0** — the current supported release — accurately across:

- Package tables (filenames, bytes, SHA-256) matching the release assets.
- Behavior notes verified against the running Desktop binary.
- Screenshots captured from the v2.11.0 build per `public/gui/README.md`.

The Beta channel prose section covers the current beta packaging where
different (Beta ships `ak-gui_2.11.0-beta.1_*.zip` alongside Stable
`ak-gui_2.11.0_*.zip`).

## Why the section drifted

Docs-bundle contract v1 carries only CLI reference + release-notes; it never
carries Desktop provenance. `sync-release.mjs` therefore refreshes nothing
under `desktop-app/`. Between the last Desktop authoring pass (PR #32, v2.8
scope) and today, upstream shipped these Desktop-affecting PRs across
v2.9.0/v2.10.0/v2.11.0:

- Rebuild desktop shell on approved prototype (PR #1221)
- Ship closed-beta readiness (PR #1210)
- Add native Wails MCP bridge
- Add trust center MVP (PR #463)
- Improve beta control center UX (PR #636)
- Cross-platform native app builds + in-app update banner (PR #170)
- Render remote in-app announcements (PR #1305)
- `ak config` opens native Wails window (PR #139)
- Adopt official AgentKit icon across desktop + dashboard (PR #174)
- Onboarding gate by app license
- First-run local analytics setup (PR #1148)
- Hook diagnostics parity (PR #131)
- Project config parity for `ak config` (PR #133)
- Windows startup failure diagnosis (PR #1471)
- Windows VERSIONINFO injection (PR #1485)
- Windowless launch failure surfacing (PR #1383)
- Launch installed desktop app or guide to website when GUI not linked (PR #1400)
- Windows amd64 code-signing hardening (PR #1535)

## Constraints

- Beta and Stable channels stay in shape parity (`pnpm check:quality` route
  shape passes).
- No hand-edit of `content/docs/stable/**`. Fix Beta, promote.
- All artifact rows carry SHA-256 verified against the release page. No
  placeholder or "TBD" hashes get committed.
- Screenshots follow the manifest in `public/gui/README.md`: viewport,
  theme, state, redaction rules.

## Non-goals

- Adding new sub-pages beyond what the Desktop section already publishes,
  unless a v2.11.0 feature genuinely opens a new user-facing surface with
  no existing page (for example, a dedicated Trust Center page). Prefer
  updating existing pages first.
- Documenting internal Wails developer-mode workflows. Desktop docs are
  for end-users.

## Scope — three layers, three phases

### A. Version and artifact bump

Files to edit under `content/docs/beta/desktop-app/` (each with `.en.mdx`
and `.vi.mdx` twin):

- `installation` — artifact table (v2.11.0 filenames, bytes, SHA-256 from
  the release page), download URLs, description frontmatter.
- `index` — "Supported v2.7.0 packages" heading, arch-limitation
  paragraph, download-URL reference.
- `updating` — paired-update table version column, opt-in claim if it
  still holds in v2.11.0 (verify against `in-app update banner` behavior
  from PR #170).
- `troubleshooting` — arch symptom row, artifact preservation guidance.
- `getting-started` — "Kit catalog used by Desktop vX" version reference.

Mirror the same edits into `content/docs/stable/desktop-app/**`.

Do **not** bump a version reference next to a behavior claim without
verifying the behavior still holds. Prefer leaving the claim + version
paired until phase B lands.

### B. Feature and behavior authoring

New or rewritten sections needed for v2.11.0. Route through the
`ak-docs-release-update` SKILL: coverage-gap V0 with `--audit-source`
listing these claims, owner approval, V1 authoring.

Candidates:

1. **In-app updater** — new page or section inside `updating.mdx`
   describing the update banner surfaced from PR #170. Cover: how it
   detects new releases, opt-in vs opt-out semantics, offline fallback,
   comparison with CLI `ak self-update`.
2. **Native Wails MCP bridge** — either a section inside
   `interface-overview.mdx` or a new sub-page describing how MCP servers
   integrate through the Wails-embedded bridge, and how it differs from
   CLI-level `ak mcp`.
3. **Trust center** — from PR #463 MVP. Cover which trust decisions the
   Desktop app tracks, where they persist, and how to review them.
4. **In-app announcements** — from PR #1305. Cover what appears, source
   authority, dismiss semantics, offline behavior.
5. **`ak config` native Wails window** — from PR #139. Update
   `settings-and-system.mdx` and the CLI `ak config` reference cross-link
   so the two agree.
6. **First-run analytics setup** — from PR #1148. New section in
   `getting-started.mdx` or `settings-and-system.mdx`.
7. **Windows startup diagnostics** — from PR #1471. Update
   `troubleshooting.mdx` with new symptoms + resolution paths.

Each candidate needs a source anchor (release-note PR link) plus a
behavior anchor (running Desktop binary observation or upstream doc).

### C. Screenshots

Public assets under `public/gui/*.webp`. Refresh required for any panel
whose visual layout changed:

- Dashboard (rebuilt shell)
- Sessions list
- Projects list
- Kits install wizard (if UI changed)
- Migrate wizard
- Settings pages
- Trust center (new)
- In-app announcements (new)

Follow `public/gui/README.md` for capture spec. Optimize with the pipeline
described there.

## Phases

1. **Evidence collection** — download v2.11.0 (and v2.11.0-beta.1)
   Desktop artifacts, verify hashes, produce a table for phase A.
2. **Phase A — artifact bump** — edit installation/index/updating tables
   and version-labeled headings. Keep behavior claims un-bumped where
   the current release's behavior is not verified.
3. **Phase B — feature authoring** — coverage-gap V0 with the
   seven candidate claims above, owner approval, V1 authoring EN+VI.
4. **Phase C — screenshots** — capture from a running v2.11.0 Desktop
   build following the manifest, replace `public/gui/*.webp`.
5. **Validation + PR** — `pnpm test`, `check:quality`, `check:links`,
   local Beta+Stable smoke on the affected pages.
6. **Remove the callout** — drop the "verified against v2.7.0" callout
   from `desktop-app/index.{en,vi}.mdx` once behavior claims are
   updated.

## Acceptance

- No `v2.7.0` references remain under `content/docs/{beta,stable}/desktop-app/**`.
- Every artifact SHA-256 in installation tables matches the release page.
- Feature sections for the seven candidates land with source and
  behavior anchors recorded in the PR body.
- Screenshots regenerated for every panel whose visuals shifted.
- `pnpm check:quality`, `pnpm check:links`, and route-shape parity pass
  after the changes.
- Callout removed from `desktop-app/index.{en,vi}.mdx`.

## Blockers before start

- **Desktop binary.** Phase B and C need a running Desktop v2.11.0 to
  verify behavior and capture screenshots. Confirm the maintainer can
  run all four supported platforms (macOS Intel, macOS Apple silicon,
  Linux x64, Windows x64) or scope to what a single-host maintainer can
  cover.
- **Trust center scope.** PR #463 is an MVP; the shipped v2.11.0
  surface may be narrower than the design. Verify the actual page or
  section available before authoring.

## Related tracks

- Docs-bundle contract v2
  ([plans/260808-1737-docs-bundle-contract-v2-kit-inventory/plan.md](../260808-1737-docs-bundle-contract-v2-kit-inventory/plan.md))
  would let a future bundle carry Desktop artifact digests and version so
  V0 can flag Desktop drift automatically. Consider adding
  `desktop/inventory.json` to that contract's phase 1 scope.

## Open questions

1. Should Beta channel Desktop docs reference `v2.11.0-beta.1_*.zip`
   artifacts (matching Beta channel context) or `v2.11.0_*.zip`
   (recommending the stable Desktop even from Beta docs)? Whole-copy
   promotion argues for a single answer across channels.
2. Which behavior claims from the current v2.7.0 content are still true
   in v2.11.0 and can be salvaged, versus which need a full rewrite?
   Compile a claim-by-claim inventory before starting phase B.
3. Does the Desktop app now launch Kit skills or agent runs (contradicting
   the current "does not launch a Kit skill" claims)? PR #1221's rebuild
   scope needs an explicit verify.
