# Desktop app three-layer refresh

The orchestrator splits Desktop drift into three layers because they
have different automation ceilings:

- **Layer A** — packaging metadata refresh (mechanical, always run).
- **Layer B** — feature and behavior authoring (semi-auto, owner-gate).
- **Layer C** — screenshots (out of orchestrator scope — needs the
  Desktop binary).

## Layer A — artifact and version bump

Runs automatically on every release. Deterministic edits from
release-page evidence.

**Detection**: any run whose target `channels.<channel>.tag` differs
from the current stored value triggers Layer A **for that channel only**.
Never touch the other channel's Desktop mdx.

- Beta sync run (updates `channels.beta.tag`) → touch
  `content/docs/beta/desktop-app/**` only.
- Stable promote run (updates `channels.stable.tag`) → touch
  `content/docs/stable/desktop-app/**` only, using the **stable** tag's
  ak-gui assets. `promote-docs.mjs` whole-copies the beta snapshot into
  stable/, which pulls the source beta's `ak-gui_<beta-tag>_*` references
  into stable/desktop-app; re-run Layer A against the final stable tag
  after promote so stable/desktop-app reflects the stable ak-gui build,
  not the beta build.

Do **not** mirror `content/docs/beta/desktop-app/**` into
`content/docs/stable/desktop-app/**` (or vice versa) as a shortcut.
Each channel's Desktop pages track that channel's release, not the
other channel's.

**Evidence source**:

```bash
gh api "repos/bestagentkits/agentkit/releases/tags/<to-tag>" \
  --jq '.assets[] | select(.name | test("ak-gui|docs-bundle")) |
        {name, size, digest}'
```

Verify each digest against the release-page value and the
`.sha256` sidecar downloaded via `gh release download`.

**Files touched** (target channel only, EN + VI):

- `content/docs/<channel>/desktop-app/installation.{en,vi}.mdx`
  — artifact table (filename, bytes, SHA-256), download-URL,
  description frontmatter, opening sentence.
- `content/docs/<channel>/desktop-app/index.{en,vi}.mdx`
  — "Supported v<X> packages" heading, ARM64 limitation paragraph
  (verify current release still lacks Linux/Windows ARM64 packages).
- `content/docs/<channel>/desktop-app/updating.{en,vi}.mdx`
  — paired-update version column labels.
- `content/docs/<channel>/desktop-app/troubleshooting.{en,vi}.mdx`
  — artifact filename in shell examples.
- `content/docs/<channel>/desktop-app/getting-started.{en,vi}.mdx`
  — version reference next to Kit-catalog mention.
- `content/docs/<channel>/troubleshooting/kit-installation.{en,vi}.mdx`
  — CLI version reference (companion to Desktop pages).

**Callout hygiene**: if the Desktop `index.mdx` carries a "verified
against v<older>" warning callout from a previous run, replace it
with an `info` callout stating the new verified version. If Layer B
is also compiled in the same PR and the behavior claims are
refreshed, drop the callout entirely.

## Layer B — feature and behavior authoring

Runs semi-automatically with an owner gate. Compiles new sections
from release-note evidence.

**Detection** — run all three arms. The prefix arm alone has already missed a
Desktop change in production, so a zero prefix match is not a Layer B clearance.

1. Diff bundle `release-notes.md` between from and to (see
   [`default-tab-detection.md`](default-tab-detection.md)). For a minor or major
   version bump the generator restarts the notes from the beginning of the
   project, so that diff is a full-history dump and useless as a delta — take
   the window from
   `gh api repos/<owner>/<repo>/compare/<from-sha>...<to-sha>` instead.
2. **Prefix arm.** Filter new entries by prefix: `desktop:`, `gui:`, `gui-api:`,
   `wails:`, `ui:`, `branding:`, `onboarding:`, `dashboard:`, and `analytics:`
   when the subject mentions Desktop keywords.
3. **Subject arm.** Independently of the prefix, match any subject against
   `Desktop`, `ak-gui`, `Wails`, or `GUI`. A generic scope carries Desktop
   changes: `v2.15.0-beta.1` shipped
   `feat(ux): auto-detect and auto-install missing Node.js for Desktop App and CLI`,
   which no Desktop prefix matched.
   `scripts/classify-pr-prefix.sh` applies this override for you.
4. **Changed-path arm.** Scan the compare window for changed files under
   `apps/cli/internal/gui/**`, `apps/cli/frontend/**`, or
   `apps/cli/internal/wails/**`. Any hit is a Desktop-facing change regardless
   of how the commit was scoped.
5. Count matched entries from the union of the three arms.

**Threshold gates**:

- **PR gate**: ≥ 3 matched entries.
- **Breaking override**: any matched entry containing `BREAKING:` or
  `⚠ breaking` triggers the gate regardless of count.

**Owner prompt** when gates trip:

```text
Desktop-tagged PRs between <from-ref> → <to-ref>:

  #1221  ui: Rebuild the desktop app on the approved prototype
  #170   release: Cross-platform native app builds + in-app update banner
  #463   desktop: Add trust center MVP
  #139   cli: Ak config opens native Wails window
  #1471  gui: Diagnose Windows startup failures
  …

Compile Layer B refresh for these features?

Candidate authoring targets:
  - guides/updating.mdx           — in-app updater section
  - concepts/*bridge*             — native Wails MCP bridge
  - troubleshooting/*             — Windows startup diagnostics
  - settings-and-system.mdx       — ak config native window
  - <new>  trust-center.mdx?     — trust center MVP

Reply:
  approve REQ-<id> layer-b paths <list>
  skip                              — defer Layer B; keep callout
```

**Authoring rules**:

- Each new or edited section carries an evidence anchor — either an
  HTML comment or a bullet in the PR body — citing the source PR
  number.
- Do not invent behavior beyond what release-note text supports.
- When evidence is only a PR title (no accessible body), mark the
  new prose with an inline `{/* verify-against-binary */}` marker;
  the follow-up Layer C reviewer removes it after visual verify.
- EN + VI parity. Technical tokens (`ak config`, `Wails`, `MCP`,
  `journal.auto`) unchanged.

## Layer C — screenshots

Out of orchestrator scope.

**Reason**: Requires the target Desktop binary running on each
supported platform (macOS Intel, macOS Apple silicon, Linux x64,
Windows x64) to capture per `public/gui/README.md`. The orchestrator
cannot boot the binary or run the capture manifest.

**Handoff**: at the end of Layer B, the orchestrator prints:

```text
Layer C deferred. Screenshots in public/gui/ still show earlier
layouts. Recapture per public/gui/README.md when Desktop v<to-tag>
is available on each platform. Track in a follow-up PR.
```

Do not attempt to refresh screenshots by hand or delete stale ones —
missing screenshots break the shipped pages, whereas outdated
screenshots at least keep the pages navigable.

## Post-run state

After Layer A completes:

- Every `ak-gui_*` reference in tables matches the release page for
  the run's target channel.
- No `v<older>` reference remains in that channel's packaging text.
- Callout on `<channel>/desktop-app/index.mdx` reflects the new
  verified version.
- The other channel's `desktop-app/` tree is unchanged.

After Layer B completes (when triggered):

- New feature sections carry evidence anchors.
- `{/* verify-against-binary */}` markers are present where evidence
  is weak.
- PR body enumerates every source PR referenced.

After Layer C completes (in a later follow-up PR):

- `public/gui/*.webp` recaptured for every panel whose layout changed.
- All `{/* verify-against-binary */}` markers removed.
- Any Desktop callout downgraded or removed.
