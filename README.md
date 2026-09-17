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

## Engines & playbooks (not bundled)
The AI methodology and heavy engines are third-party projects with their own licenses and are
**not** redistributed here. Clone them yourself and point the app at them with
`BOUNTY_ENGINES_DIR=/path/to/engines`. Recommended: `nighwatch`, `strix`, `pwn` (methodology),
`claude-red` (playbooks).

## Configuration
Run `python3 ghosthunt.py` → `[k]`, or copy `.env.example` to `~/.bounty.env` and fill in:
HackerOne token, OpenAI key, and/or Ollama URL. Never commit your real `.env`.

## License
MIT © 2026 Snak3Gh0st. See [LICENSE](LICENSE).
