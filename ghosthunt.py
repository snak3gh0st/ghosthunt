#!/usr/bin/env python3
"""Small, scope-first bug bounty copilot for an isolated Linux VM.

It deliberately stays boring: no web UI, no autonomous exploitation, no shell=True.
The operator chooses the target, approves active commands, and keeps the evidence.
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import ipaddress
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


BASE = Path.cwd() / ".bounty"
POINTER = BASE / "CURRENT"

# These are (re)bound to the active engagement directory by _bind_paths().
ROOT = BASE
STATE_FILE = ROOT / "engagement.json"
NOTES_FILE = ROOT / "notes.md"
CHAT_FILE = ROOT / "chat.jsonl"
EVIDENCE_DIR = ROOT / "evidence"
WORK_DIR = ROOT / "work"
H1_DIR = ROOT / "h1"
NIGHTWATCH_DIR = ROOT / "nightwatch"


def _engagement_slug(name: str) -> str:
    import re as _re
    slug = _re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return slug[:40] or "session"


def _bind_paths(root: "Path") -> None:
    global ROOT, STATE_FILE, NOTES_FILE, CHAT_FILE, EVIDENCE_DIR, WORK_DIR, H1_DIR, NIGHTWATCH_DIR
    ROOT = root
    STATE_FILE = ROOT / "engagement.json"
    NOTES_FILE = ROOT / "notes.md"
    CHAT_FILE = ROOT / "chat.jsonl"
    EVIDENCE_DIR = ROOT / "evidence"
    WORK_DIR = ROOT / "work"
    H1_DIR = ROOT / "h1"
    NIGHTWATCH_DIR = ROOT / "nightwatch"


def _use_engagement(name: str) -> None:
    """Point at (and create) a per-program engagement directory."""
    slug = _engagement_slug(name)
    root = BASE / "engagements" / slug
    root.mkdir(parents=True, exist_ok=True)
    POINTER.write_text(slug + "\n", encoding="utf-8")
    _bind_paths(root)


def _load_active_engagement() -> None:
    try:
        slug = POINTER.read_text(encoding="utf-8").strip()
    except OSError:
        slug = ""
    if slug:
        _bind_paths(BASE / "engagements" / slug)

SAFE_TOOLS = {
    "curl",
    "dig",
    "dnsx",
    "httpx",
    "katana",
    "nmap",
    "naabu",
    "subfinder",
    "theharvester",
    "gau",
    "getallurls",
    "waybackurls",
    "gospider",
    "hakrawler",
    "gowitness",
    "amass",
    "assetfinder",
    "findomain",
    "wafw00f",
    "cdncheck",
    "tlsx",
    "whois",
    "whatweb",
    "openssl",
    "semgrep",
    "trufflehog",
}

# Enum / discovery / vuln-testing — active but accepted by most programs (rate-limited).
ACTIVE_TOOLS = {
    "ffuf",
    "feroxbuster",
    "dirsearch",
    "gobuster",
    "katana",
    "naabu",
    "nmap",
    "nuclei",
    "sqlmap",
    "dalfox",
    "wpscan",
    "arjun",
    "kiterunner",
    "crlfuzz",
    "zap-cli",
}

# Intrusive: brute-force / exploitation frameworks. Banned by most bounty
# programs; NEVER run automatically. Only via `run --confirm` after the operator
# confirms the program policy explicitly allows it.
INTRUSIVE_TOOLS = {
    "hydra",
    "medusa",
    "patator",
    "msfconsole",
    "msfvenom",
    "crackmapexec",
    "netexec",
    "commix",
}

HOSTLIKE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]*$")

# --- CLI look & feel (auto-disables when not a TTY or NO_COLOR is set) ---
GREEN = "\033[38;5;46m"
DGREEN = "\033[38;5;28m"
CYAN = "\033[38;5;51m"
RED = "\033[38;5;196m"
DIM = "\033[2m"
BOLD = "\033[1m"
RESET = "\033[0m"


def color_on(stream=sys.stdout) -> bool:
    return (
        hasattr(stream, "isatty")
        and stream.isatty()
        and os.environ.get("NO_COLOR") is None
        and os.environ.get("TERM") != "dumb"
    )


def paint(text: str, code: str, stream=sys.stdout) -> str:
    return f"{code}{text}{RESET}" if color_on(stream) else text


def section(label: str) -> None:
    bar = paint("==", DGREEN)
    print(f"\n{bar} {paint(label, BOLD + GREEN)} {bar}")


def banner() -> None:
    if not color_on(sys.stderr):
        return
    art = r"""
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
           ██████  ██████  ██████
           █████    ████    █████
           ███       ██       ███

    ╔═╗ ╦ ╦ ╔═╗ ╔═╗ ╔╦╗ ╦ ╦ ╦ ╦ ╔╗╔ ╔╦╗
    ║ ╦ ╠═╣ ║ ║ ╚═╗  ║  ╠═╣ ║ ║ ║║║  ║
    ╚═╝ ╩ ╩ ╚═╝ ╚═╝  ╩  ╩ ╩ ╚═╝ ╝╚╝  ╩
"""
    rule = "▄" * 52
    print(f"{DGREEN}{rule}{RESET}", file=sys.stderr)
    print(GREEN + art + RESET, file=sys.stderr)
    print(
        f"{DGREEN}  ╾╾[{RESET}{BOLD}{GREEN} by Snak3Gh0st {RESET}{DGREEN}]╼╼{RESET}"
        f"{DIM}  pentest command console  {RESET}{GREEN}☠{RESET}",
        file=sys.stderr,
    )
    print(f"{DGREEN}{rule}{RESET}", file=sys.stderr)
    print(f"{GREEN}  ▸ system online · engines armed · stay in scope{RESET}\n", file=sys.stderr)
    tag = f"{DGREEN}┌─[{RESET}{GREEN} scope-first {RESET}{DGREEN}]─[{RESET}{GREEN} operator-approved {RESET}{DGREEN}]─[{RESET}{RED} authorized testing only {RESET}{DGREEN}]{RESET}"
    print(tag, file=sys.stderr)
    if STATE_FILE.exists():
        try:
            state = json.loads(STATE_FILE.read_text())
            prog = state.get("program", "?")
            scope = ", ".join(state.get("scope", []))
            print(
                f"{DGREEN}└─[{RESET}{CYAN} {prog} {RESET}{DGREEN}]─►{RESET}{DIM} {scope}{RESET}",
                file=sys.stderr,
            )
        except (json.JSONDecodeError, OSError):
            pass
    else:
        print(f"{DGREEN}└─►{RESET}{DIM} no session — run: ghosthunt init --program NAME --scope HOST{RESET}", file=sys.stderr)
    print("", file=sys.stderr)


def load_dotenv() -> None:
    """Load KEY=VALUE from ./.env and ~/.bounty.env without overriding existing env."""
    for path in (Path.cwd() / ".env", Path.home() / ".bounty.env"):
        try:
            if not path.is_file():
                continue
            for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
        except OSError:
            pass
    # Mirror the app's key to the standard var so bundled engines that read
    # OPENAI_API_KEY (pentestgpt, etc.) work without extra config.
    if not os.environ.get("OPENAI_API_KEY") and os.environ.get("BOUNTY_API_KEY"):
        os.environ["OPENAI_API_KEY"] = os.environ["BOUNTY_API_KEY"]


def timestamp() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def die(message: str, code: int = 2) -> None:
    print(f"ghosthunt: {message}", file=sys.stderr)
    raise SystemExit(code)


def read_state() -> dict:
    if not STATE_FILE.exists():
        die("no session found; run: ghosthunt init --program NAME --scope HOST")
    try:
        return json.loads(STATE_FILE.read_text())
    except json.JSONDecodeError as exc:
        die(f"invalid engagement.json: {exc}")
    return {}


def normalize_scope(value: str) -> str:
    raw = value.strip().lower().rstrip(".")
    if "://" in raw:
        parsed = urllib.parse.urlparse(raw)
        raw = parsed.hostname or raw
    raw = raw.split("/", 1)[0]
    if raw.startswith("*."):
        return "*." + raw[2:].rstrip(".")
    return raw


def host_from_value(value: str) -> str | None:
    value = value.strip().strip("'\"(),[]")
    if "://" in value:
        return urllib.parse.urlparse(value).hostname
    if value.count(":") == 1 and value.rsplit(":", 1)[1].isdigit():
        value = value.rsplit(":", 1)[0]
    if HOSTLIKE.match(value) and ("." in value or value == "localhost"):
        return value.lower().rstrip(".")
    return None


def in_scope(host: str, scopes: list[str]) -> bool:
    host = host.lower().rstrip(".")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    for scope in scopes:
        scope = normalize_scope(scope)
        if scope.startswith("*."):
            suffix = scope[2:]
            if host.endswith("." + suffix) and host != suffix:
                return True
            continue
        try:
            network = ipaddress.ip_network(scope, strict=False)
        except ValueError:
            network = None
        if address is not None and network is not None and address in network:
            return True
        if host == scope:
            return True
    return False


def command_hosts(command: list[str]) -> list[str]:
    hosts: list[str] = []
    for token in command:
        candidate = host_from_value(token)
        if candidate and candidate not in hosts:
            hosts.append(candidate)
    return hosts


def append_note(title: str, body: str) -> None:
    NOTES_FILE.parent.mkdir(parents=True, exist_ok=True)
    with NOTES_FILE.open("a", encoding="utf-8") as handle:
        handle.write(f"\n## {title} — {timestamp()}\n\n{body.rstrip()}\n")


def evidence_output(path: Path) -> str:
    """Return command output without the evidence metadata header."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    return text.split("# Output\n", 1)[-1]


def redact_for_llm(text: str) -> str:
    """Remove common credential-bearing headers before sending evidence to an LLM."""
    secret_header = re.compile(
        r"(?im)^(authorization|cookie|set-cookie|x-api-key|api-key|proxy-authorization):.*$"
    )
    return secret_header.sub(r"\1: [REDACTED]", text)


def session_context_for_llm(max_chars: int = 9000) -> str:
    """Build a small, redacted evidence index for the on-demand chatbot."""
    parts: list[str] = []
    if NOTES_FILE.exists():
        notes = NOTES_FILE.read_text(encoding="utf-8", errors="replace")
        parts.append("NOTES:\n" + redact_for_llm(notes)[-2500:])
    evidence = sorted(EVIDENCE_DIR.glob("*"), key=lambda item: item.stat().st_mtime)
    for item in evidence[-6:]:
        excerpt = redact_for_llm(evidence_output(item)).strip()
        if excerpt:
            parts.append(f"EVIDENCE {item.name}:\n{excerpt[-1400:]}")
    return "\n\n".join(parts)[-max_chars:]


def cmd_init(args: argparse.Namespace) -> None:
    slug = _engagement_slug(args.program)
    if (BASE / "engagements" / slug / "engagement.json").exists() and not args.force:
        die("session already exists; use --force only if you want to replace it")
    scopes = [normalize_scope(item) for item in args.scope]
    if not scopes or any(not item for item in scopes):
        die("provide at least one host in scope")
    _use_engagement(args.program)
    ROOT.mkdir(parents=True, exist_ok=True)
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    state = {
        "program": args.program,
        "scope": scopes,
        "created_at": timestamp(),
        "mode": "operator-approved",
    }
    STATE_FILE.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    NOTES_FILE.write_text(
        f"# {args.program}\n\nAuthorized scope:\n"
        + "\n".join(f"- `{item}`" for item in scopes)
        + "\n\nDo not test anything outside the program scope.\n",
        encoding="utf-8",
    )
    print(f"Session created for {args.program}.")
    print("Next step: ghosthunt status")


def cmd_status(_: argparse.Namespace) -> None:
    state = read_state()
    print(f"Program: {state['program']}")
    print("Scope:   " + ", ".join(state["scope"]))
    print(f"Created: {state['created_at']}")
    print(f"Evidence: {len(list(EVIDENCE_DIR.glob('*'))) if EVIDENCE_DIR.exists() else 0}")
    print(f"Engagement dir: {ROOT}")
    engagements_dir = BASE / "engagements"
    if engagements_dir.exists():
        others = sorted(p.name for p in engagements_dir.iterdir() if p.is_dir())
        if others:
            print("All engagements: " + ", ".join(others))


def cmd_use(args: argparse.Namespace) -> None:
    slug = _engagement_slug(args.name)
    root = BASE / "engagements" / slug
    if not (root / "engagement.json").exists():
        available = sorted(p.name for p in (BASE / "engagements").glob("*") if p.is_dir()) if (BASE / "engagements").exists() else []
        die(f"no engagement '{slug}'. Available: {', '.join(available) or '(none)'}. Create with init / h1 init.")
    _use_engagement(args.name)
    print(f"Switched to engagement: {slug}")
    cmd_status(argparse.Namespace())


def cmd_note(args: argparse.Namespace) -> None:
    read_state()
    body = args.text or sys.stdin.read()
    if not body.strip():
        die("provide text or send content via stdin")
    append_note(args.title, body)
    print(f"Note saved: {args.title}")


def cmd_evidence(args: argparse.Namespace) -> None:
    read_state()
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    if args.source:
        source = Path(args.source).expanduser()
        if not source.is_file():
            die(f"file not found: {source}")
        data = source.read_bytes()
    else:
        data = sys.stdin.buffer.read()
    if not data:
        die("no evidence received")
    name = Path(args.name).name
    destination = EVIDENCE_DIR / name
    destination.write_bytes(data)
    print(f"Evidence saved: {destination}")


def validate_command(command: list[str], target: str, state: dict) -> None:
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        die("use: ghosthunt run --target host -- command argument")
    executable = Path(command[0]).name
    if executable not in SAFE_TOOLS and executable not in ACTIVE_TOOLS and executable not in INTRUSIVE_TOOLS:
        die(f"tool not allowed by default: {executable}")
    if not in_scope(target, state["scope"]):
        die(f"target out of scope: {target}")
    outside = [host for host in command_hosts(command) if not in_scope(host, state["scope"])]
    if outside:
        die("the command contains an out-of-scope target: " + ", ".join(outside))


def execute_command(command: list[str], target: str, state: dict, *, confirm: bool) -> tuple[int, Path]:
    command = list(command)
    if command and command[0] == "--":
        command.pop(0)
    validate_command(command, target, state)
    executable = Path(command[0]).name
    if executable in INTRUSIVE_TOOLS and not confirm:
        die(
            f"{executable} is INTRUSIVE (brute-force/exploitation) and banned by most bounty "
            "programs; only run with --confirm AND explicit written program permission"
        )
    if executable in INTRUSIVE_TOOLS:
        print(paint(f"! INTRUSIVE tool {executable}: confirm the program policy allows this or you risk a ban.", RED))
    if executable in ACTIVE_TOOLS and not confirm:
        die(f"{executable} is active; re-run with --confirm after checking the program policy")
    resolved = shutil.which(command[0])
    if not resolved:
        die(f"tool not found on the VM: {command[0]}")
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    filename = dt.datetime.now().strftime("%Y%m%d-%H%M%S") + f"-{executable}.txt"
    evidence_path = EVIDENCE_DIR / filename
    header = (
        f"# Command\n{shlex.join(command)}\n\n"
        f"# Target\n{target}\n\n# Started\n{timestamp()}\n\n# Output\n"
    )
    print(f"Running inside the authorized session: {shlex.join(command)}")
    try:
        completed = subprocess.run(command, text=True, capture_output=True, check=False)
    except OSError as exc:
        die(f"failed to run tool: {exc}")
    output = completed.stdout + ("\n" + completed.stderr if completed.stderr else "")
    evidence_path.write_text(header + output, encoding="utf-8", errors="replace")
    print(output, end="")
    print(f"\nEvidence saved to {evidence_path} (exit {completed.returncode})")
    return completed.returncode, evidence_path


def cmd_run(args: argparse.Namespace) -> None:
    state = read_state()
    target = host_from_value(args.target)
    if not target:
        die(f"invalid target: {args.target}")
    code, _ = execute_command(args.command, target, state, confirm=args.confirm)
    raise SystemExit(code)


def cmd_baseline(args: argparse.Namespace) -> None:
    """Run a small, low-impact baseline and save each result as evidence."""
    state = read_state()
    target = host_from_value(args.target)
    if not target or not in_scope(target, state["scope"]):
        die(f"target out of scope: {args.target}")
    url = args.target if "://" in args.target else f"https://{target}"
    plan = [
        ("HTTP headers", ["curl", "-sS", "-I", "--max-time", "10", url]),
        ("DNS answers", ["dig", "+short", target]),
        ("Web fingerprint", ["whatweb", "--no-errors", "--color=never", url]),
    ]
    results: list[str] = []
    for label, command in plan:
        executable = command[0]
        if not shutil.which(executable):
            results.append(f"- {label}: skipped ({executable} not installed)")
            continue
        section(label)
        code, evidence_path = execute_command(command, target, state, confirm=False)
        results.append(f"- {label}: exit {code}, evidence `{evidence_path.name}`")
    append_note("Baseline", "\n".join(results))
    print("\nBaseline complete. No active tool was run.")
    print("Next step: python3 ghosthunt.py report")


def _httpx_bin() -> str | None:
    """Find ProjectDiscovery httpx (NOT the Python `httpx` library, which lacks -l)."""
    override = os.environ.get("BOUNTY_HTTPX_BIN")
    if override:
        return override
    candidates = ["httpx-toolkit", str(Path.home() / "go" / "bin" / "httpx"), "httpx"]
    for candidate in candidates:
        resolved = shutil.which(candidate)
        if not resolved and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            resolved = candidate
        if not resolved:
            continue
        try:
            result = subprocess.run([resolved, "-version"], capture_output=True, text=True, timeout=10)
        except (OSError, subprocess.SubprocessError):
            continue
        blob = (result.stdout + result.stderr).lower()
        if "projectdiscovery" in blob or re.search(r"v?\d+\.\d+\.\d+", blob):
            return resolved
    return None


def _run_evidence(command: list[str], _label: str) -> tuple[int, Path]:
    """Run a scope-safe command whose targets are already filtered, and save evidence."""
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    filename = dt.datetime.now().strftime("%Y%m%d-%H%M%S") + f"-{Path(command[0]).name}.txt"
    evidence_path = EVIDENCE_DIR / filename
    print(f"Running: {shlex.join(command)}")
    try:
        completed = subprocess.run(command, text=True, capture_output=True)
    except OSError as exc:
        die(f"failed to run {command[0]}: {exc}")
    output = completed.stdout + ("\n" + completed.stderr if completed.stderr else "")
    evidence_path.write_text(
        f"# Command\n{shlex.join(command)}\n\n# Started\n{timestamp()}\n\n# Output\n" + output,
        encoding="utf-8",
        errors="replace",
    )
    print(output, end="")
    print(f"\nEvidence saved to {evidence_path} (exit {completed.returncode})")
    return completed.returncode, evidence_path


def _run_evidence_stream(command: list[str], _label: str) -> tuple[int, Path]:
    """Like _run_evidence but streams output live (for long scans like nuclei)."""
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    filename = dt.datetime.now().strftime("%Y%m%d-%H%M%S") + f"-{Path(command[0]).name}.txt"
    evidence_path = EVIDENCE_DIR / filename
    print(f"Running (live): {shlex.join(command)}")
    collected: list[str] = []
    try:
        proc = subprocess.Popen(
            command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1
        )
    except OSError as exc:
        die(f"failed to run {command[0]}: {exc}")
    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            print(line, end="")
            collected.append(line)
    except KeyboardInterrupt:
        proc.terminate()
        print("\n(interrupted by operator)")
    proc.wait()
    evidence_path.write_text(
        f"# Command\n{shlex.join(command)}\n\n# Started\n{timestamp()}\n\n# Output\n" + "".join(collected),
        encoding="utf-8",
        errors="replace",
    )
    print(f"\nEvidence saved to {evidence_path} (exit {proc.returncode})")
    return proc.returncode, evidence_path


def _nuclei_command(target_list: Path, gentle: bool = False) -> list[str]:
    # Fast, high-signal profile. NOTE: the `cve` tag alone pulls ~3000+ templates,
    # so it is excluded by default (add it via BOUNTY_NUCLEI_TAGS when you want a
    # full CVE sweep). CVEs still get covered fast below at high/critical only.
    # gentle = low rate/concurrency for small or slow sites that self-inflict timeouts.
    tags = os.environ.get(
        "BOUNTY_NUCLEI_TAGS",
        "exposure,misconfig,takeover,default-login,exposed-panel",
    )
    speed = (
        ["-rl", "30", "-c", "10", "-timeout", "8", "-retries", "2"]
        if gentle
        else ["-rl", "500", "-c", "100", "-bulk-size", "40", "-timeout", "5", "-retries", "1"]
    )
    command = [
        "nuclei", "-l", str(target_list), "-stats", "-si", "15",
        "-tags", tags,
        "-etags", "intrusive,dos,fuzz",
        *speed,
    ]
    proxy = os.environ.get("BOUNTY_PROXY")
    if proxy:
        command += ["-proxy", proxy]
    # Suppress known false-positive template IDs for this engagement.
    exclude_ids = os.environ.get("BOUNTY_NUCLEI_EXCLUDE_IDS", "")
    if exclude_ids:
        command += ["-exclude-id", exclude_ids]
    # If the operator forced cve tags, don't cap severity; otherwise keep it broad
    # for the small high-signal families.
    command += ["-severity", "low,medium,high,critical"]
    return command


def cmd_engage(args: argparse.Namespace) -> None:
    """Passive workflow for one authorized target, or for a *.wildcard parent domain."""
    state = read_state()
    scope = state["scope"]
    target = host_from_value(args.target)
    if not target:
        die(f"invalid target: {args.target}")
    is_in_scope = in_scope(target, scope)
    is_wildcard_parent = any(normalize_scope(item) == "*." + target for item in scope)
    if not is_in_scope and not is_wildcard_parent:
        die(f"target out of scope: {args.target}")

    if is_in_scope:
        print(f"Passive engagement started for {target}.")
    else:
        print(f"Passive discovery for wildcard *.{target} (the apex itself is not in scope).")
    print("No active tool will be run automatically.")

    discovered: set[str] = set()
    if is_in_scope:
        discovered.add(target)
        cmd_baseline(argparse.Namespace(target=target))

    if shutil.which("subfinder"):
        section("Passive subdomain discovery")
        print(paint("OSINT: subfinder queries public sources; it does not contact the target.", DGREEN))
        _, evidence = _run_evidence(["subfinder", "-d", target, "-silent", "-timeout", "10"], "subfinder")
        for line in evidence_output(evidence).splitlines():
            host = host_from_value(line)
            if host:
                discovered.add(host)
    else:
        append_note("Engagement", "subfinder is not installed; passive discovery was skipped.")

    in_scope_hosts = sorted(host for host in discovered if in_scope(host, scope))
    out_of_scope_count = len(discovered) - len(in_scope_hosts)
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    target_file = WORK_DIR / "in-scope-hosts.txt"
    target_file.write_text("\n".join(in_scope_hosts) + "\n", encoding="utf-8")
    print(f"\nIn-scope hosts: {len(in_scope_hosts)} (saved to {target_file})")

    httpx = _httpx_bin()
    if httpx and in_scope_hosts:
        section("In-scope HTTP validation")
        _run_evidence(
            [httpx, "-l", str(target_file), "-silent", "-status-code", "-title", "-tech-detect", "-rl", "5"],
            "httpx",
        )
    elif in_scope_hosts and not httpx:
        print(paint("! ProjectDiscovery httpx not found (the python 'httpx' library does not count).", RED))
        print("  Install: sudo apt install -y httpx-toolkit   (or set BOUNTY_HTTPX_BIN)")
        print("  Quick check meanwhile with curl:")
        print(
            f"    while read h; do echo \"$(curl -s -o /dev/null -w '%{{http_code}}' --max-time 8 https://$h)  $h\"; "
            f"done < {target_file} | sort"
        )

    append_note(
        "Engagement",
        "\n".join(
            [
                f"Seed: `{target}` ({'in-scope host' if is_in_scope else 'wildcard parent (OSINT only)'})",
                f"Hosts discovered: {len(discovered)}",
                f"In-scope hosts: {len(in_scope_hosts)}",
                f"Out-of-scope discovered (skipped): {out_of_scope_count}",
                "Phase complete: passive recon and low-impact HTTP validation.",
            ]
        ),
    )
    cmd_report(argparse.Namespace())
    print("\nPassive engagement complete. Review the evidence before any active test.")


def _hunt_seeds(scope: list[str]) -> tuple[list[str], list[str]]:
    parents: list[str] = []
    concrete: list[str] = []
    for entry in scope:
        entry = normalize_scope(entry)
        if entry.startswith("*."):
            parents.append(entry[2:])
        elif "/" not in entry:
            concrete.append(entry)
    return sorted(set(parents)), sorted(set(concrete))


def cmd_hunt(args: argparse.Namespace) -> None:
    """Full automated pipeline: OSINT -> discovery -> live -> vuln scan -> AI triage -> report."""
    state = read_state()
    scope = state["scope"]
    if not args.confirm:
        die(
            "hunt runs automated ACTIVE scanning (nuclei). Confirm the program allows automated "
            "testing, then re-run with --confirm. Intrusive tools (hydra/metasploit) are never run here."
        )
    parents, concrete = _hunt_seeds(scope)
    print(paint(f"GHOSTHUNT full pipeline — {state['program']}", BOLD + GREEN))
    print("Phases: OSINT -> discovery -> live check -> vuln scan -> AI triage -> report\n")

    discovered: set[str] = set(concrete)
    for domain in parents:
        section(f"OSINT / discovery: {domain}")
        if shutil.which("subfinder"):
            _, evidence = _run_evidence(["subfinder", "-d", domain, "-silent", "-timeout", "10"], "subfinder")
            for line in evidence_output(evidence).splitlines():
                host = host_from_value(line)
                if host:
                    discovered.add(host)
        harvester = shutil.which("theHarvester") or shutil.which("theharvester")
        if harvester:
            _run_evidence([harvester, "-d", domain, "-b", "crtsh,otx,rapiddns"], "theharvester")

    in_scope_hosts = sorted(host for host in discovered if in_scope(host, scope))
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    all_file = WORK_DIR / "hunt-hosts.txt"
    all_file.write_text("\n".join(in_scope_hosts) + "\n", encoding="utf-8")
    print(f"\nIn-scope hosts discovered: {len(in_scope_hosts)}")
    if not in_scope_hosts:
        die("no in-scope hosts discovered; check the session scope")

    section("Live HTTP services")
    httpx = _httpx_bin()
    live_file = WORK_DIR / "hunt-live.txt"
    live: list[str] = []
    if httpx:
        _, evidence = _run_evidence(
            [httpx, "-l", str(all_file), "-silent", "-status-code", "-title", "-tech-detect", "-rl", "10"],
            "httpx",
        )
        for line in evidence_output(evidence).splitlines():
            parts = line.split()
            if not parts:
                continue
            host = host_from_value(parts[0])
            if host and in_scope(host, scope):
                live.append(parts[0] if "://" in parts[0] else "https://" + host)
    else:
        print(paint("! ProjectDiscovery httpx not found; treating all in-scope hosts as https URLs.", RED))
        live = ["https://" + host for host in in_scope_hosts]
    live_file.write_text("\n".join(live) + "\n", encoding="utf-8")
    print(f"Live services: {len(live)}")

    # URL / endpoint discovery — finds the /api/x/{id} endpoints where IDOR lives.
    if live:
        section("URL & endpoint discovery")
        urls: set[str] = set()
        if shutil.which("katana"):
            _, ev = _run_evidence(
                ["katana", "-list", str(live_file), "-silent", "-jc", "-d", "2", "-rl", "50", "-timeout", "10"],
                "katana",
            )
            urls.update(u.strip() for u in evidence_output(ev).splitlines() if u.strip().startswith("http"))
        else:
            print(paint("! katana not installed (crawler) — sudo apt install -y katana", DIM))
        gau = shutil.which("gau") or shutil.which("getallurls")
        for domain in sorted(set(parents + concrete)):
            if gau:
                _, ev = _run_evidence([gau, "--threads", "5", domain], "gau")
                urls.update(u.strip() for u in evidence_output(ev).splitlines() if u.strip().startswith("http"))
        if not gau:
            print(paint("! gau not installed (passive URL harvest) — go install github.com/lc/gau/v2/cmd/gau@latest", DIM))
        in_scope_urls = sorted({u for u in urls if (host_from_value(u) and in_scope(host_from_value(u), scope))})
        (WORK_DIR / "urls.txt").write_text("\n".join(in_scope_urls) + "\n", encoding="utf-8")
        print(f"Endpoints discovered: {len(in_scope_urls)} (saved to {WORK_DIR / 'urls.txt'})")
        idor = [u for u in in_scope_urls if re.search(r"/\d{2,}(?:/|$|\?)", u) or re.search(r"[?&][\w-]*id=", u, re.I)]
        if idor:
            (WORK_DIR / "idor-candidates.txt").write_text("\n".join(idor) + "\n", encoding="utf-8")
            print(paint(f"  → {len(idor)} endpoints with IDs = IDOR candidates (work/idor-candidates.txt)", GREEN))
            append_note("URL discovery", f"{len(in_scope_urls)} URLs, {len(idor)} with IDs (IDOR candidates):\n" + "\n".join(idor[:30]))

    if shutil.which("nuclei") and in_scope_hosts:
        section(f"Subdomain takeover scan ({len(in_scope_hosts)} discovered hosts, incl. dead ones)")
        print(paint("takeover lives on dangling/dead hosts — scanning all, not just the live ones.", DGREEN))
        tk_speed = (["-rl", "30", "-c", "10", "-timeout", "8"] if getattr(args, "gentle", False)
                    else ["-rl", "200", "-c", "60", "-timeout", "5"])
        _run_evidence_stream(
            ["nuclei", "-l", str(all_file), "-stats", "-si", "15", "-tags", "takeover",
             *tk_speed, "-retries", "2"],
            "nuclei-takeover",
        )

    if shutil.which("nuclei") and live:
        section("Automated vulnerability scan (nuclei — safe templates)")
        mode = "gentle (slow, patient)" if getattr(args, "gentle", False) else "fast"
        print(paint(f"active scan [{mode}]; intrusive/dos/fuzz excluded; live progress below.", DGREEN))
        _run_evidence_stream(_nuclei_command(live_file, getattr(args, "gentle", False)), "nuclei")
    elif not shutil.which("nuclei"):
        print(paint("! nuclei not installed; skipping vuln scan (sudo apt install -y nuclei).", RED))

    if getattr(args, "deep", False) and live:
        section("Deep analysis / exploitation (Strix)")
        cmd, env = _resolve_engine("strix", ENGINES["strix"])
        if not cmd:
            print(paint("! Strix not installed. Install: pipx install strix-agent (needs Docker).", RED))
        elif not (os.environ.get("STRIX_LLM") and os.environ.get("LLM_API_KEY")):
            print(paint("! Set STRIX_LLM and LLM_API_KEY in ~/.bounty.env for Strix. Skipping deep phase.", RED))
        else:
            print(paint("Strix autonomous analysis (authorized/owned targets only; Docker; may take a while).", DGREEN))
            full = cmd + ["-n", "--scan-mode", "quick", "--target-list", str(live_file)]
            print(paint(f"→ {shlex.join(full)}", DIM))
            try:
                subprocess.run(full, env=env)
            except FileNotFoundError:
                print(paint("! could not launch Strix", RED))

    section("AI triage")
    use_local = _llm_is_local(getattr(args, "local", False))
    has_llm = use_local or (
        os.environ.get("BOUNTY_MODEL")
        and (os.environ.get("BOUNTY_API_KEY") or os.environ.get("OPENAI_API_KEY"))
    )
    if has_llm:
        available_agents = ", ".join(name for name, _ in _list_agents()) or "(none)"
        prompt = (
            "You are a PANEL of specialist bug bounty hunters triaging automated recon/scan output "
            "for an AUTHORIZED engagement. Analyze the evidence from EACH relevant angle: "
            "IDOR/BOLA, broken access control, info disclosure, exposed panels/secrets, business logic, "
            "subdomain takeover, auth/OAuth, SSRF, injection. "
            "Produce the TOP candidate vulnerabilities RANKED by payout likelihood. For each: the class, "
            "which host, why it might be real, the exact manual step to CONFIRM it, and which specialist "
            f"to invoke next as `ghosthunt ask --agent <name>` (available agents: {available_agents}). "
            "Be honest: mark every scanner hit UNCONFIRMED until reproduced. Do not invent findings. "
            "APPLY the 7-question gate and DROP anything on the never-submit list below."
        )
        methodology = _triage_methodology()
        if methodology:
            prompt += "\n\nVALIDATION METHODOLOGY:\n" + methodology
        try:
            answer = llm_request(
                prompt + "\n\nEVIDENCE:\n" + session_context_for_llm(12000), state, local=use_local
            )
            print(answer.rstrip())
            append_note("Hunt AI triage", answer)
        except SystemExit:
            print("(LLM triage unavailable)")
    else:
        print("Set BOUNTY_MODEL + key in ~/.bounty.env for AI triage. Skipped.")

    append_note("Hunt", f"Full pipeline: {len(in_scope_hosts)} in-scope hosts, {len(live)} live services.")
    cmd_report(argparse.Namespace())
    print(paint("\nHunt complete. Findings are CANDIDATES — reproduce before reporting.", BOLD + GREEN))


def _llm_is_local(explicit: bool = False) -> bool:
    return explicit or os.environ.get("BOUNTY_LLM", "").lower() in ("local", "ollama")


def llm_request(prompt: str, state: dict, local: bool = False) -> str:
    if _llm_is_local(local):
        base_url = os.environ.get("BOUNTY_OLLAMA_URL", "http://127.0.0.1:11434/v1").rstrip("/")
        model = os.environ.get("BOUNTY_OLLAMA_MODEL") or os.environ.get("BOUNTY_LOCAL_MODEL") or "llama3.1"
        api_key = "ollama"  # Ollama ignores the key but the OpenAI client expects one
        request_timeout = 600
    else:
        api_key = os.environ.get("BOUNTY_API_KEY") or os.environ.get("OPENAI_API_KEY")
        base_url = os.environ.get("BOUNTY_BASE_URL", "https://api.openai.com/v1").rstrip("/")
        model = os.environ.get("BOUNTY_MODEL")
        request_timeout = 120
        if not api_key or not model:
            die("set BOUNTY_API_KEY and BOUNTY_MODEL (or use --local / BOUNTY_LLM=local for Ollama)")
    system = (
        "You are a bug bounty copilot for authorized testing. "
        "Strictly respect the given scope, do not invent evidence, "
        "suggest low-impact actions first, and ask for confirmation before active actions. "
        "Explain your reasoning and say how to document the result.\n\n"
        f"Program: {state['program']}\nScope: {', '.join(state['scope'])}"
    )
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.1,
    }
    if model.lower().startswith(("gpt-5", "o1", "o3", "o4")):
        payload["max_completion_tokens"] = 1200
    else:
        payload["max_tokens"] = 1200
    request = urllib.request.Request(
        f"{base_url}/chat/completions",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=request_timeout) as response:
            result = json.loads(response.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:500]
        die(f"LLM returned HTTP {exc.code}: {detail}")
    except urllib.error.URLError as exc:
        die(f"could not reach the LLM: {exc.reason}")
    try:
        return result["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        die("unexpected response from the OpenAI-compatible endpoint")
    return ""


def cmd_ask(args: argparse.Namespace) -> None:
    state = read_state()
    prompt = args.prompt or sys.stdin.read()
    if not prompt.strip():
        die("provide a question or send it via stdin")
    context = session_context_for_llm()
    enriched_prompt = prompt.strip()
    if context:
        enriched_prompt = (
            f"Operator question:\n{enriched_prompt}\n\n"
            "Redacted local session context:\n"
            f"{context}"
        )
    if getattr(args, "agent", None):
        persona, play_ref = _load_agent(args.agent)
        if not persona:
            die(f"agent not found: {args.agent} (see: ghosthunt agents)")
        block = f"Act as this specialist hunting agent:\n{persona}"
        paired = _load_playbook(play_ref) if play_ref else None
        if paired:
            block += f"\n\nMethodology to apply ({play_ref}):\n{paired}"
        enriched_prompt = f"{block}\n\n{enriched_prompt}"
    playbook = _load_playbook(args.play) if getattr(args, "play", None) else None
    if playbook:
        enriched_prompt = f"Apply this hunting methodology:\n{playbook}\n\n{enriched_prompt}"
    answer = llm_request(enriched_prompt, state, local=getattr(args, "local", False))
    print(answer.rstrip())
    with CHAT_FILE.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"at": timestamp(), "prompt": prompt, "answer": answer}) + "\n")


def cmd_exploit(args: argparse.Namespace) -> None:
    """Build a minimal, scope-bounded proof-of-concept for a confirmed candidate."""
    state = read_state()
    finding = (getattr(args, "finding", None) or "").strip() or sys.stdin.read().strip()
    if not finding:
        die("describe the candidate to reproduce, e.g. 'IDOR on /api/orders/{id} at pay.example.com'")
    agent_name = getattr(args, "agent", None) or "poc-builder"
    persona, play_ref = _load_agent(agent_name)
    guidance = (
        "You assist an AUTHORIZED bug bounty operator to build a MINIMAL, SAFE proof-of-concept that "
        "DEMONSTRATES a vulnerability and its impact for a report. Hard rules: stay strictly in scope; "
        "use the LEAST-invasive PoC (read-only proof where possible); use two accounts the operator "
        "controls for access-control bugs; NEVER propose destructive actions, data deletion, DoS, "
        "brute-force, or mass exploitation. Output: (1) exact reproduction steps with concrete curl/HTTP "
        "requests, (2) what response/data PROVES impact, (3) how to capture the evidence, (4) a short "
        "write-up. State assumptions explicitly; if impact cannot be shown safely, say so."
    )
    if persona:
        guidance += f"\n\nSpecialist persona ({agent_name}):\n{persona}"
        paired = _load_playbook(play_ref) if play_ref else None
        if paired:
            guidance += f"\n\nMethodology ({play_ref}):\n{paired}"
    prompt = (
        f"{guidance}\n\nFINDING TO REPRODUCE:\n{finding}\n\n"
        f"SESSION EVIDENCE (redacted):\n{session_context_for_llm(8000)}"
    )
    answer = llm_request(prompt, state, local=getattr(args, "local", False))
    print(answer.rstrip())
    append_note(f"Exploit PoC: {agent_name}", f"Finding: {finding}\n\n{answer}")
    print(paint(
        "\nReminder: run any active check via `run --target H -- <tool> --confirm` — in scope, minimal impact. "
        "A PoC proves impact; it does not damage the target.", DGREEN))


def cmd_report(_: argparse.Namespace) -> None:
    state = read_state()
    evidence = sorted(EVIDENCE_DIR.glob("*")) if EVIDENCE_DIR.exists() else []
    report = [
        f"# Bug Bounty Report — {state['program']}",
        "",
        f"- Session date: {state['created_at']}",
        f"- Scope: {', '.join(state['scope'])}",
        "- Method: operator approved each command; evidence below.",
        "",
        "## Notes",
        "",
        NOTES_FILE.read_text(encoding="utf-8") if NOTES_FILE.exists() else "(no notes)",
        "",
        "## Evidence",
        "",
    ]
    report.extend(f"- `{item.name}`" for item in evidence)
    destination = ROOT / "report.md"
    destination.write_text("\n".join(report).rstrip() + "\n", encoding="utf-8")
    print(f"Base report generated at {destination}")


def cmd_doctor(_: argparse.Namespace) -> None:
    print(f"Python: {sys.version.split()[0]}")
    print(f"Architecture: {os.uname().machine}")
    print(f"Session: {'OK' if STATE_FILE.exists() else 'not initialized'}")

    section("Engines")
    nightwatch = (
        os.environ.get("NIGHTWATCH_BIN")
        or shutil.which("nighwatch")
        or shutil.which("nightwatch")
        or shutil.which("agentsec")
        or (ENGINES_DIR / "nighwatch" / "src").exists()  # bundled copy
    )
    engines = {
        "nightwatch (scope-enforced control plane, bundled)": bool(nightwatch),
        "airecon (autonomous recon)": bool(shutil.which("airecon")),
        "strix (validation)": bool(shutil.which("strix")),
        "ollama (local reasoning, no API cost)": bool(shutil.which("ollama")),
    }
    for label, available in engines.items():
        print(f"{'OK ' if available else '---'} {label}")
    # Local Ollama bridge
    ollama_url = os.environ.get("BOUNTY_OLLAMA_URL", "http://127.0.0.1:11434/v1").rstrip("/")
    ollama_model = os.environ.get("BOUNTY_OLLAMA_MODEL") or os.environ.get("BOUNTY_LOCAL_MODEL") or "llama3.1"
    tags_url = (ollama_url[:-3] if ollama_url.endswith("/v1") else ollama_url) + "/api/tags"
    try:
        with urllib.request.urlopen(tags_url, timeout=4) as response:
            names = [m.get("name", "") for m in json.loads(response.read().decode()).get("models", [])]
        has_model = ollama_model in names
        print(f"OK  ollama reachable at {ollama_url} ({len(names)} models)")
        print(f"{'OK ' if has_model else '---'} ollama model '{ollama_model}'"
              + ("" if has_model else f" (not pulled; available: {', '.join(names[:4])}…)"))
    except (urllib.error.URLError, OSError, ValueError):
        print(f"--- ollama not reachable at {ollama_url} (start it / check BOUNTY_OLLAMA_URL)")

    h1_ready = bool(os.environ.get("HACKERONE_API_USERNAME") and os.environ.get("HACKERONE_API_TOKEN"))
    print(f"{'OK ' if h1_ready else '---'} hackerone api credentials (env)")
    llm_ready = bool(
        (os.environ.get("BOUNTY_API_KEY") or os.environ.get("OPENAI_API_KEY"))
        and os.environ.get("BOUNTY_MODEL")
    )
    print(f"{'OK ' if llm_ready else '---'} ask llm credentials (env)")

    section("VM tools")
    for tool in sorted(SAFE_TOOLS | ACTIVE_TOOLS):
        print(f"{'OK ' if shutil.which(tool) else '---'} {tool}")


H1_BASE = "https://api.hackerone.com/v1"
H1_SEVERITIES = ["none", "low", "medium", "high", "critical"]


def h1_credentials() -> tuple[str, str]:
    user = os.environ.get("HACKERONE_API_USERNAME")
    token = os.environ.get("HACKERONE_API_TOKEN")
    if not user or not token:
        die(
            "set HACKERONE_API_USERNAME and HACKERONE_API_TOKEN "
            "(generate at https://hackerone.com/settings/api_token)"
        )
    return user, token


def h1_request(method: str, path: str, *, params: dict | None = None, body: dict | None = None) -> dict:
    user, token = h1_credentials()
    url = f"{H1_BASE}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    auth = base64.b64encode(f"{user}:{token}".encode()).decode()
    headers = {"Authorization": f"Basic {auth}", "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read().decode()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:800]
        die(f"HackerOne returned HTTP {exc.code}: {detail}")
    except urllib.error.URLError as exc:
        die(f"could not reach the HackerOne API: {exc.reason}")
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        die(f"invalid response from the HackerOne API: {exc}")
    return {}


def cmd_h1_programs(_: argparse.Namespace) -> None:
    payload = h1_request("GET", "/hackers/programs", params={"page[size]": 100})
    items = payload.get("data", []) if isinstance(payload, dict) else []
    if not items:
        print("No programs returned (does the account have access to any?).")
        return
    print(f"{len(items)} program(s) ($ = pays bounty):")
    for item in items:
        attrs = item.get("attributes", {})
        handle = attrs.get("handle", "?")
        state = attrs.get("state", "?")
        flag = "$" if attrs.get("offers_bounties") else " "
        print(f"  {flag} {handle:30} {state}")
    if isinstance(payload.get("links"), dict) and payload["links"].get("next"):
        print("(more pages available)")


def _h1_handle(args: argparse.Namespace, state: dict) -> str:
    handle = getattr(args, "program", None) or state.get("h1_handle")
    if not handle:
        die("no --program and the session has no HackerOne handle; run: ghosthunt h1 init --program HANDLE")
    return handle


def cmd_h1_init(args: argparse.Namespace) -> None:
    """Create a session directly from a HackerOne program's eligible scope."""
    handle = args.program
    slug = _engagement_slug(handle)
    if (BASE / "engagements" / slug / "engagement.json").exists() and not args.force:
        die("engagement for this program already exists; use --force to refresh")
    payload = h1_request(
        "GET", f"/hackers/programs/{handle}/structured_scopes", params={"page[size]": 100}
    )
    rows = payload.get("data", []) if isinstance(payload, dict) else []
    if not rows:
        die(f"no structured scope for '{handle}' (correct handle? account access?)")
    scope: list[str] = []
    skipped: list[str] = []
    for row in rows:
        attrs = row.get("attributes", {})
        if not attrs.get("eligible_for_submission"):
            continue
        asset_type = attrs.get("asset_type", "?")
        raw_ident = str(attrs.get("asset_identifier", "")).strip()
        if not raw_ident:
            continue
        # HackerOne sometimes crams several assets into one identifier, comma-separated.
        for ident in [p.strip() for p in raw_ident.split(",") if p.strip()]:
            if asset_type in {"URL", "DOMAIN"}:
                host = normalize_scope(ident)
                if host:
                    scope.append(host)
            elif asset_type == "WILDCARD":
                wildcard = ident if ident.startswith("*.") else "*." + ident.lstrip("*.").lstrip(".")
                scope.append(normalize_scope(wildcard))
            elif asset_type in {"CIDR", "IP_ADDRESS"}:
                scope.append(ident.lower())
            else:
                skipped.append(f"{asset_type}:{ident}")
    scope = sorted({item for item in scope if item})
    if not scope:
        die("no eligible in-scope web/host assets found for this program (code-only program?)")
    _use_engagement(handle)  # switch only after we know the scope is valid
    ROOT.mkdir(parents=True, exist_ok=True)
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    state = {
        "program": handle,
        "h1_handle": handle,
        "scope": scope,
        "created_at": timestamp(),
        "mode": "operator-approved",
    }
    STATE_FILE.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    NOTES_FILE.write_text(
        f"# {handle} (HackerOne)\n\nAuthorized scope (eligible_for_submission):\n"
        + "\n".join(f"- `{item}`" for item in scope)
        + "\n\nOnly test what the program policy allows.\n",
        encoding="utf-8",
    )
    print(f"Session created from HackerOne program '{handle}'.")
    print(f"In-scope assets: {len(scope)}")
    for item in scope:
        print(f"  - {item}")
    if skipped:
        print(f"Skipped {len(skipped)} non-web asset(s): {', '.join(skipped[:6])}{' …' if len(skipped) > 6 else ''}")
    print("\nNext: ghosthunt engage --target <one in-scope host>")


def cmd_h1_scope(args: argparse.Namespace) -> None:
    state = read_state()
    handle = _h1_handle(args, state)
    payload = h1_request(
        "GET", f"/hackers/programs/{handle}/structured_scopes", params={"page[size]": 100}
    )
    rows = payload.get("data", []) if isinstance(payload, dict) else []
    if not rows:
        die(f"no structured scope for '{handle}' (correct handle? access to the program?)")
    eligible: list[str] = []
    lines: list[str] = []
    for row in rows:
        attrs = row.get("attributes", {})
        asset_type = attrs.get("asset_type", "?")
        ident = attrs.get("asset_identifier", "?")
        mark = "IN " if attrs.get("eligible_for_submission") else "OUT"
        money = "$" if attrs.get("eligible_for_bounties") else " "
        scope_id = row.get("id", "?")
        lines.append(f"[{mark}]{money} {asset_type:12} {ident}   (scope_id={scope_id})")
        if attrs.get("eligible_for_submission") and asset_type in {
            "URL",
            "DOMAIN",
            "WILDCARD",
            "CIDR",
            "IP_ADDRESS",
        }:
            for piece in [p.strip() for p in str(ident).split(",") if p.strip()]:
                host = normalize_scope(piece)
                if host:
                    eligible.append(host)
    print("\n".join(lines))
    H1_DIR.mkdir(parents=True, exist_ok=True)
    (H1_DIR / f"{handle}-scope.json").write_text(
        json.dumps(rows, indent=2) + "\n", encoding="utf-8"
    )
    append_note(
        f"H1 scope: {handle}",
        "\n".join(lines) + f"\n\nAssets eligible for submission: {len(eligible)}",
    )
    if args.apply:
        state = read_state()
        current = list(state.get("scope", []))
        merged = sorted(set(current) | {normalize_scope(h) for h in eligible})
        state["scope"] = merged
        STATE_FILE.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
        added = sorted(set(merged) - set(current))
        print(f"\nSession scope updated (+{len(added)}): {', '.join(added) or 'nothing new'}")
    else:
        print("\n(Use --apply to merge the eligible assets into the session scope.)")


def cmd_h1_submit(args: argparse.Namespace) -> None:
    state = read_state()
    handle = _h1_handle(args, state)
    title = (args.title or "").strip()
    impact = (args.impact or "").strip()
    if args.file:
        source = Path(args.file).expanduser()
        if not source.is_file():
            die(f"file not found: {source}")
        vuln_info = source.read_text(encoding="utf-8", errors="replace")
    else:
        vuln_info = sys.stdin.read()
    if not title or not impact or not vuln_info.strip():
        die("submit requires --title, --impact and a body (--file or stdin); the H1 API needs all three")

    attributes: dict = {
        "team_handle": handle,
        "title": title,
        "vulnerability_information": vuln_info,
        "impact": impact,
    }
    if args.severity:
        attributes["severity_rating"] = args.severity
    if args.scope_id:
        attributes["structured_scope_id"] = args.scope_id
    if args.weakness_id:
        attributes["weakness_id"] = (
            int(args.weakness_id) if str(args.weakness_id).isdigit() else args.weakness_id
        )

    print("=" * 60)
    print("PREVIEW — nothing has been sent yet")
    print("=" * 60)
    print(f"Program (team_handle): {handle}")
    print(f"Title: {title}")
    print(f"Severity: {args.severity or '(not set)'}")
    if args.scope_id:
        print(f"structured_scope_id: {args.scope_id}")
    if args.weakness_id:
        print(f"weakness_id: {args.weakness_id}")
    print(f"\nImpact:\n{impact}\n")
    print(f"Vulnerability information ({len(vuln_info)} chars):\n{vuln_info}")
    print("=" * 60)
    print("This SENDS a real report to HackerOne, visible to the program team.")
    print("Invalid reports hurt your reputation. Only send with real reproduction and impact.")

    if not args.confirm:
        die("add --confirm to enable sending (a typed confirmation is still required)")
    try:
        answer = input('Type exactly  SEND IT  to submit (anything else cancels): ')
    except EOFError:
        answer = ""
    if answer.strip() != "SEND IT":
        die("submission cancelled by the operator")

    payload = h1_request(
        "POST", "/hackers/reports", body={"data": {"type": "report", "attributes": attributes}}
    )
    data = payload.get("data", {}) if isinstance(payload, dict) else {}
    report_id = data.get("id", "?")
    print(f"\nReport submitted. ID: {report_id}")
    H1_DIR.mkdir(parents=True, exist_ok=True)
    (H1_DIR / f"submitted-{report_id}.json").write_text(
        json.dumps(payload, indent=2) + "\n", encoding="utf-8"
    )
    append_note(f"H1 submit: {handle}", f"Report ID {report_id} — title '{title}'.")


NIGHTWATCH_NEEDS_CONFIG = {
    "scope",
    "policy",
    "run",
    "plan",
    "http",
    "authz",
    "investigate",
    "active",
    "browser",
}


def _nightwatch_cmd() -> tuple[list[str], dict | None]:
    """Resolve the Nighwatch CLI, preferring the copy bundled in this repo.

    Order: NIGHTWATCH_BIN override → an installed binary on PATH → the bundled
    source under engines/nighwatch/src run via PYTHONPATH (no separate install
    needed, since Nighwatch ships with GHOSTHUNT). Returns (command, env).
    """
    override = os.environ.get("NIGHTWATCH_BIN")
    if override:
        return shlex.split(override), None
    for name in ("nighwatch", "nightwatch", "agentsec"):
        found = shutil.which(name)
        if found:
            return [found], None
    bundled_src = ENGINES_DIR / "nighwatch" / "src"
    if bundled_src.exists():
        env = dict(os.environ)
        path = str(bundled_src.resolve())
        env["PYTHONPATH"] = path + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
        return [sys.executable, "-m", "nighwatch"], env
    return [sys.executable, "-m", "nighwatch"], None


def cmd_nightwatch_config(args: argparse.Namespace) -> None:
    """Generate a Nighwatch engagement config from the session scope. No feature is reimplemented."""
    state = read_state()
    methods = sorted({m.upper() for m in (args.methods or ["GET"])})
    hosts: list[str] = []
    warnings: list[str] = []
    for entry in state["scope"]:
        entry = normalize_scope(entry)
        if entry.startswith("*."):
            apex = entry[2:]
            hosts.append(apex)
            warnings.append(
                f"wildcard {entry}: added apex '{apex}'. Nighwatch matches exact hosts — "
                "add discovered subdomains explicitly (engage populates in-scope-hosts.txt)."
            )
        elif "/" in entry or (entry.replace(".", "").isdigit() and entry.count(".") == 3):
            warnings.append(f"skipped '{entry}': Nighwatch origins are host-based, not CIDR.")
        else:
            hosts.append(entry)
    # Reuse hosts already discovered by `engage` instead of re-scanning.
    discovered = WORK_DIR / "in-scope-hosts.txt"
    if discovered.exists():
        for line in discovered.read_text(encoding="utf-8", errors="replace").splitlines():
            host = host_from_value(line)
            if host and in_scope(host, state["scope"]):
                hosts.append(host)
    unique: list[str] = []
    for host in hosts:
        if host and host not in unique:
            unique.append(host)
    origins = [
        {
            "scheme": "https",
            "host": host,
            "ports": [443],
            "path_prefixes": ["/"],
            "methods": methods,
        }
        for host in unique
    ]
    active = bool(args.active)
    slug = re.sub(r"[^a-z0-9]+", "_", state["program"].lower()).strip("_")[:24] or "session"
    config = {
        "engagement_id": f"bounty_{slug}",
        "authorization": {
            "artifact_id": args.authorization or "operator-attested-authorization"
        },
        "allowed_origins": origins,
        "excluded_hosts": [],
        "auth_profiles": ["owner_user", "non_owner_user"],
        "limits": {
            "requests_per_second": 1.0,
            "max_requests": 100,
            "max_concurrent_requests": 1,
            "max_cost_usd": 1.0,
        },
        "actions": {
            "read_only": True,
            "state_mutation": active,
            "destructive": False,
            "require_state_change_approval": True,
            "require_destructive_approval": True,
        },
        "network": {"allow_private_addresses": False},
        "active_testing": {
            "enabled": active,
            "max_payload_bytes": 8192,
            "max_cases": 25,
            "kill_switch_file": ".nighwatch-kill",
        },
    }
    NIGHTWATCH_DIR.mkdir(parents=True, exist_ok=True)
    out = Path(args.out).expanduser() if args.out else (NIGHTWATCH_DIR / "engagement.json")
    out.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    print(f"Nighwatch engagement config written: {out}")
    print(f"Origins: {len(origins)} host(s); methods {methods}; active_testing={active}")
    for warning in warnings:
        print(f"  ! {warning}")
    if not origins:
        print("  ! no hosts mapped — check the session scope (ghosthunt status)")
    append_note("Nighwatch", f"Generated engagement config with {len(origins)} origin(s), active={active}.")
    print("\nDrive it with:  python3 bounty.py nightwatch run -- scope validate")


def cmd_nightwatch_run(args: argparse.Namespace) -> None:
    """Passthrough to the Nighwatch CLI with this session's config auto-attached."""
    read_state()
    passthrough = list(args.args)
    if passthrough and passthrough[0] == "--":
        passthrough.pop(0)
    if not passthrough:
        die("use: ghosthunt nightwatch run -- <nighwatch args>  (e.g. -- scope validate)")
    config = NIGHTWATCH_DIR / "engagement.json"
    needs_config = passthrough[0] in NIGHTWATCH_NEEDS_CONFIG or (
        passthrough[0] == "tools" and len(passthrough) > 1 and passthrough[1] in {"plan", "run"}
    )
    if needs_config and "--config" not in passthrough and "-c" not in passthrough:
        if not config.exists():
            die("no Nighwatch config yet; run: ghosthunt nightwatch config")
        passthrough += ["--config", str(config)]
    base, env = _nightwatch_cmd()
    command = base + passthrough
    print(paint(f"→ {shlex.join(command)}", DIM))
    try:
        completed = subprocess.run(command, env=env)
    except FileNotFoundError:
        die(
            "Nighwatch not found. It ships bundled at engines/nighwatch — "
            "check that directory exists, or set NIGHTWATCH_BIN / BOUNTY_ENGINES_DIR."
        )
    raise SystemExit(completed.returncode)


ENGINES_DIR = Path(os.environ.get("BOUNTY_ENGINES_DIR", str(Path.cwd() / "engines")))

# The unified engine registry. Each repo is reused as-is; nothing is reimplemented.
# burpgpt is intentionally excluded: its Community edition is dead upstream.
ENGINES: dict[str, dict] = {
    "nightwatch": {
        "role": "scope-enforced control plane, local Ollama ($0 tokens)",
        "priority": "P0", "kind": "cli", "phase": "recon+validate",
        "bins": ["nighwatch", "nightwatch", "agentsec"], "module": "nighwatch", "src": "nighwatch/src",
        "note": "scope-linked runs: use `ghosthunt nightwatch config` then `ghosthunt nightwatch run`",
    },
    "airecon": {
        "role": "autonomous recon agent (API tokens; apply frugal-airecon.py first)",
        "priority": "P0", "kind": "cli", "phase": "recon",
        "bins": ["airecon"], "module": "airecon", "src": "airecon",
    },
    "strix": {
        "role": "end-to-end validation/repro runner (Docker; owned + lab only)",
        "priority": "P2", "kind": "cli", "phase": "validate",
        "bins": ["strix"], "module": "strix", "src": "strix",
    },
    "shellgpt": {
        "role": "terminal LLM helper (overlaps `ask`)",
        "priority": "P3", "kind": "cli", "phase": "analysis",
        "bins": ["sgpt"], "module": "sgpt", "src": "shellgpt",
    },
    "kaligpt": {
        "role": "AI Kali command helper",
        "priority": "P3", "kind": "cli", "phase": "analysis",
        "script": "kaligpt/kaligpt.py",
    },
    "pentestgpt": {
        "role": "alternative agent (reference; do not run beside airecon)",
        "priority": "P3", "kind": "cli", "phase": "analysis",
        "bins": ["pentestgpt-legacy"], "module": "pentestgpt_legacy.main", "src": "pentestgpt",
    },
    "hexstrike": {
        "role": "MCP tool-orchestration server (expose only scope-checked tools)",
        "priority": "P2", "kind": "mcp", "phase": "recon+validate",
        "launch": "python3 engines/hexstrike/hexstrike_server.py",
    },
    "recongpt": {
        "role": "passive-evidence web app, 40 modules (React/Node)",
        "priority": "P1", "kind": "webapp", "phase": "recon",
        "launch": "cd engines/recongpt && npm install && npm run dev",
    },
    "pwn": {
        "role": "Claude Code methodology: 50 agents / 26 commands / 11 skills",
        "priority": "P1", "kind": "skills", "phase": "methodology",
        "launch": "copy engines/pwn skills into .claude/skills, or run its installer CLI",
    },
    "claude-red": {
        "role": "offensive SKILL.md playbooks (read-only guidance)",
        "priority": "P1", "kind": "skills", "phase": "methodology",
        "launch": "python3 engines/claude-red/convert_skills.py",
    },
}


def _resolve_engine(name: str, meta: dict) -> tuple[list[str] | None, dict | None]:
    """Return (command, env) to run a CLI engine, reusing an installed binary or the repo in place."""
    override = os.environ.get(f"BOUNTY_{name.upper().replace('-', '_')}_BIN")
    if override:
        return shlex.split(override), None
    for binary in meta.get("bins", []):
        found = shutil.which(binary)
        if found:
            return [found], None
    src, module = meta.get("src"), meta.get("module")
    if src and module and (ENGINES_DIR / src).exists():
        env = dict(os.environ)
        path = str((ENGINES_DIR / src).resolve())
        env["PYTHONPATH"] = path + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
        return [sys.executable, "-m", module], env
    script = meta.get("script")
    if script and (ENGINES_DIR / script).exists():
        return [sys.executable, str((ENGINES_DIR / script).resolve())], None
    return None, None


def _engine_available(name: str, meta: dict) -> bool:
    if meta["kind"] == "cli":
        cmd, _ = _resolve_engine(name, meta)
        return cmd is not None
    repo = ENGINES_DIR / name
    return repo.exists()


def cmd_engine_list(_: argparse.Namespace) -> None:
    section("Engines (one app, engines reused as-is)")
    order = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}
    for name, meta in sorted(ENGINES.items(), key=lambda kv: (order.get(kv[1]["priority"], 9), kv[0])):
        ok = _engine_available(name, meta)
        mark = paint("OK ", GREEN) if ok else paint("---", DIM)
        tag = paint(f"[{meta['priority']} {meta['kind']:6}]", DGREEN)
        print(f"{mark} {tag} {paint(name, BOLD):22} {meta['role']}")
    print("\nDetails: ghosthunt engine info <name>   |   Run a CLI engine: ghosthunt engine run <name> -- <args>")


def cmd_engine_info(args: argparse.Namespace) -> None:
    meta = ENGINES.get(args.name)
    if not meta:
        die(f"unknown engine: {args.name} (see: ghosthunt engine list)")
    print(f"{paint(args.name, BOLD + GREEN)}  [{meta['priority']} · {meta['kind']} · phase: {meta['phase']}]")
    print(f"Role: {meta['role']}")
    print(f"Available: {'yes' if _engine_available(args.name, meta) else 'no (not installed / repo missing)'}")
    if meta["kind"] == "cli":
        cmd, _ = _resolve_engine(args.name, meta)
        print(f"Resolves to: {shlex.join(cmd) if cmd else '(not found — install it or clone into engines/)'}")
        print(f"Run it: ghosthunt engine run {args.name} -- <args>")
    else:
        print(f"Launch (manual, not a CLI passthrough): {meta.get('launch', 'n/a')}")
    if meta.get("note"):
        print(f"Note: {meta['note']}")


def cmd_engine_run(args: argparse.Namespace) -> None:
    read_state()
    meta = ENGINES.get(args.name)
    if not meta:
        die(f"unknown engine: {args.name} (see: ghosthunt engine list)")
    if meta["kind"] != "cli":
        die(f"{args.name} is a {meta['kind']}, not a CLI engine. See: ghosthunt engine info {args.name}")
    passthrough = list(args.args)
    if passthrough and passthrough[0] == "--":
        passthrough.pop(0)
    cmd, env = _resolve_engine(args.name, meta)
    if not cmd:
        die(f"{args.name} not found. Install it, clone into {ENGINES_DIR}/{args.name}, or set BOUNTY_{args.name.upper().replace('-', '_')}_BIN.")
    full = cmd + passthrough
    print(paint(f"→ {shlex.join(full)}", DIM))
    print(paint(f"reminder: {args.name} does not know your scope — keep it on in-scope targets only.", DGREEN))
    try:
        completed = subprocess.run(full, env=env)
    except FileNotFoundError:
        die(f"could not launch {args.name}")
    raise SystemExit(completed.returncode)


PLAYBOOK_DIRS = [ENGINES_DIR / "pwn" / "skills", ENGINES_DIR / "claude-red" / "Skills"]


def _list_playbooks() -> list[tuple[str, Path]]:
    found: list[tuple[str, Path]] = []
    for base in PLAYBOOK_DIRS:
        if base.exists():
            for skill in sorted(base.rglob("SKILL.md")):
                found.append((skill.parent.name, skill))
    return found


def _load_playbook(name: str, max_chars: int = 6000) -> str | None:
    for pname, path in _list_playbooks():
        if pname == name:
            try:
                return path.read_text(encoding="utf-8", errors="replace")[:max_chars]
            except OSError:
                return None
    return None


def _triage_methodology(max_each: int = 3500) -> str:
    """Small, always-injected methodology so AI triage applies a real gate."""
    parts: list[str] = []
    for name in ("triage-validation", "hunting-methodology"):
        content = _load_playbook(name, max_each)
        if content:
            parts.append(f"[{name}]\n{content}")
    return "\n\n".join(parts)


AGENTS_DIR = ENGINES_DIR / "pwn" / ".claude" / "agents"


def _list_agents() -> list[tuple[str, Path]]:
    if not AGENTS_DIR.exists():
        return []
    return [(p.stem, p) for p in sorted(AGENTS_DIR.glob("*.md"))]


def _agent_description(path: Path) -> str:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    match = re.search(r'description:\s*"?(.+?)"?\s*(?:\n\w|\n---)', text, re.DOTALL)
    if match:
        return " ".join(match.group(1).split())[:110]
    return ""


def _load_agent(name: str, max_chars: int = 5000) -> tuple[str | None, str | None]:
    """Return (persona body without frontmatter, referenced playbook name)."""
    for aname, path in _list_agents():
        if aname == name:
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                return None, None
            body = text
            if text.startswith("---"):
                parts = text.split("---", 2)
                if len(parts) >= 3:
                    body = parts[2]
            ref = re.search(r"skills/([a-z0-9-]+)/SKILL\.md", text)
            return body.strip()[:max_chars], (ref.group(1) if ref else None)
    return None, None


def cmd_agents(_: argparse.Namespace) -> None:
    agents = _list_agents()
    if not agents:
        die("no agents found (is engines/pwn present? check BOUNTY_ENGINES_DIR)")
    section(f"Hunting agents ({len(agents)}) — from pwn/.claude/agents")
    for name, path in agents:
        print(f"  {paint(name, GREEN):26} {_agent_description(path)}")
    print("\nUse one: ghosthunt ask --agent <name> \"your question\"  (auto-loads its methodology)")


def cmd_play(args: argparse.Namespace) -> None:
    playbooks = _list_playbooks()
    if not playbooks:
        die("no playbooks found (are engines/pwn and engines/claude-red present? check BOUNTY_ENGINES_DIR)")
    if args.play_command == "list":
        section("Methodology playbooks (pwn + claude-red)")
        for pname, path in playbooks:
            src = "pwn" if f"{os.sep}pwn{os.sep}" in str(path) else "claude-red"
            print(f"  {paint(pname, GREEN):40} [{src}]")
        print("\nRead one:  ghosthunt play show <name>")
        print("Use in AI: ghosthunt ask --play <name> \"your question\"")
    elif args.play_command == "show":
        content = _load_playbook(args.name, max_chars=200000)
        if not content:
            die(f"playbook not found: {args.name} (see: ghosthunt play list)")
        print(content)


def _ask(text: str) -> str:
    try:
        return input(text).strip()
    except EOFError:
        return ""


def _select(options: list[str], title: str = "", page: int = 15) -> str | None:
    """Arrow-key (↑/↓ or j/k) selector. Returns the chosen option, or None if cancelled/non-tty."""
    if not options or not (sys.stdin.isatty() and sys.stdout.isatty()):
        return None
    try:
        import termios
        import tty
    except Exception:
        return None
    if not title:
        title = "↑/↓ move · Enter pick · q cancel"
    idx = 0
    top = 0
    height = min(page, len(options))
    drawn = 0
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)

    def render() -> None:
        nonlocal drawn, top
        if idx < top:
            top = idx
        if idx >= top + height:
            top = idx - height + 1
        if drawn:
            sys.stdout.write(f"\033[{drawn}A")
        lines = [paint(title, DGREEN)]
        for i in range(top, min(top + height, len(options))):
            if i == idx:
                lines.append(paint(f" › {options[i]}", BOLD + GREEN))
            else:
                lines.append(f"   {options[i]}")
        more = len(options) - (top + height)
        lines.append(paint(f"   … +{more} more" if more > 0 else "   ", DIM))
        sys.stdout.write("".join("\033[2K" + ln + "\n" for ln in lines))
        sys.stdout.flush()
        drawn = len(lines)

    try:
        tty.setcbreak(fd)
        render()
        while True:
            ch = sys.stdin.read(1)
            if ch in ("\r", "\n"):
                return options[idx]
            if ch in ("q", "\x03"):
                return None
            if ch == "\x1b":
                if sys.stdin.read(1) == "[":
                    arrow = sys.stdin.read(1)
                    if arrow == "A":
                        idx = (idx - 1) % len(options)
                    elif arrow == "B":
                        idx = (idx + 1) % len(options)
                    render()
                continue
            if ch == "k":
                idx = (idx - 1) % len(options)
                render()
            elif ch == "j":
                idx = (idx + 1) % len(options)
                render()
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)
        sys.stdout.write("\n")


def _menu_nuclei() -> None:
    read_state()
    live = WORK_DIR / "hunt-live.txt"
    hosts = WORK_DIR / "in-scope-hosts.txt"
    target_list = live if live.exists() else hosts
    if not target_list.exists():
        die("no host list yet; run a recon/hunt first (option 1 or 2)")
    if not shutil.which("nuclei"):
        die("nuclei not installed (sudo apt install -y nuclei)")
    if _ask("Run ACTIVE nuclei scan? confirm program allows it [y/N]: ").lower() not in ("y", "yes"):
        print("cancelled.")
        return
    gentle = _ask("Gentle mode (small/slow site)? [y/N]: ").lower() == "y"
    _run_evidence_stream(_nuclei_command(target_list, gentle), "nuclei")
    cmd_report(argparse.Namespace())


def _h1_programs_list(limit: int = 100) -> list[tuple[str, bool]]:
    payload = h1_request("GET", "/hackers/programs", params={"page[size]": limit})
    items = payload.get("data", []) if isinstance(payload, dict) else []
    rows = []
    for item in items:
        attrs = item.get("attributes", {})
        handle = attrs.get("handle")
        if handle:
            rows.append((handle, bool(attrs.get("offers_bounties"))))
    rows.sort(key=lambda r: (not r[1], r[0]))  # bounty-paying first, then alphabetical
    return rows


def _list_engagement_slugs() -> list[str]:
    base = BASE / "engagements"
    if not base.exists():
        return []
    return sorted(p.name for p in base.iterdir() if p.is_dir() and (p / "engagement.json").exists())


def _menu_start_from_handle(handle: str) -> None:
    cmd_h1_init(argparse.Namespace(program=handle, force=True))
    if _ask("Pull & apply the program's scope now? [Y/n]: ").lower() != "n":
        try:
            cmd_h1_scope(argparse.Namespace(program=None, apply=True))
        except SystemExit:
            pass
    print(f"\nReady. Next: menu [1] to hunt, or [2] to recon a host in {handle}.")


def _menu_h1() -> None:
    print(
        "\n  [a] pick a HackerOne program (↑/↓)   [b] type a handle   [c] pull scope"
        "\n  [d] submit help   [e] CUSTOM scope (your own targets)   [f] switch engagement (↑/↓)"
    )
    choice = _ask("session> ")
    if choice == "a":
        try:
            rows = _h1_programs_list()
        except SystemExit:
            return
        if not rows:
            print("no programs returned.")
            return
        labels = [f"{'$' if bounty else ' '} {handle}" for handle, bounty in rows]
        picked = _select(labels, "Pick a program  ($ = pays bounty)  ↑/↓ · Enter · q")
        handle = picked.split()[-1] if picked else _ask("\nHandle (blank to cancel): ")
        if handle:
            _menu_start_from_handle(handle)
    elif choice == "b":
        handle = _ask("program handle: ")
        if handle:
            _menu_start_from_handle(handle)
    elif choice == "c":
        try:
            cmd_h1_scope(argparse.Namespace(program=None, apply=True))
        except SystemExit:
            pass
    elif choice == "d":
        print("\nSubmit from the CLI (keeps you in control of the content):")
        print('  ghosthunt h1 submit --title "..." --impact "..." --file .bounty/report.md --severity high --confirm')
        print("Then type: SEND IT")
    elif choice == "e":
        name = _ask("Engagement name: ")
        raw = _ask("Scope hosts (space-separated, e.g. example.com *.example.com 10.0.0.0/24): ")
        hosts = raw.split()
        if name and hosts:
            cmd_init(argparse.Namespace(program=name, scope=hosts, force=True))
            print("\nReady. Next: menu [1] to hunt, or [2] to recon a host.")
        else:
            print("cancelled (need a name and at least one host).")
    elif choice == "f":
        slugs = _list_engagement_slugs()
        if not slugs:
            print("no saved engagements yet.")
            return
        picked = _select(slugs, "Switch to engagement  ↑/↓ · Enter · q")
        if picked:
            try:
                cmd_use(argparse.Namespace(name=picked))
            except SystemExit:
                pass


def _menu_dispatch(choice: str) -> None:
    if choice == "1":
        if _ask("Run FULL auto hunt with ACTIVE scanning? confirm scope allows it [y/N]: ").lower() in ("y", "yes"):
            deep = _ask("Include Strix deep analysis? (autonomous, costs $$ on gpt-4o) [y/N]: ").lower() == "y"
            gentle = _ask("Gentle mode (small/slow site)? [y/N]: ").lower() == "y"
            local = _ask("AI triage via free local Ollama? [Y/n]: ").lower() != "n"
            cmd_hunt(argparse.Namespace(confirm=True, deep=deep, local=local, gentle=gentle))
    elif choice == "2":
        target = _ask("Target host (e.g. app.example.com, or a wildcard parent like example.com): ")
        if target:
            cmd_engage(argparse.Namespace(target=target))
    elif choice == "3":
        _menu_nuclei()
    elif choice == "4":
        print(
            "\n  [a] build PoC / reproduction (AI, safe & scoped)"
            "\n  [b] run ONE active tool with confirmation (sqlmap/ffuf/nuclei…)"
            "\n  [c] Strix autonomous exploitation (authorized/owned targets only)"
        )
        sub = _ask("exploit> ")
        if sub == "a":
            finding = _ask("Describe the confirmed candidate (host + endpoint + class): ")
            if finding:
                agent = _ask("Agent (blank = poc-builder): ") or None
                local = _ask("Use free local Ollama? [y/N]: ").lower() in ("y", "yes")
                cmd_exploit(argparse.Namespace(finding=finding, agent=agent, local=local))
        elif sub == "b":
            target = _ask("Target host (must be in scope): ")
            raw = _ask("Command (e.g. sqlmap -u https://host/x?id=1 --batch): ")
            if target and raw and _ask("Active/possibly-intrusive — run it? [y/N]: ").lower() in ("y", "yes"):
                try:
                    cmd_run(argparse.Namespace(target=target, confirm=True, command=raw.split()))
                except SystemExit:
                    pass
        elif sub == "c":
            print(paint("Strix — authorized/owned targets only.", RED))
            print(paint(
                "! Strix is autonomous and can cost REAL money (a full gpt-4o run ≈ $5–8). "
                "Cut cost: set STRIX_LLM=openai/gpt-4o-mini, or point it at local Ollama.", RED))
            target = _ask("Strix target (URL / local dir / git repo): ")
            if target and _ask("This can cost money. Continue? [y/N]: ").lower() in ("y", "yes"):
                cmd_engine_run(argparse.Namespace(name="strix", args=["--target", target]))
    elif choice == "5":
        question = _ask("Ask the AI: ")
        if question:
            agent = _ask("Agent persona (blank = none, 'list' to browse): ")
            if agent == "list":
                cmd_agents(argparse.Namespace())
                agent = _ask("Agent (blank = none): ")
            local = _ask("Use free local Ollama? [Y/n]: ").lower() != "n"
            cmd_ask(argparse.Namespace(prompt=question, agent=(agent or None), play=None, local=local))
    elif choice == "6":
        cmd_report(argparse.Namespace())
    elif choice == "7":
        _menu_h1()
    elif choice == "8":
        cmd_engine_list(argparse.Namespace())
        name = _ask("Run engine (name, blank to skip): ")
        if name:
            extra = _ask("args (after --): ")
            cmd_engine_run(argparse.Namespace(name=name, args=shlex.split(extra)))
    elif choice == "9":
        cmd_status(argparse.Namespace())
    elif choice in ("k", "keys"):
        cmd_config(argparse.Namespace())
    elif choice in ("i", "install"):
        cmd_install(argparse.Namespace())
    elif choice in ("d", "doctor"):
        cmd_doctor(argparse.Namespace())
    else:
        print("unknown option.")


def cmd_install(_: argparse.Namespace) -> None:
    """Install/update the full tool arsenal (runs install.sh, needs sudo)."""
    script = Path(sys.argv[0]).resolve().parent / "install.sh"
    if not script.exists():
        die(f"install.sh not found next to the app ({script}); sync it from the share.")
    print(paint("Installing the pentest arsenal (needs sudo) — this can take a while…", GREEN))
    try:
        subprocess.run(["bash", str(script)])
    except FileNotFoundError:
        die("bash not found")


ENV_FILE = Path.home() / ".bounty.env"


def _env_set(key: str, value: str) -> None:
    lines: list[str] = []
    found = False
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.strip().startswith(key + "="):
                lines.append(f"{key}={value}")
                found = True
            else:
                lines.append(line)
    if not found:
        lines.append(f"{key}={value}")
    ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    try:
        ENV_FILE.chmod(0o600)
    except OSError:
        pass
    os.environ[key] = value  # take effect immediately in this session


def cmd_config(_: argparse.Namespace) -> None:
    """Interactive credentials wizard — writes ~/.bounty.env. Press Enter to keep current."""
    print(paint("Credentials setup — Enter keeps the current value.", BOLD + GREEN))
    fields = [
        ("HACKERONE_API_USERNAME", "HackerOne username/identifier"),
        ("HACKERONE_API_TOKEN", "HackerOne API token"),
        ("BOUNTY_API_KEY", "OpenAI API key (sk-...)"),
        ("BOUNTY_MODEL", "OpenAI model (e.g. gpt-4o)"),
        ("BOUNTY_OLLAMA_URL", "Ollama URL (e.g. http://127.0.0.1:11434/v1)"),
        ("BOUNTY_OLLAMA_MODEL", "Ollama model (e.g. llama3.1:8b)"),
    ]
    for key, label in fields:
        cur = os.environ.get(key, "")
        masked = (cur[:6] + "…") if cur and ("TOKEN" in key or "KEY" in key) else (cur or "empty")
        val = _ask(f"{label} [{masked}]: ")
        if val:
            _env_set(key, val)
    # Mirror OpenAI key to the vars Strix and other engines expect.
    key = os.environ.get("BOUNTY_API_KEY")
    if key:
        _env_set("LLM_API_KEY", key)
        _env_set("OPENAI_API_KEY", key)
        if not os.environ.get("STRIX_LLM"):
            _env_set("STRIX_LLM", "openai/gpt-4o-mini")
    print(paint(f"Saved to {ENV_FILE}. Check with: doctor.", GREEN))


def cmd_menu(_: argparse.Namespace) -> None:
    """Interactive command console."""
    menu = """
  [1] Full auto hunt      recon -> scan -> AI triage -> report
  [2] Recon (passive)     enumerate + validate a target
  [3] Vulnerability scan  nuclei on discovered live hosts
  [4] Exploitation        build PoC · run active tool · Strix
  [5] Ask the AI          question over collected evidence
  [6] Generate report
  [7] Session            HackerOne programs OR your own custom scope
  [8] Engines             list & run any repo
  [9] Status & scope
  [k] Set credentials   [i] Install arsenal   [d] Doctor (check tools)
  [0] Exit"""
    while True:
        print("\n" + paint("GHOSTHUNT — pentest command console", BOLD + GREEN))
        try:
            state = json.loads(STATE_FILE.read_text()) if STATE_FILE.exists() else None
        except (OSError, json.JSONDecodeError):
            state = None
        if state:
            print(paint(f"Program: {state.get('program', '?')}  |  Scope: {', '.join(state.get('scope', []))}", DIM))
        else:
            print(paint("No session yet — use [7] to start from HackerOne.", DIM))
        print(menu)
        choice = _ask("\nghosthunt> ")
        if choice in ("0", "q", "exit", ""):
            print("bye.")
            return
        try:
            _menu_dispatch(choice)
        except SystemExit:
            # die() inside a command must not kill the menu
            pass


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ghosthunt", description="GHOSTHUNT — scope-first bug bounty command console"
    )
    sub = parser.add_subparsers(dest="command")

    menu = sub.add_parser("menu", help="interactive command console (default when no command given)")
    menu.set_defaults(func=cmd_menu)

    hunt = sub.add_parser("hunt", help="full auto pipeline: recon -> scan -> AI triage -> report")
    hunt.add_argument("--confirm", action="store_true", help="acknowledge active scanning is allowed by the program")
    hunt.add_argument("--deep", action="store_true", help="also run Strix deep analysis on live hosts")
    hunt.add_argument("--local", action="store_true", help="AI triage via local Ollama (free) instead of the paid API")
    hunt.add_argument("--gentle", action="store_true", help="low rate for small/slow sites (avoids self-inflicted timeouts)")
    hunt.set_defaults(func=cmd_hunt)

    init = sub.add_parser("init", help="create a program session")
    init.add_argument("--program", required=True)
    init.add_argument("--scope", required=True, nargs="+")
    init.add_argument("--force", action="store_true")
    init.set_defaults(func=cmd_init)

    status = sub.add_parser("status", help="show program and scope")
    status.set_defaults(func=cmd_status)

    use = sub.add_parser("use", help="switch to another saved engagement (keeps its evidence)")
    use.add_argument("name")
    use.set_defaults(func=cmd_use)

    note = sub.add_parser("note", help="save a note in the session")
    note.add_argument("title")
    note.add_argument("text", nargs="?")
    note.set_defaults(func=cmd_note)

    evidence = sub.add_parser("evidence", help="save evidence")
    evidence.add_argument("name")
    evidence.add_argument("--source")
    evidence.set_defaults(func=cmd_evidence)

    run = sub.add_parser("run", help="run an allowed tool within scope")
    run.add_argument("--target", required=True)
    run.add_argument("--confirm", action="store_true", help="confirm an active action after checking the policy")
    run.add_argument("command", nargs=argparse.REMAINDER)
    run.set_defaults(func=cmd_run)

    baseline = sub.add_parser(
        "baseline", help="collect a low-impact baseline and store evidence"
    )
    baseline.add_argument("--target", required=True)
    baseline.set_defaults(func=cmd_baseline)

    engage = sub.add_parser(
        "engage",
        help="run passive recon and HTTP validation within scope",
    )
    engage.add_argument("--target", required=True)
    engage.set_defaults(func=cmd_engage)

    ask = sub.add_parser("ask", help="ask the configured LLM")
    ask.add_argument("prompt", nargs="?")
    ask.add_argument("--play", help="inject a methodology playbook (see: ghosthunt play list)")
    ask.add_argument("--agent", help="adopt a hunting-agent persona (see: ghosthunt agents)")
    ask.add_argument("--local", action="store_true", help="use local Ollama instead of the paid API")
    ask.set_defaults(func=cmd_ask)

    agents = sub.add_parser("agents", help="list specialist hunting agents (pwn) usable via ask --agent")
    agents.set_defaults(func=cmd_agents)

    play = sub.add_parser("play", help="methodology playbooks from pwn + claude-red (the app's brain)")
    playsub = play.add_subparsers(dest="play_command", required=True)
    play_list = playsub.add_parser("list", help="list available playbooks")
    play_list.set_defaults(func=cmd_play)
    play_show = playsub.add_parser("show", help="print a playbook")
    play_show.add_argument("name")
    play_show.set_defaults(func=cmd_play)

    exploit = sub.add_parser("exploit", help="build a safe, scoped proof-of-concept for a confirmed candidate")
    exploit.add_argument("finding", nargs="?", help="describe the candidate (host + endpoint + class), or via stdin")
    exploit.add_argument("--agent", help="hunter/PoC agent (default: poc-builder)")
    exploit.add_argument("--local", action="store_true", help="use free local Ollama")
    exploit.set_defaults(func=cmd_exploit)

    report = sub.add_parser("report", help="generate a base report")
    report.set_defaults(func=cmd_report)

    doctor = sub.add_parser("doctor", help="check VM tools")
    doctor.set_defaults(func=cmd_doctor)

    install = sub.add_parser("install", help="install/update the full tool arsenal (cross-distro)")
    install.set_defaults(func=cmd_install)

    config = sub.add_parser("config", help="interactive credentials wizard (writes ~/.bounty.env)")
    config.set_defaults(func=cmd_config)

    h1 = sub.add_parser("h1", help="HackerOne API integration (scope and confirmed submission)")
    h1sub = h1.add_subparsers(dest="h1_command", required=True)

    h1_programs = h1sub.add_parser("programs", help="list accessible programs")
    h1_programs.set_defaults(func=cmd_h1_programs)

    h1_init = h1sub.add_parser("init", help="create a session directly from a program's eligible scope")
    h1_init.add_argument("--program", required=True, help="program handle (e.g. security)")
    h1_init.add_argument("--force", action="store_true", help="replace an existing session")
    h1_init.set_defaults(func=cmd_h1_init)

    h1_scope = h1sub.add_parser("scope", help="pull structured scopes and policy for a program")
    h1_scope.add_argument("--program", help="program handle (default: the session's HackerOne handle)")
    h1_scope.add_argument("--apply", action="store_true", help="merge eligible assets into the session scope")
    h1_scope.set_defaults(func=cmd_h1_scope)

    h1_submit = h1sub.add_parser("submit", help="submit a report (requires explicit human confirmation)")
    h1_submit.add_argument("--program", help="program handle / team_handle (default: session handle)")
    h1_submit.add_argument("--title", required=True)
    h1_submit.add_argument("--impact", required=True)
    h1_submit.add_argument("--file", help="markdown file with the vulnerability_information")
    h1_submit.add_argument("--severity", choices=H1_SEVERITIES)
    h1_submit.add_argument("--scope-id", dest="scope_id", help="structured_scope_id of the asset")
    h1_submit.add_argument("--weakness-id", dest="weakness_id", help="weakness_id (mapped CWE)")
    h1_submit.add_argument("--confirm", action="store_true", help="enable sending; still asks for a typed phrase")
    h1_submit.set_defaults(func=cmd_h1_submit)

    nw = sub.add_parser(
        "nightwatch",
        help="drive the Nighwatch engine using this session's scope (reuses it, no reimplementation)",
    )
    nwsub = nw.add_subparsers(dest="nightwatch_command", required=True)

    nw_config = nwsub.add_parser("config", help="generate a Nighwatch engagement config from the session scope")
    nw_config.add_argument("--out", help="output path (default: .bounty/nightwatch/engagement.json)")
    nw_config.add_argument("--methods", nargs="+", help="allowed HTTP methods (default: GET)")
    nw_config.add_argument("--active", action="store_true", help="enable bounded active testing (still gated by Nighwatch)")
    nw_config.add_argument("--authorization", help="written authorization reference / artifact id")
    nw_config.set_defaults(func=cmd_nightwatch_config)

    nw_run = nwsub.add_parser("run", help="run the Nighwatch CLI with the generated config auto-attached")
    nw_run.add_argument("args", nargs=argparse.REMAINDER)
    nw_run.set_defaults(func=cmd_nightwatch_run)

    engine = sub.add_parser("engine", help="unified access to all reused engines (list, info, run)")
    ensub = engine.add_subparsers(dest="engine_command", required=True)
    en_list = ensub.add_parser("list", help="list every engine, its role and availability")
    en_list.set_defaults(func=cmd_engine_list)
    en_info = ensub.add_parser("info", help="show one engine's role and how to run it")
    en_info.add_argument("name")
    en_info.set_defaults(func=cmd_engine_info)
    en_run = ensub.add_parser("run", help="run a CLI engine (reuses installed binary or repo in place)")
    en_run.add_argument("name")
    en_run.add_argument("args", nargs=argparse.REMAINDER)
    en_run.set_defaults(func=cmd_engine_run)
    return parser


def main() -> None:
    load_dotenv()
    _load_active_engagement()
    parser = build_parser()
    args = parser.parse_args()
    banner()
    if not getattr(args, "func", None):
        cmd_menu(args)
        return
    args.func(args)


if __name__ == "__main__":
    main()
