# Scoped pentest preparation and isolated execution

## Current structure

The Mac runs the authenticated Ghosthunt dashboard, trusted process controller and local
Ollama / LM Studio inference. Docker Desktop supplies the Linux VM. Each managed tool
analysis starts a new container from a pinned image ID, with a Conda environment already
installed in its immutable filesystem. Conda manages dependencies; Docker provides the
process and filesystem boundary. Conda alone is not a sandbox.

No dedicated server or change to `btserver` is required. That server was inspected read-only
and already hosts applications and databases; nothing was deployed to it.

## Start a pentest

1. Select a program, confirm its scope and exclusions, then evaluate feasibility and approve
   the investigation plan in **Avaliação antes do pentest**. Any relevant program change
   invalidates that approval. See [research workflow](RESEARCH_WORKFLOW.md).
2. Click **Iniciar pentest**, on the command center or program page.
3. The real terminal shows preparation of the Docker/Conda image, official pinned tool
   installation and Burp MCP preparation. Cached image layers avoid repeated downloads.
4. The inventory verifies all 50 executable entries in the common protected arsenal for
   source, web and mixed profiles. Runtime dependencies remain shared immutable image layers;
   execution compatibility and policy permissions are checked separately for each stage.
5. A real MCP protocol check distinguishes an installed package from a connected Burp.
6. The preparation records the exact program scope version, exclusions, image ID and missing
   requirements in `.bounty/web/pentests/<program-id>.json`.
7. Online analysis remains blocked until the VPN gateway is healthy. Changing scope requires
   a new preparation. Offline classification can run once its environment is installed.

The images are shared immutable dependencies. Analysis filesystems and processes are new
for each run; no previous program's working directory is mounted. Preparation uses the
normal connection to download trusted software. Selected-target traffic uses the VPN only.

## Container restrictions

Analysis containers run as UID/GID 1000 with a read-only root filesystem, all Linux
capabilities dropped, `no-new-privileges`, Docker's seccomp profile, at most 128 processes,
2 CPUs and 1536 MB memory. `/work` and `/tmp` are bounded temporary filesystems with
`nosuid,nodev,noexec`. There are no published ports, Docker socket, SSH agent, home directory
or repository mounts. Only the current job's explicit data is sent over stdin.

Offline jobs use `--network none`. Online jobs share the exact healthy VPN container's
network namespace, with a fixed read-only DNS file pointing to its loopback resolver. Before
any target access, the worker checks that its route uses a tunnel interface, obtains its exit
IP and rejects an exit matching the Mac's baseline hash. IPv6 is disabled in the gateway.
Gluetun's firewall is enabled as its kill switch. Cancellation forcibly removes the named
job container; completion also removes it. Returned artifacts have bounded sizes and names.

The trusted Gluetun sidecar has a writable disposable root filesystem because it creates
its runtime user in `/etc/passwd`. It receives only NET_ADMIN, CHOWN, SETUID and SETGID;
all other capabilities are dropped, no ports are published, and `no-new-privileges` stays
enabled. Its private WireGuard bind mount is read-only. Analysis containers keep the
stricter non-root, read-only, capability-free policy described above.

Native status, doctor, engine inventory, playbooks and session report remain local control
operations. Local AI stays on the Mac to use Metal; it receives text and cannot run tools.
Other native CLI engine passthroughs and manually launched applications are outside the
managed web executor's boundary.

## Proton configuration

The Proton app does not need to route the whole Mac. Generate a separate Linux WireGuard
configuration in the Proton account: Downloads → WireGuard configuration → Create → Download.
Import the `.conf` in **Ferramentas e fontes → Execução protegida**, then click **Conectar VPN**.
The file is stored at `.bounty/web/runtime/wg0.conf` with mode 0600, outside Git. Only the
trusted gateway mounts it; analysis containers never receive that file or VPN private key.
Executable hooks, duplicate directives, private endpoints and split IPv4 routes are rejected.
Dual-stack Proton exports are normalized to IPv4 in the private application copy: IPv6
interface/DNS entries are removed and AllowedIPs becomes `0.0.0.0/0`. The original export
is preserved. DNS uses the gateway's local resolver with DNS-over-TLS upstream and IPv6 off.

On 2026-11-17 the supplied Proton configuration connected successfully. A UID-1000 analysis
container used `tun0`; two HTTPS diagnostic services agreed on an exit different from the
Mac's baseline. The fixed loopback resolver worked and an IPv6 connection was blocked.
The live disconnect test froze the gateway controller and removed the tunnel: with the
fallback route on `eth0`, direct external TCP and DNS attempts both failed. The test then
recreated the gateway and verified healthy network readiness. Evidence is stored privately
in `.bounty/web/verification/vpn-smoke.json`. No selected-target scan or paid API call was
needed. This proves the tested configuration and outage, not anonymity in every situation.

## Burp MCP

Preparation installs Burp Suite Community on macOS when absent and downloads the official
PortSwigger MCP 1.4.0 package and JAR with fixed SHA-256 values. Startup configuration uses
Burp's documented `--user-config-file=<path>` argument. Existing Burp projects are not
closed or overwritten by preparation. Initial Burp project setup may require its GUI.

The real installed extension is loaded, enabled on `127.0.0.1:9876` and verified through
`tools/list`. HTTP and project-data approvals remain enabled, configuration-edit tools
remain disabled and credential filtering remains enabled. The Ghosthunt adapter only
permits its fixed evidence-read tools and filters imported records by the selected program.
Community currently exposes proxy-history reading; scanner issues require Professional.
No license was purchased or bypassed. No active Burp requests are exposed by Ghosthunt;
manual traffic generated separately in the desktop app is not covered by the analysis gateway.

## OpenAI

The user-provided key was saved to the explicitly approved ignored `.env.local`, mode 0600.
Its value was removed from the earlier example template; no key value was printed, committed,
put in build context, argv or Docker environment arguments. Provisioners do not inherit it.

An explicitly selected OpenAI query requires a prepared program and healthy protected
network. The key reaches its disposable worker through stdin only; the worker performs the
same egress check before calling the fixed OpenAI endpoint. Calls use Responses API,
`store:false`, no tools, no retries and at most 1500 output tokens. Context size is bounded.
Local AI remains the default with no automatic paid fallback. API readiness is separate from
credential presence. No paid OpenAI request has been made during this implementation.

## Verification

- Backend: 113 passing tests, none skipped, across 17 files.
- Actual Docker containers: all 50 executable entries present and actually launched with
  help/version probes. UID 1000, read-only root, seccomp,
  dropped capabilities, `no-new-privileges`, no host home/socket, network disabled and
  fresh filesystem on the next container verified. Actual cancellation after the Python command started also removed the container.
- Real offline classifier executed inside the Conda container; a network tool was rejected
  while VPN was unavailable.
- Actual Burp MCP `tools/list` connected and reported proxy-history support.
- Public-browser lifecycle test clicked Iniciar pentest, installed / verified tools and MCP,
  preserved exact selected scope, recorded the VPN blocker, executed the isolated classifier
  with real process output, and checked desktop/tablet/mobile layouts.
- Existing finding/report/payment workflow and terminal lifecycle browser tests also passed.
- The OpenAI transport was tested with a fake credential and response fixture; the test
  confirms protected network selection and key on stdin, with no host SDK fallback.
- `npm run test:vpn` repeats the live diagnostic exit / IPv6 / disconnect test and restores
  the gateway in a `finally` block. It refuses to start while analysis containers are active.
  `npm run test:isolation` checks disposable offline containers independently of VPN readiness.

## Extended arsenal

`arsenal-lock.json` pins 16 official ARM64 release assets by SHA-256, three small Go tools,
isolated Python packages and exact NetExec / theHarvester / Metasploit source commits.
`arsenal-extra-lock.json` pins Commix, WPScan and the separate official ZAP image. The builder
is pinned Go 1.27.4; runtime remains Conda Python 3.12 / Node 22. theHarvester has its own
managed Python 3.14. Dirsearch 0.5.0 and setuptools 80.9.0 use a separate compatible tool
environment because the system package failed an actual runtime check.

The image includes Amass, Arjun, Assetfinder, CDNCheck, Commix, CRLFuzz, Dalfox, Dirsearch,
Feroxbuster, ffuf, Findomain, Gobuster, GoSpider, Gowitness, Hakrawler, Hydra, Katana,
Kiterunner, Medusa, Metasploit console/venom, Naabu, NetExec, Nuclei, Patator, Semgrep,
sqlmap, theHarvester, TLSx, TruffleHog, WAFW00F, Waybackurls, WhatWeb and WPScan, in addition
to the original core. `getallurls` is an alias for gau. CrackMapExec is represented by its
successor NetExec. The old zap-cli name is separate from the installed official ZAP image.

Installation does not grant a tool an unrestricted web executor. The automatic investigation
uses the scoped adapters documented in RESEARCH_WORKFLOW.md. Other arsenal utilities,
intrusive module consoles, external AI engines and ZAP service configuration have distinct
availability states; the UI does not present them as automatic scans. No host Docker socket,
Mac home, VPN key or cloud API key is mounted into analysis containers.

`npm run test:arsenal` launches all 50 executable entries in the actual restricted offline
container; `npm run test:source-scanners` tests the real static scanners with synthetic code
and a fake credential. Artifacts are private under `.bounty/web/verification/`.

## Kiri assessment

Kiri documents Docker API compatibility and the resource, filesystem, seccomp, capability
and network controls used by this executor. It can be evaluated later via a separate Docker
context (`GHOSTHUNT_DOCKER_CONTEXT=kiri`), with the same isolation smoke tests. It was not
installed or security-certified here. It does not supply a remote exit IP by itself.

## Sources

- [Docker execution controls](https://docs.docker.com/engine/containers/run/)
- [Micromamba container environments](https://micromamba-docker.readthedocs.io/en/latest/quick_start.html)
- [Gluetun firewall / kill switch](https://github.com/qdm12/gluetun-wiki/blob/main/faq/firewall.md)
- [Proton WireGuard configurations](https://protonvpn.com/support/wireguard-configurations)
- [Official Burp MCP](https://github.com/PortSwigger/mcp-server)
- [Burp command-line configuration](https://portswigger.net/burp/documentation/desktop/troubleshooting/launch-from-command-line)
- [Kiri supported controls](https://github.com/libracoder/kiri/blob/main/docs/features.md)
