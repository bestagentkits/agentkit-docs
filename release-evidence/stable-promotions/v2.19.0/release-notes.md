# AgentKit v2.19.0

## Features

- **test:** Add conservative runtime impact selection ([#1950](https://github.com/bestagentkits/agentkit-support/pull/1950))
- **workflow:** Add opt-in semantic loop advice ([#1954](https://github.com/bestagentkits/agentkit-support/pull/1954))
- **review:** Add opt-in semantic finding triage ([#1953](https://github.com/bestagentkits/agentkit-support/pull/1953))
- **evals:** Add opt-in semantic routing regression evaluation ([#1957](https://github.com/bestagentkits/agentkit-support/pull/1957))
- **test:** Add opt-in semantic UI regression signals ([#1956](https://github.com/bestagentkits/agentkit-support/pull/1956))
- **test:** Add opt-in semantic impact evidence ([#1955](https://github.com/bestagentkits/agentkit-support/pull/1955))
- **kits:** Publish a cloud-harness distribution runtime ([#1912](https://github.com/bestagentkits/agentkit-support/pull/1912))
- **cli:** Add Cursor and Grok usage limits with equivalent API cost ([#1979](https://github.com/bestagentkits/agentkit-support/pull/1979))
- **secrets:** Trusted-agent identity via parent-process walk + SHA-256 pin &#40;vault v1 phase 3&#41; ([#1914](https://github.com/bestagentkits/agentkit-support/pull/1914))
- **secrets:** Two-state grants keyed by the caller's binary hash &#40;vault v1 phase 4&#41; ([#1915](https://github.com/bestagentkits/agentkit-support/pull/1915))
- **secrets:** Release, inject and record a secret reference ([#1918](https://github.com/bestagentkits/agentkit-support/pull/1918))
- **secrets:** Encrypted-file vault with recovery keys &#40;vault v1 phase 6&#41; ([#1921](https://github.com/bestagentkits/agentkit-support/pull/1921))
- **secrets:** Four approval answers over an inbox the operator answers later &#40;vault v1 phase 7&#41; ([#1952](https://github.com/bestagentkits/agentkit-support/pull/1952))
- **secrets:** Bind the secrets vault into the desktop shell ([#1960](https://github.com/bestagentkits/agentkit-support/pull/1960))
- **secrets:** Open the vault in the desktop shell ([#1961](https://github.com/bestagentkits/agentkit-support/pull/1961))
- **skills:** Add taste procedure and render checks to frontend-design ([#1990](https://github.com/bestagentkits/agentkit-support/pull/1990))
- **advise:** End advice with an explicit done contract ([#1993](https://github.com/bestagentkits/agentkit-support/pull/1993))
- **advise:** Interview until aligned and preview the outcome before confirming ([#1999](https://github.com/bestagentkits/agentkit-support/pull/1999))
- **secrets:** Desktop approval, audit and export groundwork for the vault ([#1964](https://github.com/bestagentkits/agentkit-support/pull/1964))
- **kits:** Run claude code subagents on opus instead of sonnet ([#2003](https://github.com/bestagentkits/agentkit-support/pull/2003))
- **secrets:** Red-team the vault for general availability and add its docs ([#2008](https://github.com/bestagentkits/agentkit-support/pull/2008))
- **desktop:** Write plan status from kanban, show session workspace context, persist preferences ([#2011](https://github.com/bestagentkits/agentkit-support/pull/2011))
- **ui:** Clear the clipboard after a secret paste and forbid console calls in the secrets UI ([#2013](https://github.com/bestagentkits/agentkit-support/pull/2013))
- **analytics:** Set up and repair the local index automatically ([#2012](https://github.com/bestagentkits/agentkit-support/pull/2012))
- **desktop:** Shareable builder card and filed-reports list ([#2026](https://github.com/bestagentkits/agentkit-support/pull/2026))
- **secrets:** Add ak secrets audit over the shared ledger query ([#2029](https://github.com/bestagentkits/agentkit-support/pull/2029))
- **secrets:** Age-encrypt value exports and refuse stdout ([#2024](https://github.com/bestagentkits/agentkit-support/pull/2024))
- **secrets:** Notify the desktop operator of every secret release ([#2021](https://github.com/bestagentkits/agentkit-support/pull/2021))
- **secrets:** Restrict a grant to allowed destination hosts ([#2037](https://github.com/bestagentkits/agentkit-support/pull/2037))
- **secrets:** Raise a system notification for each secret release in Desktop ([#2047](https://github.com/bestagentkits/agentkit-support/pull/2047))
- **desktop:** Add a BYOK multi-provider assistant to the desktop app ([#2031](https://github.com/bestagentkits/agentkit-support/pull/2031))
- **dashboard:** Replace usage-analytics placeholders with real session data ([#2027](https://github.com/bestagentkits/agentkit-support/pull/2027))
- **desktop:** Replace Activity and Topbar ComingSoon placeholders ([#2028](https://github.com/bestagentkits/agentkit-support/pull/2028))
- **ui:** Add a Vietnamese interface language with catalog coverage in Settings ([#2052](https://github.com/bestagentkits/agentkit-support/pull/2052))
- **kits:** Add motion-video skill and move hyperframes to core ([#2053](https://github.com/bestagentkits/agentkit-support/pull/2053))
- **kits:** Add style profiles and composition to motion-video ([#2055](https://github.com/bestagentkits/agentkit-support/pull/2055))
- **kits:** Add GEO and AI-discoverability guidance to SEO skills ([#2058](https://github.com/bestagentkits/agentkit-support/pull/2058))
- **kits:** Update mcp-builder for MCP spec 2026-07-28 and v2 SDKs ([#2061](https://github.com/bestagentkits/agentkit-support/pull/2061))
- **kits:** Add enhance-ux-ax skill for UX and AI-experience reviews ([#2062](https://github.com/bestagentkits/agentkit-support/pull/2062))
- **bootstrap:** Project brief checklist, cook-first pipeline, --ask and live verification ([#2064](https://github.com/bestagentkits/agentkit-support/pull/2064))
- **kits:** Add six payment providers to payment-integration ([#2065](https://github.com/bestagentkits/agentkit-support/pull/2065))
- **kits:** Motion-video craft, 1:1/9:16 editions and director mode ([#2066](https://github.com/bestagentkits/agentkit-support/pull/2066))
- **skill-creator:** Measure local session usage in audit and optimize ([#2067](https://github.com/bestagentkits/agentkit-support/pull/2067))
- **cli:** Add opt-in lazy auto-update for the CLI and kits ([#2068](https://github.com/bestagentkits/agentkit-support/pull/2068))
- **cli:** Make routine lifecycle snapshots opt-in ([#2072](https://github.com/bestagentkits/agentkit-support/pull/2072))

## Fixes and security

- **agents:** Require local preflight scratch cleanup ([#1976](https://github.com/bestagentkits/agentkit-support/pull/1976))
- **usage:** Keep usage limits help within the example budget ([#1987](https://github.com/bestagentkits/agentkit-support/pull/1987))
- **ci:** Repair weak tests and cut CI cost with verified-run carry-forward ([#1980](https://github.com/bestagentkits/agentkit-support/pull/1980))
- **hooks:** Anchor subagent paths at the session root and keep absolute config paths ([#1982](https://github.com/bestagentkits/agentkit-support/pull/1982))
- **kits:** Run the worktree explicit-base test in a fixture repo ([#1989](https://github.com/bestagentkits/agentkit-support/pull/1989))
- **ci:** Overwrite race shard receipts on re-run; close Windows desktop log in tests ([#1994](https://github.com/bestagentkits/agentkit-support/pull/1994))
- **analytics:** Count Codex tokens once and keep usage-limit reads within budget ([#1996](https://github.com/bestagentkits/agentkit-support/pull/1996))
- **sessionstats:** Name the live provider from the model, as the index does ([#2002](https://github.com/bestagentkits/agentkit-support/pull/2002))
- **secrets:** Refuse desktop grant self-approval ([#2016](https://github.com/bestagentkits/agentkit-support/pull/2016))
- **secrets:** Match grant fingerprints regardless of hex case ([#2033](https://github.com/bestagentkits/agentkit-support/pull/2033))
- **release:** Wait for the published kit release before reading it by tag ([#2040](https://github.com/bestagentkits/agentkit-support/pull/2040))
- **secrets:** Strike released values on every report and output surface ([#2025](https://github.com/bestagentkits/agentkit-support/pull/2025))
- **ui:** Meet AA contrast in the secret approval modal ([#2042](https://github.com/bestagentkits/agentkit-support/pull/2042))
- **secrets:** Keep one host list per scope when rekeying grants ([#2044](https://github.com/bestagentkits/agentkit-support/pull/2044))
- **secrets:** Draw Secrets error text with the themed error token ([#2046](https://github.com/bestagentkits/agentkit-support/pull/2046))
- **secrets:** Screen the agent label before a resolve writes its ledger row ([#2048](https://github.com/bestagentkits/agentkit-support/pull/2048))
- **secrets:** Redact released values in their JSON-escaped and per-line forms ([#2049](https://github.com/bestagentkits/agentkit-support/pull/2049))
- **secrets:** Prefilter the released-value scan with a prefix tag ([#2050](https://github.com/bestagentkits/agentkit-support/pull/2050))
- **release:** Distinguish unsent notification claims from ambiguous posts ([#2056](https://github.com/bestagentkits/agentkit-support/pull/2056))
- **insights:** Refresh contribution catalog and guard its freshness ([#2060](https://github.com/bestagentkits/agentkit-support/pull/2060))
- **desktop:** Keep license sessions alive and reuse the device seat ([#2063](https://github.com/bestagentkits/agentkit-support/pull/2063))

## Documentation

- **agents:** Add owner PR autopilot workflow ([#1977](https://github.com/bestagentkits/agentkit-support/pull/1977))
- **secrets:** Record the isolated smoke and recovery gate results ([#2045](https://github.com/bestagentkits/agentkit-support/pull/2045))

## Release provenance

- Previous stable tag: `v2.18.1`
- Previous promoted source: `9f7b3179e68d0f084e1724a28fbf786468d48da8`
- Promoted source: `d7b9bf22563a2c75dba726f9f0681988d884e89b`
- Stable snapshot commit: `1f79164e6dd197c957d2155a850cce0ca03a0adb`
- Full promoted change set: [compare source commits](https://github.com/bestagentkits/agentkit-support/compare/9f7b3179e68d0f084e1724a28fbf786468d48da8...d7b9bf22563a2c75dba726f9f0681988d884e89b)
- Artifact checksums: [release-provenance.json](https://github.com/bestagentkits/agentkit-support/releases/download/v2.19.0/release-provenance.json)
