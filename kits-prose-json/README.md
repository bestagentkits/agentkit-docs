# Kit prose overlays (`kits-prose-json/`)

Reader-friendly `overview` + `whenToUse` per skill (EN + VI), keyed by skill
**slug** (`ak-cook`, not the slash command). Authored from each skill's full `SKILL.md` following the
FAITHFUL contract in [`reference-prose/README.md`](../reference-prose/README.md).

- **Author:** `node scripts/author-kit-prose.mjs` (local, occasional; never in CI)
- **Compile:** `node scripts/generate-kits.mjs` merges overlays over `kits-raw`

Prose must not state capabilities absent from `SKILL.md`. Missing VI fields fall
back to EN at compile time.
