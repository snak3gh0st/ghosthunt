#!/usr/bin/env bash
# GHOSTHUNT installer — cross-distro pentest arsenal (apt / dnf / pacman / zypper). Idempotent.
set -uo pipefail
g(){ printf '\033[38;5;46m[+]\033[0m %s\n' "$*"; }
w(){ printf '\033[38;5;196m[!]\033[0m %s\n' "$*"; }

# ---- detect package manager ----
if   command -v apt-get >/dev/null 2>&1; then PM=apt;    INS="sudo apt-get install -y";       UPD="sudo apt-get update -y"
elif command -v dnf     >/dev/null 2>&1; then PM=dnf;    INS="sudo dnf install -y --skip-unavailable"; UPD="sudo dnf makecache"
elif command -v pacman  >/dev/null 2>&1; then PM=pacman; INS="sudo pacman -S --noconfirm --needed"; UPD="sudo pacman -Sy"
elif command -v zypper  >/dev/null 2>&1; then PM=zypper; INS="sudo zypper --non-interactive install"; UPD="sudo zypper refresh"
else PM=none; INS="true"; UPD="true"; w "no known package manager"; fi
g "Package manager: $PM"
$UPD >/dev/null 2>&1 || true

# ---- base deps (per distro) ----
case "$PM" in
  apt)    BASE="git curl jq nmap python3 python3-pip pipx golang-go docker.io dnsutils" ;;
  dnf)    BASE="git curl jq nmap python3 python3-pip pipx golang docker bind-utils" ;;
  pacman) BASE="git curl jq nmap python python-pip python-pipx go docker bind" ;;
  zypper) BASE="git curl jq nmap python3 python3-pip golang docker bind-utils" ;;
  *)      BASE="" ;;
esac
g "Base deps…"; for t in $BASE; do $INS "$t" >/dev/null 2>&1 || true; done
command -v pipx >/dev/null 2>&1 || python3 -m pip install --user pipx >/dev/null 2>&1 || true

# ---- distro arsenal (native packages; names differ per PM) ----
case "$PM" in
  apt)    ARSENAL="sqlmap whatweb wpscan ffuf feroxbuster gobuster amass wafw00f nuclei subfinder httpx-toolkit dnsx naabu katana dalfox assetfinder hakrawler gospider arjun commix theharvester trufflehog gowitness nikto seclists" ;;
  dnf)    ARSENAL="sqlmap nikto whatweb wpscan gobuster wfuzz dirb hydra amass ncat" ;;
  pacman) ARSENAL="sqlmap nikto gobuster wfuzz hydra amass" ;;
  zypper) ARSENAL="sqlmap nikto hydra" ;;
  *)      ARSENAL="" ;;
esac
if [ -n "$ARSENAL" ]; then
  g "$PM arsenal…"
  for t in $ARSENAL; do $INS "$t" >/dev/null 2>&1 && printf '    \033[38;5;46m++\033[0m %s\n' "$t" || printf '    \033[38;5;245m--\033[0m %s\n' "$t"; done
fi

# ---- portable tools via go (SAME on every distro: PD suite, gau, dalfox, ffuf) ----
if command -v go >/dev/null 2>&1; then
  export PATH="$PATH:$(go env GOPATH 2>/dev/null)/bin"
  g "go install — ONLY what's missing (skips tools apt already gave; avoids RAM-heavy rebuilds)"
  export GOFLAGS="-p=1"   # 1 build at a time so an 8GB VM doesn't run out of memory
  for pair in \
    "subfinder|github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest" \
    "httpx|github.com/projectdiscovery/httpx/cmd/httpx@latest" \
    "nuclei|github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest" \
    "katana|github.com/projectdiscovery/katana/cmd/katana@latest" \
    "naabu|github.com/projectdiscovery/naabu/v2/cmd/naabu@latest" \
    "dnsx|github.com/projectdiscovery/dnsx/cmd/dnsx@latest" \
    "gau|github.com/lc/gau/v2/cmd/gau@latest" \
    "waybackurls|github.com/tomnomnom/waybackurls@latest" \
    "assetfinder|github.com/tomnomnom/assetfinder@latest" \
    "dalfox|github.com/hahwul/dalfox/v2@latest" \
    "ffuf|github.com/ffuf/ffuf/v2@latest" ; do
    bin="${pair%%|*}"; pkg="${pair#*|}"
    if command -v "$bin" >/dev/null 2>&1 || command -v "${bin}-toolkit" >/dev/null 2>&1; then
      printf '    \033[38;5;46mok\033[0m %s (already installed)\n' "$bin"; continue
    fi
    printf '    building %s (a few min)…\n' "$bin"
    go install "$pkg" >/dev/null 2>&1 && printf '    \033[38;5;46m++\033[0m %s\n' "$bin" || printf '    \033[38;5;245m--\033[0m %s\n' "$bin"
  done
  grep -q 'GOPATH)/bin' ~/.bashrc 2>/dev/null || echo 'export PATH="$PATH:$(go env GOPATH)/bin"' >> ~/.bashrc
else
  w "Go not found — portable tools skipped. Install Go and re-run."
fi

# ---- autonomous engine + templates + env ----
command -v pipx >/dev/null 2>&1 && { g "pipx: strix-agent"; pipx install strix-agent >/dev/null 2>&1 || w "strix failed"; }
command -v nuclei >/dev/null 2>&1 && nuclei -update-templates >/dev/null 2>&1 || true
ENVF="$HOME/.bounty.env"; [ -f "$ENVF" ] || { cp "$(dirname "$0")/.env.example" "$ENVF" 2>/dev/null && chmod 600 "$ENVF"; w "created $ENVF"; }

g "Done. Now:  python3 ghosthunt.py  →  [k] credentials  →  [d] doctor  →  [7] program  →  [1] hunt"
