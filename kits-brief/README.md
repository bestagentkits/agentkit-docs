# Kit skill briefs (`kits-brief/`)

Committed FAITHFUL briefs that drive the **Kits cheatsheet**. One JSON file per
skill; the build-time generator is pure and offline.

```
kits-brief/
  schema.json
  README.md
  engineer/
    ak-cook.json          # EN substrate
    ak-cook.vi.json       # optional VI prose overlay
  marketing/
    ak-seo.json
    …
```

## Pipeline

| Stage | Script | When |
| --- | --- | --- |
| Facts | `node scripts/ingest-kits.mjs` | Kit cache / train bump |
| Briefs | `node scripts/author-kit-prose.mjs` | Local only — never CI |
| Cheatsheet | `node scripts/generate-kits.mjs` | Local + CI zero-diff |

Author modes:

```bash
# one skill (searches engineer + marketing)
node scripts/author-kit-prose.mjs --slug ak-cook

# full batch (both kits)
node scripts/author-kit-prose.mjs

# re-extract only when kits-raw contentHash differs from brief provenance
node scripts/author-kit-prose.mjs --diff

# assert on-disk briefs match a fresh extract
node scripts/author-kit-prose.mjs --check
```

## FAITHFUL contract

Briefs state **only** what the skill's `SKILL.md` (and recorded `kits-raw` facts)
actually contain:

- **Do** take overview / when-to-use from frontmatter or the first body paragraph.
- **Do** list flags and subcommands that appear in `argument-hint` or body tables /
  lists, with descriptions copied or tightly paraphrased from the same source.
- **Do** record related `/ak:…` skills the body itself links to.
- **Do not** invent flags, modes, adapters, workflows, or marketing fluff.
- **Do not** expand thin skills into long entries — short source → short brief.

Adapter invocations are mechanical (not free prose):

| Runtime | Form |
| --- | --- |
| Claude Code | `/ak:<skill> …` |
| Codex | `$ak:<skill> …` |

## VI overlay

`kits-brief/<kit>/<slug>.vi.json` may override **prose only**: `overview`,
`whenToUse`, and flag/subcommand `desc` values. Keep command names, flags,
syntax, and invocations in English. Missing overlay or field → EN fallback at
generate time. Overlays are authored locally and committed; CI never translates.

## Versioning

Cheatsheet pages show the kit's **`kit.yaml` content semver** (e.g. `0.2.0`), not
the beta/stable train. Train is recorded on the kit facts page and in each
brief's `provenance.train` for bump/diff tracking only.
