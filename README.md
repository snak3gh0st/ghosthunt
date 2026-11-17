```
                 ▄▄▄▄▄▄▄▄▄▄
               ▄████████████▄
             ██████████████████
           ██████████████████████
           ███▄   ▀██████▀   ▄███
           █████▄  ▀████▀  ▄█████
           ███████▄▄████▄▄███████
           ██████████████████████
           ███▀██████████████▀███
           ███  ▀██▀▀▀▀▀▀██▀  ███
           ████  ▀        ▀  ████
           █████▄          ▄█████
           ███████▄▄▄▄▄▄▄▄███████
           ██████████████████████
```
# GHOSTHUNT — pentest command console
**by Snak3Gh0st** · a scope-first, menu-driven hub for authorized bug bounty & pentesting.

GHOSTHUNT is a single controller that orchestrates recon → scan → exploitation → report,
drives a local (free) or cloud LLM as a copilot, and plugs into your favourite engines
(Nighwatch, Strix, AIRecon) and methodology playbooks — without ever leaving your scope.

> ⚠️ **Authorized testing only.** Use only on assets you own or are explicitly permitted
> to test (a bug bounty program's scope, a signed engagement, or your own lab). You are
> responsible for staying within policy. Intrusive tools (brute-force, exploitation
> frameworks) are hard-gated and never run automatically.

## Features
- **Interactive menu** — everything from one screen: install, set keys, recon, scan, exploit, report.
- **Scope-first** — every action is checked against the engagement scope; out-of-scope is blocked.
- **`hunt`** — full auto pipeline: OSINT → subdomain discovery → live check → URL/endpoint discovery
  (flags IDOR candidates) → takeover scan → nuclei → AI triage → report.
- **AI copilot** — free local **Ollama** or paid OpenAI; 50 specialist agents + methodology playbooks.
- **Exploitation** — guided PoC builder, confirmed active tools, and Strix autonomous engine.
- **HackerOne API** — list programs, pull scope, submit reports (with explicit confirmation).
- **Per-engagement folders** — isolated evidence per target; switch with `use`.
- **Cross-distro installer** — apt / dnf / pacman / zypper.

## Web command center (macOS / Linux)

The React dashboard drives this repository's Python CLI and adds program selection,
scoped collection, a real process terminal, evidence, HackerOne Markdown reports and
reward tracking. The original CLI remains available.

Requires Node.js 22+ and Python 3.12+. On macOS, use this setup; `install.sh` is the Linux arsenal installer.

```bash
npm ci --legacy-peer-deps
npm --prefix dashboard ci
npm run web:setup
npm run web:build
npm run web:start
```

Open `http://localhost:3012`. Select a program and complete **Avaliação antes do pentest**: review its official policy, initial asset, reward assumptions, access, investigation objective and time / execution limits. Review the assessment and approve its plan before clicking **Iniciar pentest**. The preparation installs and verifies the Docker/Conda tool image and the official Burp MCP package before declaring readiness. Network actions stay blocked until the Proton WireGuard gateway is connected; each analysis gets a new restricted container. See [selection and report review](docs/RESEARCH_WORKFLOW.md) and [execution isolation](docs/EXECUTION_ISOLATION.md).

 The private login key is in `.bounty/web/access-key`
(mode 0600). Web records are in `.bounty/web/workspace.json`; native per-program
sessions and evidence are in `.bounty/engagements/web-<program-id>`. Each web child
selects its engagement explicitly, without changing the CLI's `CURRENT` pointer.
`GHOSTHUNT_DATA_DIR`, `GHOSTHUNT_PORT` and `GHOSTHUNT_HOST` override web defaults.
A custom data directory keeps native sessions under its own `native/` subdirectory.

The web UI has 18 individual controls plus environment preparation and a complete
21-stage investigation: native session controls, Claude-BugHunter classification,
public-source review, Gitleaks, Semgrep, TruffleHog without credential verification,
Subfinder, URLFinder, gau, DNSx, HTTPx, bounded Nmap TCP and two Burp evidence imports.
The investigation runs compatible, authorized adapters sequentially and renders their
status, output and signals alongside the real terminal. Completed stages can become
traceable hypotheses, with their output attached for independent validation.
Executors check the full web scope, including paths and exclusions. Native `run` / `execute_command` target
commands are blocked for web-managed sessions; use the scoped web executors.
Other native engines remain accessible through the original CLI and retain their own
installation and operation requirements.

AI defaults to Ollama locally, with no automatic paid fallback. A local model named
`ghosthunt-local:q4` is preferred when installed; LM Studio is also supported.
OpenAI is an explicit provider. Keep `OPENAI_API_KEY` in ignored `.env.local`; protected OpenAI requests are dispatched through a disposable container and the VPN. Never put real keys in `.env.example`.
Burp Community and the pinned official MCP extension are installed by the preparation. MCP must be enabled on loopback. The app imports history; scanner results require Professional. Metasploit
has a source-pinned framework installed inside the arsenal image. The web workflow uses
its pinned reference catalog; it does not automatically run modules or create payloads.
The protected ARM64 arsenal contains 50 executable entries, all checked by inventory and
real startup probes. The official ZAP image is separately installed and pinned; installation
does not start its service or scans. Installed utilities without scoped web adapters are
shown as arsenal availability, independently of automatic investigation coverage.
Reports render in the UI with their evidence and outstanding requirements. Impact,
reproduction and evidence must be validated, followed by explicit approval of the reviewed
revision, before an approved report can be exported. Edits invalidate that approval. Submission
and payment records track real external outcomes; the app does not promise earnings.

Versions and download SHA-256 values are pinned in `bounty-integrations.json`.
Knowledge sources: [Claude-BugHunter](https://github.com/elementalsouls/Claude-BugHunter)
(MIT / CC BY 4.0) and [Claude-OSINT](https://github.com/elementalsouls/Claude-OSINT)
(MIT / CC BY 4.0); each checkout retains its original notices. See
[web architecture and verification](docs/WEB_IMPLEMENTATION.md).

## Quick start
```bash
git clone https://github.com/Snak3Gh0st/ghosthunt && cd ghosthunt
./install.sh                 # installs the arsenal (apt/dnf/pacman/zypper + go tools)
python3 ghosthunt.py         # opens the menu
#   [k] set credentials   [d] doctor   [7] pick a program   [1] hunt
```

## Requirements
- Linux (Kali recommended; Fedora/Arch/openSUSE supported), Python 3.12+
- Docker (for Strix), Go (for ProjectDiscovery tools), optional Ollama for free local AI

## Engines & playbooks
**Nightwatch is bundled.** GHOSTHUNT ships with its own scope-enforced control-plane engine
(`engines/nighwatch`, MIT © Snak3Gh0st) — no separate install needed. `nightwatch config` /
`nightwatch run` resolve the bundled copy automatically (or an installed `nighwatch` on PATH,
or `NIGHTWATCH_BIN`). It vendors [Strix](https://github.com/usestrix/strix) (Apache-2.0) under
`engines/nighwatch/vendor/strix`; see `engines/nighwatch/THIRD_PARTY_NOTICES.md`.

The other heavy engines and methodology repos are third-party projects with their own licenses
and are **not** redistributed here. Clone them yourself and point the app at them with
`BOUNTY_ENGINES_DIR=/path/to/engines`. Recommended: `strix`, `pwn` (methodology),
`claude-red` (playbooks), `airecon` (recon).

## Configuration
Run `python3 ghosthunt.py` → `[k]`, or copy `.env.example` to `~/.bounty.env` and fill in:
HackerOne token, OpenAI key, and/or Ollama URL. Never commit your real `.env`.

## License
MIT © 2026 Snak3Gh0st. See [LICENSE](LICENSE).
