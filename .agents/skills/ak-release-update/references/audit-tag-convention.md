# `audit/*` tag convention

The `audit/*` tag namespace is the persistent audit trail the orchestrator
uses to reason about whether a beta channel state has been audited
through V0. Design goals: cross-machine visible, cheap to create, no
schema churn on `channels.json`.

## Naming

```text
audit/<exact-beta-tag>
```

Examples:

- `audit/v2.11.0-beta.1`
- `audit/v2.12.0-beta.3`
- `audit/v3.0.0-beta.1`

The tag name is the exact beta tag whose sync PR merged with an
approved V0 evidence chain. Stable tags do not get `audit/*` — the
`docs/<promotedFrom>` tag already carries the "stable snapshot bound"
meaning, and stable promote inherits the beta's audit lineage.

## Semantics

`audit/<X>` at commit `<sha>` asserts:

1. The V0 evidence for `<X>` was reviewed and approved by the owner.
2. Any V1 authoring authorized under that approval landed in `<sha>`.
3. The deterministic beta sync (`sync-release.mjs --bundle …`) was
   applied at `<sha>`.
4. Validation (test, typecheck, lint, catalog, reference, build,
   quality, links) passed at `<sha>`.

Missing `audit/<X>` when `channels.beta.tag === X` means at least one
of the above is unverified. The orchestrator therefore recommends
multi-hop catchup on the next invocation.

## Creation

Creation happens once per beta cycle, after PR merge to `dev`.

- Preferred: run
  `.agents/skills/ak-release-update/scripts/create-audit-tag.sh
  <beta-tag> <merged-sha>`. The script verifies
  `git show <sha>:channels.json | jq -r .beta.tag` equals `<beta-tag>`
  and refuses otherwise.
- Falls back to manual `git tag audit/<X> <sha> && git push origin
  refs/tags/audit/<X>` when the script is not available.
- Force-update only when the previous tag pointed at a stale commit
  (e.g., a subsequent catchup PR landed and the audit lineage moved).
  Use `git push --force origin refs/tags/audit/<X>` and note the
  reason in the follow-up PR body.

## Backfill

When adopting the convention on an existing repo, backfill tags for
prior beta releases as needed. Backfilling requires evidence that the
sync PR at that tag met the four semantic criteria above. If evidence
is incomplete, do not backfill — leave the gap and the next
orchestrator run will treat it as multi-hop.

`v2.11.0-beta.1` was backfilled at the PR #40 merge commit as the
seed of the trail.

## Retirement

Tags are permanent. Even after a stable promote consumes the audit
lineage, the tag stays on the repo. Historical readers can walk the
trail: `git tag -l 'audit/*' --sort=-taggerdate` returns the audit
history newest-first.

Delete or rewrite an audit tag only when the underlying audit was
retracted (invalid approval, evidence corruption). Log the retraction
in `docs/workflows/release-and-deploy.md` or a follow-up decision
record so future maintainers know why the tag moved.

## Relationship with `docs/*`

- `docs/<beta-tag>` (existing) — binds a beta docs snapshot for stable
  promotion. The tag guarantees the referenced commit contains
  `channels.json.beta.tag === <beta-tag>`.
- `audit/<beta-tag>` (new) — asserts the V0 audit trail passed at
  that snapshot.

The two tags may point at different commits. Common patterns:

- Beta sync PR merges → orchestrator creates both `docs/<beta-tag>`
  and `audit/<beta-tag>` at the merge commit.
- Later catchup PR merges into `dev` on top of the beta sync →
  orchestrator force-updates `docs/<beta-tag>` to the new commit (so
  stable promote binds the latest verified snapshot) and leaves
  `audit/<beta-tag>` alone unless the catchup itself changed the beta
  channel's audit state.

## Grepping the trail

```bash
# Latest audit tags on origin
git ls-remote --tags origin 'refs/tags/audit/*' | sort -t/ -k4 -V

# All audit tags with commit summary
for t in $(git tag -l 'audit/*'); do
  printf '%-30s %s\n' "$t" "$(git log -1 --pretty='%h %s' "$t")"
done

# Verify a tag matches its beta channel content
git show 'audit/v2.11.0-beta.1':channels.json | jq -r .beta.tag
# Expected: v2.11.0-beta.1
```
