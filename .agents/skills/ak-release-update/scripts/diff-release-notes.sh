#!/usr/bin/env bash
# diff-release-notes.sh — extract the new PR entries between two bundle
# release-notes.md files.
#
# Usage:
#   diff-release-notes.sh <from-bundle-dir> <to-bundle-dir>
#
# Emits one JSON object per line on stdout (NDJSON) so callers can pipe to
# jq. Fields:
#   {
#     "raw":     "**cli:** Ak config opens native Wails window ([#139](...))",
#     "prefix":  "cli",
#     "subject": "Ak config opens native Wails window",
#     "pr":      "139",
#     "url":     "https://github.com/.../pull/139"
#   }
#
# Entries without a prefix or PR number are still emitted with empty
# fields so downstream classifiers can see them.

set -euo pipefail

if (( $# != 2 )); then
  printf 'usage: diff-release-notes.sh <from-bundle-dir> <to-bundle-dir>\n' >&2
  exit 2
fi

from_dir="$1"
to_dir="$2"

for dir in "$from_dir" "$to_dir"; do
  if ! [[ -f "$dir/release-notes.md" ]]; then
    printf 'missing release-notes.md in %s\n' "$dir" >&2
    exit 2
  fi
done

# Only added lines from the diff. `diff` returns 1 when the files differ,
# which is the expected case — allow it.
new_lines=$(diff "$from_dir/release-notes.md" "$to_dir/release-notes.md" \
  | awk '/^> /{ sub(/^> /, ""); print }' || true)

# Each line is either a bullet like "- **prefix:** subject ([#N](url))" or
# a plain bullet. Parse both shapes.
while IFS= read -r line; do
  [[ -z "$line" ]] && continue

  # Strip leading "- " bullet marker if present.
  content="${line#- }"

  # Extract "**prefix:** subject" prefix; default to empty.
  prefix=""
  subject_body="$content"
  if [[ "$content" =~ ^\*\*([a-z0-9_-]+):\*\*[[:space:]](.*)$ ]]; then
    prefix="${BASH_REMATCH[1]}"
    subject_body="${BASH_REMATCH[2]}"
  fi

  # Extract "([#N](url))" first PR reference; default to empty.
  pr_number=""
  pr_url=""
  subject="$subject_body"
  if [[ "$subject_body" =~ \(\[#([0-9]+)\]\(([^\)]+)\)\) ]]; then
    pr_number="${BASH_REMATCH[1]}"
    pr_url="${BASH_REMATCH[2]}"
    # Strip the trailing "(#N)(url)" chunk from the subject for readability.
    subject="${subject_body%%[[:space:]]\(\[#*}"
  fi

  jq --null-input --compact-output \
    --arg raw "$content" \
    --arg prefix "$prefix" \
    --arg subject "$subject" \
    --arg pr "$pr_number" \
    --arg url "$pr_url" \
    '{ raw: $raw, prefix: $prefix, subject: $subject, pr: $pr, url: $url }'
done <<< "$new_lines"
