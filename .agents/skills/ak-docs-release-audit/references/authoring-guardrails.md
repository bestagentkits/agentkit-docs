# Authoring guardrails

- Modify only paths listed in the approved request.
- Limit V1 to existing `content/docs/beta/**/*.en.mdx`, matching `.vi.mdx`, and
  explicitly approved human-owned `meta*.json` files.
- Never edit Stable, generated-marker directories, `reference/`,
  `reference-derived/`, workflows, CODEOWNERS, or approval records in V1.
- Keep content channel-neutral and use relative cross-page links.
- Preserve EN/VI meaning, technical tokens, commands, paths, and safety gates.
- Write concise, factual, second-person prose. Exclude internal paths, issue
  IDs, planning language, raw extraction, private URLs, and unsupported claims.
- Stop when a required claim is partial or blocked. Do not broaden scope from
  nearby evidence.

After editing, regenerate the change manifest and re-run manual V1 validation.
Any added path, created/deleted file, stale docs base, or reused nonce invalidates
the batch.

