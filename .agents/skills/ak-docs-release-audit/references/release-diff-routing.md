# Release diff routing

Compare only surfaces present in the evidence set:

| Changed surface | Review these page families first |
| --- | --- |
| Installation, updater, migration | `getting-started/`, `guides/updating`, migration guides |
| Kit install, refresh, uninstall, ownership | `guides/installing-kits`, Kit lifecycle pages, Quickstart |
| Skills, Agents, Hooks, runtime adapters | Kit overview, component indexes, lifecycle, runtime concepts |
| CLI command or flag | Generated reference contract first; related prose only when user workflow changes |
| Desktop behavior | Desktop App guide and linked setup/troubleshooting pages |
| Release packaging or channel | Release notes, channel selector/banner, version hygiene surfaces |

Route by user impact: setup, invocation, output, mutation, compatibility,
safety, or recovery. Keep commands minimal in prose and link to the canonical
generated CLI route for exact syntax.

Do not route a claim into Stable directly. Do not add channel-specific wording
inside a page body. Do not include unchanged pages to make a batch look
complete.

