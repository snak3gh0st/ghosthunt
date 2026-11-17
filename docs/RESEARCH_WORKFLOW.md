# Program selection through report approval

## Select and assess

Selecting a catalog program or a program in the execution selector opens its program page,
with **Avaliação antes do pentest** before execution. Existing programs also require this
step; an older prepared container image does not bypass it.

Record the initial concrete asset, objective, access to public material or owned test accounts,
initial time budget, execution limits and stopping rules. Review the official policy and the
saved scope / exclusions. The local assessment presents financial potential, scope/policy,
access feasibility and method/effort; it lists unknown eligibility, reward terms, competition,
duplicates and permissions separately. This is an assessment of recorded researcher inputs,
not a live audit of the official program and not a predicted chance of earning a bounty.
No target scan, autonomous agent, or paid API call runs during assessment.

Missing scope confirmation, policy review, policy text, usable in-scope asset, access or
execution limits blocks plan approval. Lack of a declared bounty is an explicit financial
warning rather than a prohibition on practice. Approval binds to all relevant program data
and its scope version. Edits to policy, scope, permissions, focus or reward assumptions require
a new assessment and approval. The API and trusted controller enforce this gate; UI buttons
alone are not the enforcement boundary. Local diagnostic CLI controls remain available.

## Prepare and investigate

After approving the plan, choose **Iniciar pentest** to prepare the image and Burp MCP.
The same scope, tool permissions and Docker/Conda/VPN checks still apply to each execution.
Each run retains its real terminal, status, scope version and output.

Choose **Iniciar investigação por etapas** to execute the full sequence automatically.
Its 21 stages include session/doctor/engine/playbook checks, complete preparation,
classification, passive discovery, source review / Gitleaks / Semgrep / TruffleHog,
authorized DNS/HTTP/TCP checks, Burp evidence imports, observed-CVE reference lookup,
local AI synthesis and a native session report. Incompatible tools, missing permissions,
missing runtime requirements and failed processes have separate visible states.
All integrated executors are represented; a source repository does not cause scans of
the shared GitHub infrastructure. Discovered assets do not become new testing targets.

The UI renders progress, outputs and extracted signals while the same run streams actual
subprocess commands, PIDs and stdout to the terminal. Desktop supports two simultaneous
panes; smaller screens keep the terminal dock and results available. Closing the terminal
does not cancel the run; Ctrl+C or **Interromper investigação** cancels the active work
and remaining queue. Interrupted runs/stages are recovered as interrupted after restart.

Nmap uses connect scanning at two probes/second, one selected URL port, a pinned public
IPv4, no NSE scripts, no aggressive detection and a 30-second host deadline. Its separate
policy permission defaults to false. Semgrep uses local, bounded rules with metrics/version
checks disabled. TruffleHog disables online verification/update and suppresses raw credential
values before storing metadata. Signals and local AI text require independent reproduction.

On a completed run choose **Documentar hipótese desta execução**. The API atomically creates
one hypothesis linked to the run and attaches its bounded output as `tool-output` evidence.
Repeating the action opens the same hypothesis. Changed scope or incomplete runs are rejected.
Tool output is an observation; it does not confirm reproduction or satisfy the requirement
for request/response or independent reproduction evidence.

Individual completed investigation stages also support **Documentar hipótese desta etapa**,
including while other stages continue. Their source run/stage IDs and stage-specific output
are preserved; repeating an action opens the same hypothesis.

## Review a report

**Achados e relatórios** opens each finding in its rendered report view by default. The
editing tab contains documentation and evidence uploads. Reports show saved content;
save documentation before reviewing. The preview and Markdown export use the same report
builder. Raw HTML and remote images are disabled in the preview; evidence remains fenced text.

1. Complete the finding and attach reproduction or request/response evidence.
2. Review the rendered draft and the visible list of missing requirements.
3. Validate the documented reproduction and demonstrated impact.
4. Confirm review of the current version and choose **Aprovar relatório para envio**.
5. Copy Markdown or download the approved report, then submit manually to HackerOne.
6. Register the external report URL, triage outcome and actual payment in tracking.

Approval stores a hash of the finding content, scope/policy and evidence identities/hashes,
plus a timestamp. A stale preview cannot approve a newer revision. Direct status updates
cannot skip approval; final export and submission tracking require a current approval.
Editing the finding or attaching evidence resets validation/approval. Scope changes also
invalidate the report. Draft export stays available while requirements are incomplete.

## Verification

The backend workflow tests cover missing / stale assessments, rejected plan approval, direct
execution bypass attempts, stale report revisions, approval invalidation, matching preview /
approved export, submission / payment tracking, and idempotent run-to-hypothesis conversion.
Browser checks use synthetic records in a separate temporary workspace; no real report is
submitted and no synthetic reward is written into the personal workspace.

The current backend suite has 113 passing tests across 17 files. The investigation browser
test runs the actual orchestrator with real synthetic child processes, verifies live stage
state / PID / stdout, scope-dependent skips, stage-to-hypothesis conversion, and responsive
layouts. The source-scanner smoke test runs actual Gitleaks, Semgrep and TruffleHog against
a synthetic source snapshot in a restricted container with networking disabled.
