#!/usr/bin/env bash
# classify-pr-prefix.sh — route NDJSON PR entries from diff-release-notes.sh
# to a docs tab.
#
# Usage:
#   diff-release-notes.sh <from> <to> | classify-pr-prefix.sh
#
# Each input line must be a JSON object with at least a "prefix" field. When a
# "subject" field is present it can override the prefix (see subject_override).
# Each output line adds a "tab" field with one of:
#   cli, kits, desktop, runtime, default, skip, unclassified
#
# `unclassified` is not "no impact" — it means the prefix is unknown and the
# entry still needs a manual classification before the run may claim coverage.

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
  # gui-api ships Desktop-facing bridge surface, so it is not a skip.
  [gui-api]=desktop
  [wails]=desktop

  # Runtime adapters — an adapter change can reverse a documented support or
  # compatibility boundary without touching the CLI help or any Kit archive,
  # which is invisible to V0. Always route these for a prose review.
  [adapters]=runtime
  [adapter]=runtime
  [runtime]=runtime
  [claude-code]=runtime
  [codex]=runtime
  [cursor]=runtime
  [grok]=runtime
  [omp]=runtime
  [pi]=runtime
  [dsh]=runtime

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
  [installer]=default
  [ux]=default
  [doctor]=default
  [update]=default
  [backups]=default
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
  [bridge]=skip
  [tui]=skip
)

# A generic scope such as `ux` or `feat` can still carry a Desktop change; the
# v2.15.0-beta.1 window shipped `feat(ux): ... for Desktop App and CLI`, which
# no Desktop prefix matched. Subject keywords therefore override the prefix.
desktop_subject_re='[Dd]esktop|ak-gui|[Ww]ails|GUI'

# Always succeeds; an empty result means "no override". A non-zero return here
# would abort the whole run under `set -e`.
subject_override() {
  local subject="$1"
  if [[ -n "$subject" && "$subject" =~ $desktop_subject_re ]]; then
    printf 'desktop'
  fi
  return 0
}

# `|| [[ -n "$line" ]]` so a final line with no trailing newline is still
# classified instead of being dropped silently.
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" ]] && continue

  prefix=$(printf '%s' "$line" | jq -r '.prefix // ""')
  subject=$(printf '%s' "$line" | jq -r '.subject // ""')

  if [[ -z "$prefix" ]]; then
    tab="unclassified"
  elif [[ -n "${prefix_map[$prefix]:-}" ]]; then
    tab="${prefix_map[$prefix]}"
  else
    tab="unclassified"
  fi

  # Never let a subject-level Desktop signal be skipped or dropped.
  if [[ "$tab" == skip || "$tab" == unclassified || "$tab" == default ]]; then
    override=$(subject_override "$subject")
    [[ -n "$override" ]] && tab="$override"
  fi

  printf '%s' "$line" | jq --compact-output --arg tab "$tab" '. + { tab: $tab }'
done
