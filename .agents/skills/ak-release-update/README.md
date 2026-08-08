# ak:release-update

Orchestrator for the end-to-end AgentKit docs release-update pipeline.
Composes the audit skill (`ak-docs-release-update`), the deterministic
scripts under `scripts/` in the repo root, and the manual passes for
Contract v1 blind spots (CLI prose, Kits, Desktop) into a single owner-
gated flow.

`ak:release-update` does not replace `ak-docs-release-update`. The audit
skill remains the source of truth for evidence, approval, and V1 authoring
guardrails. This orchestrator invokes it at the right steps and never
bypasses its approval gate.

## Quick start

Standard beta sync (audit trail intact):

```bash
/ak:release-update --tag v2.12.0-beta.1
```

Standard stable promote (after the matching beta PR merged):

```bash
/ak:release-update --tag v2.12.0
```

Pair release — beta sync, wait for merge, then stable promote:

```bash
/ak:release-update --beta v2.12.0-beta.1 --stable v2.12.0
```

Multi-hop catch-up (when prior beta sync PRs skipped V0 audit):

```bash
/ak:release-update --tag v2.12.0-beta.1 --catchup
```

Explicit from-ref override:

```bash
/ak:release-update --tag v2.12.0-beta.1 --from v2.10.0-beta.1
```

Dry-run to preview the pipeline plan without invoking scripts:

```bash
/ak:release-update --tag v2.12.0-beta.1 --dry-run
```

## Pipeline in one paragraph

The orchestrator (1) fetches the target upstream tag, downloads and
digest-verifies the docs and kit bundles; (2) reads `channels.json` and
`git tag audit/*` to recommend `from-ref` (single-hop vs catchup); (3)
delegates V0 evidence to `ak-docs-release-update`; (4) stops for the
owner statement `approve REQ-…`; (5) runs the manual passes for CLI
prose (V1 authoring), Kits (skill page authoring + catalog refresh),
and Desktop (Layer A auto, Layer B owner-gate, Layer C skip); (6) runs
`sync-release.mjs` (beta) or `promote-docs.mjs` (stable); (7) runs the
full validation pipeline and opens a normal PR into `dev`. After the PR
merges, it creates and pushes `audit/<beta-tag>` to seed the trail for
the next run.

## When to use which flag

| Situation | Command |
| --- | --- |
| New beta release, previous audit tag present | `--tag <beta-tag>` |
| New stable release, matching beta PR already merged | `--tag <stable-tag>` |
| Both channels shipped same day | `--beta <beta-tag> --stable <stable-tag>` |
| Prior beta syncs shipped without V0 | `--tag <beta-tag> --catchup` |
| Manual override of the audit `from-ref` | `--tag <beta-tag> --from <ref>` |
| Emergency skip of audit-gap detection | `--tag <beta-tag> --no-audit-check` |
| Preview without side effects | `--tag <beta-tag> --dry-run` |
| Skip Desktop entirely (release does not affect Desktop) | append `--no-desktop` |
| Skip Default-tab phrase scan (noisy release notes) | append `--no-default-tab` |

## Owner interactions

Two prompts require an explicit reply. No silent default advances.

1. **After audit-gap detection** — reply `single`, `catchup`, or
   `cancel`, or provide an explicit `--from <ref>`. See
   [`references/detection.md`](references/detection.md).
2. **After V0 completes** — reply with the exact statement
   `approve REQ-…` (matching the generated request ID), optionally
   followed by the approved nested prose paths. See
   [`../ak-docs-release-update/SKILL.md`](../ak-docs-release-update/SKILL.md).

Everything else in the pipeline is deterministic.

## Layout

```
.agents/skills/ak-release-update/
├── SKILL.md                          # Claude-invocation contract, 7-step model
├── README.md                         # This file
├── agents/openai.yaml                # Provider descriptor
├── references/
│   ├── syntax.md                     # CLI flag surface + error paths
│   ├── detection.md                  # Audit-gap decision tree
│   ├── audit-tag-convention.md       # audit/<tag> semantics
│   ├── default-tab-detection.md      # Diff-first classifier for Default tab
│   └── desktop-3-layer.md            # Layer A/B/C refresh model
└── scripts/
    ├── detect-audit-gap.sh           # Recommend from-ref, emit JSON
    ├── create-audit-tag.sh           # Tag beta-sync merge commit
    ├── diff-release-notes.sh         # Extract NDJSON PR entries
    └── classify-pr-prefix.sh         # Route entries to cli/kits/desktop/default/skip
```

Local scripts assume the repo root has `channels.json` and the
deterministic release scripts (`sync-release.mjs`, `promote-docs.mjs`,
`check-docs-release-update.mjs`, `docs-release-manual-approval.mjs`)
already installed. They do not attempt to bootstrap those.

## Thresholds

Default gates:

- **Default-tab phrase gate** — trigger when ≥ 3 phrases from the new
  PR diff match ≥ 3 distinct pages under `content/docs/beta/
  {getting-started, guides, concepts, troubleshooting, changelog}`.
- **Desktop Layer B gate** — trigger when ≥ 3 Desktop-tagged PRs land,
  or any breaking-tagged PR does.

Owner overrides threshold at invocation via `--no-default-tab` /
`--no-desktop`. Do not tighten defaults without evidence — false
negatives are easier to recover from than false positives.

## Failure modes

| Situation | Recovery |
| --- | --- |
| `channels.json` missing / malformed | Refuse; ask owner to fix `channels.json` before rerunning. |
| Bundle SHA-256 mismatch versus release-asset digest | Refuse; owner re-downloads the asset and retries. |
| `docs/<promotedFrom>` tag missing for stable promote | Refuse; run the beta sync PR first so the tag exists. |
| Owner never approves the V0 request | Session ends cleanly; no writes happen; try again later. |
| Post-merge audit-tag push fails | Owner reruns `scripts/create-audit-tag.sh <beta-tag> <merged-sha>` manually. |

## Related

- [`../ak-docs-release-update/SKILL.md`](../ak-docs-release-update/SKILL.md)
  — audit + authoring skill this orchestrator delegates to.
- [`docs/workflows/release-and-deploy.md`](../../../docs/workflows/release-and-deploy.md)
  under "What Beta sync does *not* refresh" — the manual-pass runbook
  the orchestrator mechanizes.
- [`scripts/`](../../../scripts/) at the repo root — deterministic
  bundle handling (`sync-release.mjs`, `promote-docs.mjs`,
  `check-docs-release-update.mjs`, `docs-release-manual-approval.mjs`).
