# Proposal: publish a `docs-bundle` release artifact for the docs site

> Condensed issue body for delivery to the `ak-cli` owner. Deliver as an issue in
> `ak-cli` **or** a direct conversation — the owner's preference. Do NOT open an
> unsolicited PR against `ak-cli`. Full rationale + implementation sketch:
> [`ak-cli-gen-docs-adr-draft.md`](./ak-cli-gen-docs-adr-draft.md).

## Ask (yes/no)

Add one `ak-cli`-side piece so `docs.agentkit.best` can auto-sync the CLI
reference from releases:

1. A `gen-docs` command — sibling of the existing `gen-man`, same
   `cmdtree.BuildWithMetadata` walk, emitting MDX via cobra
   `GenMarkdownTreeCustom` (frontmatter `title`/`description`/`generated: true`).
2. A release-workflow job that runs `gen-docs`, collects channel release notes,
   writes `manifest.json`, packs `docs-bundle.tar.gz`, uploads it as a release
   asset, and fires a `repository_dispatch` (`release-docs`) at `ak-docs`.

Explicitly **not** proposed: any docs check, gate, lint, bot, or scheduled job
inside `ak-cli`. The bundle job is fire-and-forget — an `ak-docs` failure never
blocks or dirties an `ak-cli` release.

## Why release-time generation

The hand-maintained `docs/reference/cli-command-index.md` already drifts from the
real command surface. A generated projection removes drift by construction —
mechanically identical to what `gen-man` already does for man pages.

## CLAUDE.md §1.2

§1.2 bans a docs-specific *generator/gate/bot/scheduled job* inside `ak-cli`. This
is framed deliberately as a release **artifact** (like `gen-man` output) with
exact-SHA provenance (ADR 0033), whose only automation consumers live in
`ak-docs`. If the owner reads §1.2 as blocking even a release artifact, we fall
back (below) with zero `ak-cli` changes.

## Evidence

The `ak-docs` pipeline is **already built and validated end-to-end against
hand-built fixtures** matching this exact contract (schemaVersion 1): beta ingest,
idempotent re-sync, and stable promotion (whole-copy from the beta docs tag) all
pass `node --test` + a fixture dry-run. This proposal is the last mile, not a
leap of faith.

## Cost

One new command (~`gen-man`-sized) + `main_test.go`; one release job per channel;
one dispatch-scoped secret (`AK_DOCS_DISPATCH_TOKEN`).

## Fallback if rejected

`ak-docs` cron-polls GitHub Releases, downloads the released binary, and extracts
the reference by running it. Slower, loses MDX frontmatter fidelity and manifest
metadata, **zero `ak-cli` changes**. Pipeline degrades, does not die.

## Decision

- [ ] **Accept** → schedule the `ak-cli` implementation as its own work item.
- [ ] **Accept with contract changes** → note them; `schemaVersion` + isolated
      parsing keep it a contained change on the `ak-docs` side.
- [ ] **Reject** → `ak-docs` activates the polling fallback.

_Record the decision back in the `ak-docs` plan (Phase 6) once made._
