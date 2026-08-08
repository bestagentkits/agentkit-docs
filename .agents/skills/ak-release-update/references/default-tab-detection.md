# Default-tab drift detection

Default tab covers `content/docs/beta/{getting-started, guides, concepts,
troubleshooting, changelog}`. V0 rarely flags these pages because the
bundle contract does not carry them, so the orchestrator runs its own
diff-first classifier to spot drift.

## Detection flow

```text
1. Diff bundle release-notes.md between from and to.
2. Extract new PR entries as (prefix, subject, PR-URL) tuples.
3. Route each tuple by prefix.
4. For Default-tab-routed entries, grep meaningful phrases across the
   Default-tab pages.
5. If (phrase-matches ≥ threshold) AND (files ≥ threshold), flag the
   candidate for owner review.
```

Diff is the primary evidence — release-notes.md is a full-history
document in beta bundles, but the diff between two beta bundles is
exactly the new PR delta. Do not grep the whole `release-notes.md`;
grep only the diff-derived new entries.

## Prefix routing

Map from commit-message prefix to Default-tab focus:

| Prefix | Focus |
| --- | --- |
| `docs:` | Any Default-tab page whose topic matches the PR subject. |
| `config:` | `troubleshooting/configuration.mdx`, `getting-started/onboarding.mdx`. |
| `hooks:` (non-Kit) | `troubleshooting/configuration.mdx`, `concepts/*hooks*`. |
| `onboarding:` | `getting-started/onboarding.mdx`. |
| `analytics:` | `guides/*analytics*`, `settings-and-system.mdx` (Desktop touch too). |
| `install:` | `getting-started/installation.mdx`. |
| `dashboard:` | `settings-and-system.mdx` (Desktop) + `guides/*dashboard*` if any. |
| `plancmd:`, `plan-state:` | `troubleshooting/*plan*`, plus CLI reference (routed there in V0). |
| `migrate:` | `guides/*migrating*`. |
| `perf:`, `ci:`, `release:`, `tooling:`, `maintainer:` | Skip — no user-facing docs impact. |

Any prefix not in this table falls through as `unclassified`; log the
tuple for owner review at end of run.

## Phrase extraction

For each Default-tab candidate PR, extract three signals:

1. **Feature name** — noun phrases in the PR subject
   (e.g., "in-app updater", "trust center", "first-run analytics").
2. **Config key** — quoted or backtick-fenced strings that look like
   config keys (e.g., `journal.auto`, `hooks.simplify-gate`,
   `AGENTKIT_HOME`).
3. **Command reference** — `ak <subcommand>` or `/ak:<slug>` fragments.

Skip phrases shorter than 3 characters or contained in a shipped
stop-word list (`the`, `and`, `for`, `with`, `into`, `over`, `run`,
`use`, `add`).

## Threshold gates

Semi-auto owner-gate. Default thresholds:

- **Phrase gate**: ≥ 3 unique phrases from the extraction step must
  appear in the Default-tab pages combined.
- **File gate**: matched phrases must span ≥ 3 distinct pages.
- **Breaking override**: any PR whose entry text contains
  `BREAKING:`, `⚠ breaking`, or `⚠️ breaking` bypasses both gates
  and triggers owner review directly.

Both thresholds must trip before the orchestrator prompts. Otherwise
skip the Default-tab pass silently and log "no drift above threshold"
in the PR body.

## Owner prompt

When thresholds trip:

```text
Default-tab drift candidates from <from-ref> → <to-ref>:

  PR #1523 (docs: <subject>) — matches:
    - troubleshooting/configuration.mdx: journal.auto (2 hits)
    - guides/updating.mdx: journal.auto (1 hit)

  PR #1147 (analytics: <subject>) — matches:
    - guides/installing-kits.mdx: first-run analytics (1 hit)
    - troubleshooting/configuration.mdx: analytics setup (1 hit)

Compile refresh for these pages under owner-directed scope?

Reply:
  approve REQ-<id> paths <list>   — refresh subset
  approve REQ-<id> all             — refresh every candidate
  skip                             — defer to a follow-up PR
```

Owner reply becomes evidence appended to the V0 approval-request.

## No false positive tolerance

The Default-tab classifier is the loosest branch of the orchestrator's
detection because its ground truth is text similarity rather than
byte-level diff. Prefer false negatives (miss a Default-tab candidate,
catch it in a later run) over false positives (refresh a page that did
not need it and introduce prose drift). If the phrase extractor
becomes noisy, tighten thresholds or add stop-words rather than
loosening validation.

## Verification after refresh

For each Default-tab page refreshed, run:

- `pnpm lint` on the changed file (MDX remark-lint).
- `pnpm check:links` on the built output.
- Local beta smoke of the refreshed route via `pnpm exec serve out`
  and a manual read-through.

Owner reviews the diff in the PR before merging as an extra guard.
