#!/usr/bin/env bash
# create-audit-tag.sh — tag a merged beta-sync commit as audit/<beta-tag>.
#
# Verifies that the given commit contains channels.json.beta.tag matching
# the provided beta-tag, then creates and pushes the audit tag. Idempotent
# when the tag already points at the same commit; force-updates only when
# --force is passed.
#
# Usage:
#   create-audit-tag.sh <beta-tag> <merged-sha> [--force] [--no-push]
#     [--repo-root <path>]

set -euo pipefail

usage() {
  printf 'usage: create-audit-tag.sh <beta-tag> <merged-sha> [--force] [--no-push] [--repo-root <path>]\n' >&2
  exit 2
}

beta_tag=""
merged_sha=""
force=""
push="1"
repo_root=""

while (( $# )); do
  case "$1" in
    --force)     force="1"; shift ;;
    --no-push)   push="";   shift ;;
    --repo-root) repo_root="$2"; shift 2 ;;
    -h|--help)   usage ;;
    v*|[0-9a-f]*)
      if [[ -z "$beta_tag" ]]; then beta_tag="$1"
      elif [[ -z "$merged_sha" ]]; then merged_sha="$1"
      else printf 'unexpected positional: %s\n' "$1" >&2; exit 2
      fi
      shift ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; usage ;;
  esac
done

[[ -n "$beta_tag" && -n "$merged_sha" ]] || usage

repo_root="${repo_root:-$(pwd)}"
cd "$repo_root"

# Verify the commit exists.
if ! git rev-parse --verify --quiet "${merged_sha}^{commit}" >/dev/null; then
  printf 'commit %s not found\n' "$merged_sha" >&2
  exit 2
fi

# Verify channels.beta.tag at that commit equals the expected tag.
recorded_beta=$(git show "${merged_sha}:channels.json" | jq -r '.beta.tag')
if [[ "$recorded_beta" != "$beta_tag" ]]; then
  printf 'refusing: commit %s has channels.beta.tag=%s, expected %s\n' \
    "$merged_sha" "$recorded_beta" "$beta_tag" >&2
  exit 2
fi

tag_ref="audit/${beta_tag}"

if git rev-parse --verify --quiet "refs/tags/${tag_ref}" >/dev/null; then
  existing=$(git rev-parse "refs/tags/${tag_ref}")
  if [[ "$existing" == "$merged_sha" ]]; then
    printf '%s already at %s (no-op)\n' "$tag_ref" "$merged_sha"
    exit 0
  fi
  if [[ -z "$force" ]]; then
    printf 'refusing: %s points at %s, not %s (pass --force to override)\n' \
      "$tag_ref" "$existing" "$merged_sha" >&2
    exit 2
  fi
  git tag -f "$tag_ref" "$merged_sha"
else
  git tag "$tag_ref" "$merged_sha"
fi

if [[ -n "$push" ]]; then
  if [[ -n "$force" ]]; then
    git push --force origin "refs/tags/${tag_ref}"
  else
    git push origin "refs/tags/${tag_ref}"
  fi
fi

printf 'audit tag created: %s -> %s\n' "$tag_ref" "$merged_sha"
