# Ghosthunt web command center

Baseline: native Ghosthunt commit `8026e01`. The existing Python CLI and bundled Nightwatch remain in this repository. The web layer adds an authenticated React interface without sales, Google Maps, outreach, Prisma or Redis modules.

## Execution and storage

- Fastify serves the dashboard and authenticated API on loopback port 3012. The generated private login key is `.bounty/web/access-key` (0600).
- The Iniciar pentest action installs and verifies the complete selected profile. Fifteen additional actions have individual UI controls: five native session commands and ten scoped investigation / import operations. Native status, doctor, engine list, playbook list and report execute the actual `ghosthunt.py` child process.
- Web tool execution uses the complete program scope, path restrictions and exclusions. DNS / HTTP operations additionally require active-testing permission. Passive collection requires automation permission.
- Each native child explicitly selects `.bounty/engagements/web-<program-id>` without mutating `CURRENT`. Scope and exclusion metadata are preserved. Native `run` / `execute_command` target operations are blocked for web-managed sessions; original engine passthroughs remain CLI-only and are not exposed by the API.
- Tool outputs also become native evidence files. Findings, evidence, report readiness, HackerOne submission links and received payments live in `.bounty/web/workspace.json`.
- Real stdout / stderr, process IDs and exit status appear in xterm. Ctrl+C cancels the process group. Authenticated SSE is used locally; polling is used through Cloudflare Quick Tunnels. Both support transcript replay and sequence-based resume.
- Custom `GHOSTHUNT_DATA_DIR` directories isolate their native sessions under `native/`.

## Interface organization

Program and target come first. Compact native session controls stay visible. Investigation tools default to those ready for the selected target, with All / Code / Recon / Burp filters and search. Activity sits beside operations on desktop and below it on smaller screens. Connections are separate; engine and reference inventories are collapsible. Reduced motion and keyboard controls remain supported.

## Integrations and limits

Claude-BugHunter, Claude-OSINT and official tool downloads are pinned and checked by SHA-256 or Git commit. Metasploit is a metadata search catalog; no exploit execution is exposed. Burp Community and the official MCP extension are now installed, loaded and verified against the actual MCP server. Community exposes proxy-history import; scanner issues require Professional.

Local Ollama `ghosthunt-local:q4` is configured by reusing existing weights. A real local advisor query completed successfully, recorded provider `local`, model `ghosthunt-local:q4`, duration 49.5 seconds and API cost $0. OpenAI Responses API support is implemented and tested with fixtures; the user-provided key is now saved privately in ignored `.env.local` with explicit approval. OpenAI requests are routed through the disposable VPN worker and remain blocked while VPN is unavailable. No OpenAI request or paid report submission was performed.

The previously created program, eight authentic run records, terminals and public-source snapshots were migrated from the earlier workspace. The original files remain intact; credentials were not copied. A diagnostic run and local AI advice have subsequently been recorded in Ghosthunt.

## Verification, 2026-11-17

- Python compile, TypeScript production build and focused dashboard ESLint: passed.
- Backend: 113 tests passed, none skipped, across 17 files.
- Browser workflow: login, program, finding, evidence, validation, Markdown download, external submission tracking and payment tracking passed with synthetic test data.
- Terminal browser checks: all 18 controls, category filters, real child stdout / PID, cancellation, close without cancellation, replay / download, reduced motion and 1440 / 834 / 390 layouts passed. Both SSE and polling were exercised.
- Public HTTPS: unauthenticated workspace returned 401; authenticated UI, search / filters and native Python doctor with actual PID and terminal polling passed. Zero browser JavaScript errors and no horizontal viewport overflow at all three widths.
- Production dependency audits: zero reported vulnerabilities in backend and dashboard runtime dependencies.

A temporary authenticated HTTPS URL was verified through Cloudflare. Its current value is stored privately in `.bounty/web/public/url.json`. It requires this Mac and the web / tunnel processes to remain running; it is not permanent hosting. Screenshots and execution evidence are in `.bounty/web/verification/`.

The selection / assessment gate, traceable run-to-hypothesis workflow and rendered report
review / revision approval are documented in [RESEARCH_WORKFLOW.md](RESEARCH_WORKFLOW.md).
The current runtime, lifecycle and live Proton exit / disconnect verification are documented in [EXECUTION_ISOLATION.md](EXECUTION_ISOLATION.md).
