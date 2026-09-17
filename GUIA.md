# GUIA — como o app funciona (em português)

## Modelo mental (a ideia central)

`ghosthunt.py` NÃO é um scanner. É um **painel de controle**:
- ele guarda o **escopo** (o que você pode testar),
- guarda as **evidências** e **notas**,
- exige sua **aprovação** para qualquer coisa ativa,
- e **liga os motores** (os repos que você clonou) quando VOCÊ manda.

Pense assim:
- `ghosthunt.py` = o **cockpit**.
- os repos (AIRecon, Nighwatch, Strix, etc.) = **motores** que você aciona pelo cockpit.
- as ferramentas do Kali (subfinder, httpx, nuclei...) = **instrumentos** que o cockpit usa direto.

Regra de ouro: **nada sai do escopo, nada ativo roda sem você confirmar, nada é enviado sozinho pra HackerOne.**

## Os comandos (o que cada um faz)

| Comando | O que faz | Usa repo? |
|--------|-----------|-----------|
| `init` / `h1 init` | Cria a sessão e trava o escopo | não |
| `status` | Mostra programa + escopo atual | não |
| `engage --target X` | Recon passiva: headers, DNS, fingerprint, subdomínios, HTTP | usa ferramentas Kali |
| `baseline --target X` | Só a linha de base (headers/DNS/fingerprint) | ferramentas Kali |
| `run --target X -- cmd` | Roda UMA ferramenta permitida, você no controle | ferramentas Kali |
| `ask "..."` | Pergunta ao LLM sobre as evidências (contexto redigido) | LLM |
| `report` | Junta tudo num relatório-base | não |
| `engine list/info/run` | **Aqui entram os repos.** Lista, explica e RODA cada motor | **SIM** |
| `nightwatch config/run` | Motor Nighwatch amarrado ao seu escopo | repo Nighwatch |
| `h1 programs/scope/submit` | API HackerOne (escolher programa, escopo, enviar com confirmação) | não |
| `doctor` | Mostra o que está instalado (motores + ferramentas) | — |

## Onde cada repo entra (o `engine`)

`ghosthunt.py engine list` mostra todos. Para usar um: `ghosthunt.py engine run <nome> -- <args>`.

| Repo | Papel | Como rodar |
|------|-------|-----------|
| airecon | Agente de recon autônomo | `engine run airecon -- start` (gasta token; rode `frugal-airecon.py` antes) |
| nighwatch | Controle com escopo + Ollama local (grátis) | `nightwatch config` depois `nightwatch run -- ...` |
| strix | Validação/reprodução (Docker) | `engine run strix -- ...` |
| recongpt | Web app de evidência passiva | `engine info recongpt` (roda como serviço) |
| pwn / claude-red | Metodologia (skills p/ Claude) | `engine info <nome>` |
| shellgpt/kaligpt/pentestgpt | Auxiliares | `engine run <nome> -- ...` |

## O fluxo pra ganhar (resumo)

1. `h1 init` (ou `init`) → escopo travado
2. `engage` → recon passiva (barato)
3. `ask` / metodologia (pwn, claude-red) → hipóteses
4. `nightwatch`/`airecon`/`strix` → aprofundar e **reproduzir** um bug
5. `report` → escreve o relatório
6. enviar pela HackerOne (site ou `h1 submit --confirm`)

Só vira dinheiro quando o bug é **reproduzível, no escopo e com impacto real**.
