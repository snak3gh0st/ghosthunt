#!/usr/bin/env python3
"""
Aplica perfil FRUGAL ao ~/.airecon/config.yaml (recon passiva + analise leve,
alvo unico autorizado). Nao apaga nada: faz backup e so ajusta chaves de custo.
Rode DENTRO da VM:  python3 frugal-airecon.py
"""
import os, shutil, time, sys
CFG = os.path.expanduser("~/.airecon/config.yaml")

# Chave: valor frugal  (comentario = default original)
FRUGAL = {
    # --- geracao / modelo ---
    "openai_max_tokens": 2048,          # era 16384
    "openai_temperature": 0.0,          # era 0.15 -> menos re-runs aleatorios
    "llm_enable_thinking": False,       # gpt-4o nao emite <think>: puro desperdicio
    "llm_thinking_request_mode": "off", # nao pede reasoning ao gateway
    "llm_context_window": 32768,        # era 65536 -> compacta mais cedo, prompt menor
    "llm_max_concurrent_requests": 1,
    # --- caps de fase (impede o grind ate EXPLOIT) ---
    "pipeline_recon_max_iterations": 20,     # era 500
    "pipeline_recon_soft_timeout": 8,        # era 30 -> forca recon->analysis rapido
    "pipeline_analysis_max_iterations": 15,  # era 300
    "pipeline_exploit_max_iterations": 1,    # era 800 -> exploit autonomo praticamente OFF
    "pipeline_report_max_iterations": 10,    # era 100
    "pipeline_max_iterations_cap": 25,       # era 350 (hard cap por fase)
    "pipeline_min_iterations_per_phase": 3,  # era 10 -> transita cedo
    # --- compactacao de historico (repeticao = context bloat) ---
    "agent_max_conversation_messages": 40,   # era auto (~256)
    "agent_uncompressed_keep_count": 6,       # era 10
    "agent_compression_trigger_ratio": 0.5,   # era 0.7 -> compacta antes
}

def main():
    if not os.path.exists(CFG):
        print(f"[!] Nao achei {CFG}. Rode 'airecon' uma vez para gera-lo.")
        sys.exit(1)
    bak = CFG + ".bak." + time.strftime("%Y%m%d-%H%M%S")
    shutil.copy2(CFG, bak)
    print(f"[+] Backup: {bak}")

    try:
        import yaml
    except ImportError:
        print("[!] PyYAML ausente. Instale: pip install --user pyyaml"); sys.exit(1)

    with open(CFG) as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        print("[!] config.yaml nao e um mapa YAML plano. Abortei (backup intacto)."); sys.exit(1)

    changed = []
    for k, v in FRUGAL.items():
        if data.get(k) != v:
            changed.append((k, data.get(k, "<ausente>"), v))
        data[k] = v

    with open(CFG, "w") as f:
        yaml.safe_dump(data, f, sort_keys=True, default_flow_style=False, allow_unicode=True)

    print(f"[+] {len(changed)} chaves ajustadas:")
    for k, old, new in changed:
        print(f"    {k}: {old} -> {new}")
    print("\n[i] Preservei todas as outras chaves (tool_response_role, api base, model, etc).")
    print(f"[i] Reverter:  cp {bak} {CFG}")

if __name__ == "__main__":
    main()
