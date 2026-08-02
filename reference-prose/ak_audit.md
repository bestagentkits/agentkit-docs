Check installed kits for drift by comparing each kit's plugin tree against the install-time fingerprint recorded at install. Reports modified, removed, and added files. With no argument it audits every installed kit; pass a kit name to audit just that one.

**When to use it:** After an upgrade, after manual edits under `~/.claude/plugins/`, or when something behaves unexpectedly and you suspect the install drifted. Use `ak audit scripts` for the advisory hook and skill script risk scanner.

This command is read-only and never writes. It suggests `ak kit refresh engineer --remote --yes` for paid kit drift and `ak kit refresh core --yes` for public kit drift. Pass `--strict` to also fail when the install manifest or plugin manifest is missing or unreadable.
