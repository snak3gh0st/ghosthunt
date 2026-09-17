# Bounty copilot — Quickstart (HackerOne)

One CLI (`ghosthunt.py`) that owns scope, evidence, approval and reporting, and
drives every engine. Nothing auto-submits; active tests need your explicit OK.

## 0. One-time setup (in the Kali VM)
```bash
cd ~/bugbounty
./setup.sh                      # writes ~/.bounty.env, checks tools
nano ~/.bounty.env              # paste your HackerOne API token + LLM key
python3 ghosthunt.py doctor        # engines + creds should show OK
```

## 1. Pick a program that pays fast
```bash
python3 ghosthunt.py h1 programs   # '$' = pays bounty. Prefer bounty programs, not VDPs.
```
Fastest legitimate payout = a **bounty** program with **fast triage** and a wide
web scope. VDPs pay $0 (reputation only).

## 2. Start a session straight from the program
```bash
python3 ghosthunt.py h1 init --program HANDLE
```
Pulls the program's eligible scope and creates the session. Scope is now enforced
everywhere below.

## 3. Passive recon (near-zero token cost)
```bash
python3 ghosthunt.py engage --target app.example.com
python3 ghosthunt.py ask "What stands out in the evidence? Smallest next read-only test?"
```

## 4. Hunt the classes that pay quickly (scanners miss these)
Access-control / IDOR is the highest-ROI, fastest-triage class. Use Nighwatch's
independent authorization check on two accounts you own:
```bash
python3 ghosthunt.py nightwatch config              # scope -> engagement config
python3 ghosthunt.py nightwatch run -- scope validate
python3 ghosthunt.py nightwatch run -- authz compare \
    --url https://app.example.com/api/orders/123 \
    --owner-profile owner_user --subject-profile non_owner_user \
    --impact-field email --impact-field total
```
Other engines, same session:
```bash
python3 ghosthunt.py engine list
python3 ghosthunt.py engine run airecon -- --help     # deeper recon (apply frugal-airecon.py first)
python3 ghosthunt.py engine info pwn                   # methodology playbooks
```

## 5. Only with a REPRODUCED, in-scope, impactful bug → report
```bash
python3 ghosthunt.py report                            # base report from evidence
# write the finding into report.md, then:
python3 ghosthunt.py h1 submit --title "IDOR in /api/orders exposes other users' PII" \
    --impact "Any authenticated user reads arbitrary orders (email, totals)." \
    --file .bounty/report.md --severity high --confirm
# then type:  SEND IT
```

## The only rules that keep you paid
- No auto-submit; submit needs `--confirm` **and** typing `SEND IT`.
- Never test outside the program scope. `mouracfo.com` is NOT authorized.
- A scanner alert is not a finding until reproduced with demonstrated impact.
- Invalid/spam reports tank your signal and lock you out of paying programs.
