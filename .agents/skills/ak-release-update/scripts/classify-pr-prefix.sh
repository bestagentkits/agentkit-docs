#!/usr/bin/env bash
# classify-pr-prefix.sh — route NDJSON PR entries from diff-release-notes.sh
# to a docs tab.
#
# Usage:
#   diff-release-notes.sh <from> <to> | classify-pr-prefix.sh
#
# Each input line must be a JSON object with at least a "prefix" field.
# Each output line adds a "tab" field with one of:
#   cli, kits, desktop, default, skip, unclassified

set -euo pipefail

# Prefix → tab mapping. Keep in sync with references/default-tab-detection.md
# and references/desktop-3-layer.md.
declare -A prefix_map=(
  # CLI reference — usually covered by V0 cli:* claims already.
  [cli]=cli
  [cmd]=cli

  # Desktop app — routes to Desktop 3-layer pipeline.
  [gui]=desktop
  [desktop]=desktop
  [ui]=desktop
  [branding]=desktop
  [onboarding]=desktop
  [dashboard]=desktop

  # Kits — new skills/agents/hooks/kit packaging.
  [kit]=kits
  [kits]=kits
  [skill]=kits
  [skills]=kits
  [agents]=kits
  [hooks]=kits
  [engineer]=kits
  [marketing]=kits
  [kitsource]=kits
  [skillenv]=kits

  # Default tab — everything user-facing that isn't CLI/Kits/Desktop.
  [docs]=default
  [config]=default
  [install]=default
  [migrate]=default
  [analytics]=default
  [plancmd]=default
  [plan-state]=default
  [feedback]=default
  [licenses]=default

  # Skip — no user-facing docs impact.
  [ci]=skip
  [release]=skip
  [perf]=skip
  [tooling]=skip
  [maintainer]=skip
  [refs]=skip
  [gui-api]=skip
  [bridge]=skip
  [adapters]=skip
  [tui]=skip
)

while IFS= read -r line; do
  [[ -z "$line" ]] && continue

  prefix=$(printf '%s' "$line" | jq -r '.prefix // ""')

  if [[ -z "$prefix" ]]; then
    tab="unclassified"
  elif [[ -n "${prefix_map[$prefix]:-}" ]]; then
    tab="${prefix_map[$prefix]}"
  else
    tab="unclassified"
  fi

  printf '%s' "$line" | jq --compact-output --arg tab "$tab" '. + { tab: $tab }'
done
