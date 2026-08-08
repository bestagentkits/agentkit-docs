# Invocation syntax

`ak:release-update` accepts one of three invocation shapes plus a common
option set.

## Shapes

### Single release

```text
/ak:release-update --tag <exact-tag>
```

Channel inferred from the tag suffix:

- `-beta.N` suffix → beta sync path.
- No `-beta.N` suffix → stable promote path.

### Pair release

```text
/ak:release-update --beta <beta-tag> --stable <stable-tag>
```

Runs the beta sync PR first, waits for merge, then runs the stable
promote PR. The two are opened as separate PRs; the orchestrator waits
between them so the audit trail seals correctly.

### Explicit override

```text
/ak:release-update --tag <exact-tag> --channel beta|stable
```

Force a channel when tag suffix inference is wrong (rare — e.g., a
maintainer-cut tag that violates the naming convention).

## Options

| Flag | Semantics | Default |
| --- | --- | --- |
| `--from <ref>` | Set the V0 `from-ref` explicitly. Bypasses audit-tag detection. | Auto: `channels.beta.tag` if `audit/<beta-tag>` exists, otherwise `promotedFrom` of current stable. |
| `--catchup` | Shortcut for `--from <promotedFrom-of-current-stable>`. Force multi-hop audit. | Off |
| `--no-audit-check` | Skip audit-gap detection; default single-hop. Logs a warning in the PR body. | Off |
| `--dry-run` | Print the pipeline plan (refs, checks, target paths) without invoking any script. | Off |
| `--yes` | Skip owner confirmation prompts inside the orchestrator (does not skip V0 approval — that remains explicit). | Off |
| `--no-desktop` | Skip Desktop app processing entirely, even Layer A. Use only when the release explicitly does not affect Desktop. | Off |
| `--no-default-tab` | Skip Default-tab phrase-based drift scan. Use when release notes are noisy. | Off |

## Examples

```bash
# Normal beta sync when a previous audit exists
/ak:release-update --tag v2.12.0-beta.1

# Multi-hop catch-up after a period without audit passes
/ak:release-update --tag v2.12.0-beta.1 --catchup

# Explicit from-ref (override auto-detect)
/ak:release-update --tag v2.12.0-beta.1 --from v2.10.0-beta.1

# Both channels of a same-day release in one command
/ak:release-update --beta v2.12.0-beta.1 --stable v2.12.0

# Force-skip audit-tag detection (rare)
/ak:release-update --tag v2.12.0-beta.1 --no-audit-check

# See the plan without doing anything
/ak:release-update --tag v2.12.0-beta.1 --dry-run
```

## Error paths

| Condition | Behavior |
| --- | --- |
| `--tag` and `--beta` both supplied | Reject; ask for a single invocation shape. |
| `--from` and `--catchup` both supplied | Reject; ambiguous intent. |
| `--tag <tag>` matches `channels.<channel>.tag` already synced | Abort with `already-synced`; suggest `--force` (not defined by default; owner must edit config to allow re-run). |
| Upstream tag not found via `gh api` | Abort with clear error including the API response. |
| Bundle SHA-256 mismatch versus release-page asset digest | Abort with the two hashes; refuse to proceed. |
| `docs/<promotedFrom>` tag missing for stable promote | Abort; instruct owner to run the beta pass first. |
| Owner never replies `approve REQ-…` within pipeline | Session ends cleanly; no writes happen. |

## Owner interactions

Two mandatory prompts. Both must produce an explicit reply — no silent
defaults advance the pipeline.

1. **After audit-gap detection** (step 2 of the pipeline).
   Reply: `single`, `catchup`, or `cancel`. Or reply with explicit refs.
2. **After V0 completes** (step 4 of the pipeline).
   Reply: the exact statement `approve REQ-…` matching the generated
   request ID, optionally followed by the approved nested prose paths.

Every other decision inside the pipeline is deterministic.
