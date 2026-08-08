#!/usr/bin/env bash
# detect-audit-gap.sh — decide the V0 from-ref for the orchestrator.
#
# Reads channels.json, checks git tag audit/<beta-tag>, and prints a JSON
# report with the recommendation. Exit codes:
#   0 — clean detection, recommendation printed
#   2 — repo state ambiguous (missing channels.json, missing beta.tag, etc.)
#
# Usage:
#   detect-audit-gap.sh [--repo-root <path>] [--to-tag <tag>]
#
# Output (stdout, single-line JSON so callers can `jq`):
#   {
#     "channels": { "beta": "v2.11.0-beta.1", "stable": "v2.11.0",
#                   "promotedFrom": "v2.11.0-beta.1" },
#     "auditTagPresent": true,
#     "auditTagRef": "audit/v2.11.0-beta.1",
#     "recommendation": "single-hop"|"catchup"|"ask",
#     "fromRef": "v2.11.0-beta.1",
#     "reason": "..."
#   }

set -euo pipefail

repo_root=""
to_tag=""

while (( $# )); do
  case "$1" in
    --repo-root) repo_root="$2"; shift 2 ;;
    --to-tag)    to_tag="$2";    shift 2 ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

repo_root="${repo_root:-$(pwd)}"
cd "$repo_root"

if ! [[ -f channels.json ]]; then
  printf 'channels.json missing at %s\n' "$repo_root" >&2
  exit 2
fi

beta_tag=$(jq -r '.beta.tag' channels.json)
stable_tag=$(jq -r '.stable.tag' channels.json)

if [[ -z "$beta_tag" || "$beta_tag" == "null" ]]; then
  printf 'channels.beta.tag missing\n' >&2
  exit 2
fi

# Fetch audit tags from origin so cross-machine state stays consistent.
git fetch --quiet origin 'refs/tags/audit/*:refs/tags/audit/*' 2>/dev/null || true
git fetch --quiet origin 'refs/tags/docs/*:refs/tags/docs/*'   2>/dev/null || true

audit_ref="audit/${beta_tag}"
audit_present="false"
if git rev-parse --verify --quiet "refs/tags/${audit_ref}" >/dev/null; then
  audit_present="true"
fi

promoted_from=""
if [[ -n "$stable_tag" && "$stable_tag" != "null" ]]; then
  # The exact promotedFrom is authoritative from the last stable bundle's
  # manifest; we approximate here from the docs/<tag> naming convention.
  # Callers that already downloaded the stable bundle should override.
  latest_docs_tag=$(git tag -l 'docs/*' --sort=-taggerdate | head -n1 | sed 's|^docs/||')
  promoted_from="${latest_docs_tag}"
fi

recommendation="single-hop"
from_ref="$beta_tag"
reason="Audit trail intact through channels.beta.tag."

if [[ "$audit_present" != "true" ]]; then
  if [[ -n "$promoted_from" ]]; then
    recommendation="catchup"
    from_ref="$promoted_from"
    reason="audit/${beta_tag} missing — recommend catchup from source of current stable."
  else
    recommendation="ask"
    from_ref=""
    reason="audit/${beta_tag} missing and no docs/<tag> present — owner must set --from explicitly."
  fi
fi

jq --null-input --compact-output \
  --arg beta "$beta_tag" \
  --arg stable "$stable_tag" \
  --arg promoted "$promoted_from" \
  --arg auditRef "$audit_ref" \
  --argjson auditPresent "$audit_present" \
  --arg recommendation "$recommendation" \
  --arg fromRef "$from_ref" \
  --arg reason "$reason" \
  --arg toTag "$to_tag" \
  '{
     channels: {
       beta: $beta,
       stable: $stable,
       promotedFrom: $promoted
     },
     auditTagPresent: $auditPresent,
     auditTagRef: $auditRef,
     recommendation: $recommendation,
     fromRef: $fromRef,
     toTag: $toTag,
     reason: $reason
   }'
