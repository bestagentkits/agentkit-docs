---
status: "proposed"
date: 2026-07-20
decision-makers: [kaitranntt]
---

# ADR 0035 — Release-time docs-bundle generation for the docs site

> **Draft proposal, authored in the `ak-docs` repo. Not yet submitted to `ak-cli`.**
> This is the one `ak-cli`-side piece the docs pipeline needs. It is delivered for
> a yes/no decision — no code is merged into `ak-cli` without sign-off. Numbering
> (`0035`) is provisional; confirm the next free number when filing.

## Context and Problem Statement

The official docs site (`ak-docs`, static Fumadocs on Cloudflare Pages) publishes
a per-command CLI reference that must match the released `ak` binary exactly. The
`ak-docs` release-sync pipeline is already built and validated end-to-end against
hand-built fixtures: given a `docs-bundle.tar.gz` for a tag, it ingests beta
releases by direct commit and promotes stable releases via PR. The only missing
piece lives on the `ak-cli` side: **who produces and publishes that bundle at
release time?**

Today the in-repo `docs/reference/cli-command-index.md` is hand-maintained and
already drifts from the real command surface. A generated projection of the
command tree — exactly what `gen-man` already does for man pages — removes that
drift by construction.

How should `ak-cli` publish the docs artifact without adding docs-specific
machinery that CLAUDE.md §1.2 forbids?

## Decision Drivers

- **Zero drift**: the reference must be a mechanical projection of the one command
  tree (`cmdtree.BuildWithMetadata`), like man pages — never hand-edited.
- **Exact-SHA provenance**: each published bundle is tied to a tag + commit SHA,
  consistent with ADR 0033 (exact-SHA provenance) and ADR 0019 (release-artifact
  signing posture).
- **CLAUDE.md §1.2 ("Documentation truth maintenance")** explicitly bans creating
  "a documentation-specific CI gate, checker, generator, bot, or scheduled job"
  inside `ak-cli`. The word *generator* is named. Any proposal must win on merits,
  not lawyering: the artifact must be release output, and no docs consumer may
  gate or dirty an `ak-cli` release.
- **Promotion parity**: stable is promotion-only (ADR 0034); the docs bundle must
  carry `promotedFrom` on stable so `ak-docs` can whole-copy the exact beta docs
  state that matched the promoted binary.

## Considered Options

1. **Release-time `gen-docs` + `docs-bundle` asset + dispatch** (proposed).
2. **`ak-docs` polls GitHub Releases, downloads the binary, extracts help** — no
   `ak-cli` change, but slower, loses MDX frontmatter fidelity and manifest
   metadata (the pipeline's Phase-6 fallback).
3. **Keep hand-maintaining `cli-command-index.md`** — rejected: it already drifts,
   which is the whole problem.

## Decision Outcome

Chosen option: **Option 1**. At release time `ak-cli` runs a new `gen-docs` command
(sibling of `gen-man`), packs its output plus channel release notes and a manifest
into `docs-bundle.tar.gz`, uploads it as a release asset, and fires a
`repository_dispatch` at `ak-docs`. The bundle job is **fire-and-forget**: it adds
no docs gate/checker/bot inside `ak-cli`, and an `ak-docs` failure never blocks or
dirties an `ak-cli` release. This is a release *artifact* (like `gen-man`), which
is why it does not fall under the §1.2 prohibition on docs *machinery*: the only
automation consumers live in `ak-docs`.

### The as-built contract (`ak-docs` already implements and parses this — v1)

Release asset `docs-bundle.tar.gz`:

```
manifest.json      # { schemaVersion: 1, channel: "beta"|"stable", tag, sha,
                   #   version, generatedAt, promotedFrom? }   ← promotedFrom on stable only
reference/cli/     # MDX from cobra doc.GenMarkdownTreeCustom
                   #   frontmatter: title, description, generated: true
release-notes.md   # GoReleaser changelog (beta) / stable release-notes output
```

`repository_dispatch` → `ak-docs`:
`event_type: "release-docs"`, `client_payload: { channel, tag, sha }` (trigger only;
`ak-docs` re-downloads the asset and trusts the manifest). `generatedAt` is stamped
by `ak-cli` and reused verbatim by `ak-docs`, which is what makes re-syncing a tag
idempotent — do not use a fresh clock read per pack.

### Consequences

- Good: the CLI reference can never drift — it is the command tree, same guarantee
  as man pages.
- Good: `ak-cli` gains one small command + one release job + one scoped secret; no
  docs gate, no bot, no scheduled job inside `ak-cli`.
- Good: `ak-docs` is already fixture-validated against this exact contract, so the
  bundle job is the last mile, not a leap of faith.
- Bad / accepted: a new outbound token (dispatch to `ak-docs`) and a new asset in
  each release. Both are narrow and revocable.

### Confirmation

`ak-cli`-side: a `main_test.go` for `gen-docs` (mirroring `gen-man`'s) asserts the
top-level page is non-empty and frontmatter is present — the same silent-regression
guard `gen-man` uses. No docs CI gate is added.

## More Information

- Consuming pipeline, scripts, and fixtures: `ak-docs` `README.md` → "Release sync
  pipeline"; contract parser `scripts/lib/manifest.mjs`.
- Related: ADR 0019 (release-artifact signing), ADR 0033 (exact-SHA provenance),
  ADR 0034 (promotion-only stable).
- **Fallback if rejected**: activate Option 2 in `ak-docs` (cron polls releases,
  runs the binary to extract reference). The pipeline degrades (no MDX frontmatter
  fidelity, no manifest metadata) but does not die, and nothing built in `ak-docs`
  is wasted.

---

## Appendix — reference implementation sketch (NOT a PR)

Marked "sketch" so the owner can estimate review cost. Mirrors `gen-man`'s
structure one-to-one.

### `apps/cli/cmd/gen-docs/main.go` (outline)

```go
// Command gen-docs writes MDX reference pages for ak and every subcommand,
// mirroring gen-man. Output feeds the ak-docs docs-bundle; never hand-edited.
package main

func generate(outDir, version string) error {
    os.MkdirAll(outDir, 0o750)
    root := cmdtree.BuildWithMetadata(cmdtree.Metadata{Version: version})
    root.DisableAutoGenTag = true

    // MDX frontmatter per page; site-relative links between commands.
    filePrepender := func(filename string) string {
        name := strings.TrimSuffix(filepath.Base(filename), ".mdx")     // e.g. "ak_kit_init"
        cmd := strings.ReplaceAll(name, "_", " ")                        // "ak kit init"
        return fmt.Sprintf("---\ntitle: %s\ndescription: %s\ngenerated: true\n---\n\n",
            cmd, /* short description looked up from the command */ "")
    }
    linkHandler := func(name string) string {                            // "ak_kit.md" → "./ak_kit"
        return "./" + strings.TrimSuffix(name, filepath.Ext(name))
    }
    if err := doc.GenMarkdownTreeCustom(root, outDir, filePrepender, linkHandler); err != nil {
        return fmt.Errorf("generate markdown tree: %w", err)
    }
    // Same non-empty sanity check as gen-man (fail loud on emitter regression).
    ...
}
```

`GenMarkdownTreeCustom` emits `.md`; either write `.mdx` names or rename in the
pack step — `ak-docs` treats the reference dir as EN-only default-locale content.

### Release-workflow job (sketch)

Added to the beta release workflow (`auto-semver-release.yml`) and the stable
release workflow. Runs after the binaries are built:

```yaml
  docs-bundle:
    needs: [release]
    runs-on: ubuntu-latest
    steps:
      - run: go run ./apps/cli/cmd/gen-docs --out dist/docs/reference/cli --version "${TAG#v}"
      - run: |
          # collect channel release notes → dist/docs/release-notes.md
          # write dist/docs/manifest.json (schemaVersion 1; promotedFrom on stable)
          tar -czf docs-bundle.tar.gz -C dist/docs .
      - run: gh release upload "$TAG" docs-bundle.tar.gz
      - run: |
          gh api repos/bestagentkits/agentkit-docs/dispatches \
            -f event_type=release-docs \
            -F 'client_payload[channel]='"$CHANNEL" \
            -F 'client_payload[tag]='"$TAG" \
            -F 'client_payload[sha]='"$GITHUB_SHA"
        env:
          GH_TOKEN: ${{ secrets.AK_DOCS_DISPATCH_TOKEN }}   # repo:ak-docs dispatch scope only
```

### Cost estimate

- One new command (`gen-docs`, ~size of `gen-man`) + one `main_test.go`.
- One release-workflow job per channel.
- One new secret: `AK_DOCS_DISPATCH_TOKEN`, scoped to dispatch `ak-docs` only.
