# Audit-gap detection

The orchestrator decides `from-ref` before invoking V0. Detection is
deterministic and based on the git `audit/*` tag trail.

## Decision tree

```text
Given: channels.beta.tag = X   (current beta channel)
       channels.stable.tag = Y (current stable)
       promotedFrom of stable = Ysource

Fetch: git fetch origin 'refs/tags/audit/*'

If tag audit/X exists on either local or origin:
    → previous V0 passed at X.
    → Default: single-hop (from-ref = X).
    → Reason: "Audit trail intact through channels.beta.tag."

Else:
    → V0 not confirmed at X. Drift may have accumulated since Ysource.
    → Default: catchup (from-ref = Ysource).
    → Reason: "audit/X missing. Recommending catchup from source of current stable."

If channels.beta.tag never existed (fresh channels.json):
    → No prior state. Ask owner for --from explicitly.
    → Abort with clear guidance.

Regardless: present the interpretation to the owner and require confirm.
```

## Prompt template

```
Detected state:
  channels.beta.tag         = X
  channels.stable.tag       = Y (promotedFrom Ysource)
  audit/X tag on origin     = { MISSING | present at <sha> }
  latest audit tag on origin= audit/<latest> at <sha>

Interpretation:
  { "Audit trail intact — safe to single-hop from X."
  | "Audit gap detected — recommend catchup from Ysource." }

Proposed:
  --from-ref <chosen>
  --to-ref   <requested tag>

Proceed as: [ single | catchup | cancel ] or reply with explicit --from <ref>.
```

## Idempotency guarantees

- Running the orchestrator twice with the same input on the same repo
  state must produce the same detection output.
- Tag detection uses `git tag -l 'audit/*'` after `git fetch --tags
  origin`; it never falls back to `plans/releases/` because that
  directory is local-only.
- If the audit trail on origin lags behind local (e.g., orchestrator
  created a tag but did not push yet), the orchestrator surfaces the
  discrepancy in the prompt and asks the owner to push before
  proceeding.

## Post-merge tag creation

After a beta sync PR merges into `dev`, the orchestrator creates
`audit/<beta-tag>` at the merged commit and pushes it. Behavior:

- **Manual invocation** — run
  `scripts/create-audit-tag.sh <beta-tag> <merged-sha>` under the
  skill; it verifies the merged commit contains `channels.beta.tag ===
  <beta-tag>` and refuses otherwise.
- **Automatic invocation** — the orchestrator's post-PR step performs
  the same check and pushes the tag when the PR is confirmed merged.

Stable promote PRs do not create their own audit tag; the `docs/<tag>`
tag already fills that role for stable channel bindings.

## Failure recovery

| Situation | Recovery |
| --- | --- |
| Owner cancels the run | No tag created. Detection re-fires on next invocation with the same result. |
| V0 approval never granted | No tag created. Owner can retry with a different `--from` or skip. |
| PR merges but tag creation fails (network, permission) | Owner or a maintainer re-runs `scripts/create-audit-tag.sh` manually with the merged SHA. |
| Wrong audit tag was pushed (e.g., stale, or wrong beta commit) | Overwrite with `git tag -f audit/<beta-tag> <correct-sha>` and `git push --force origin refs/tags/audit/<beta-tag>`. Log the reason in the next PR body. |

## Interaction with promote-docs

Stable promote runs are independent of audit detection — they bind
`docs/<promotedFrom>` and rely on it. The orchestrator's stable path:

1. Verify `channels.beta.tag === promotedFrom`.
2. Verify `docs/<promotedFrom>` exists and points at a commit whose
   `channels.beta.tag === promotedFrom`. Force-update the tag when the
   beta sync PR has landed at a newer commit than the previous tag
   target.
3. Run `promote-docs.mjs` against the stable bundle.
4. Open the promote PR.

The stable pipeline does not create a new `audit/*` tag; it consumes
the beta channel's audit-verified snapshot.
