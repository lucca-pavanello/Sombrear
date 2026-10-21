"""Traz o conhecimento da Amanda do WhatsApp (n8n) para a voz, sem cópia à mão.

A fonte da verdade é o n8n: os 4 workflows de conhecimento e as seções de produto do prompt
principal. Aqui só se tira o que é do WhatsApp (mídia automática, data do n8n) e se troca "Stella"
(nome antigo que ficou nos sub-workflows) por "Amanda". Os .md desta pasta são gerados: mudou no
n8n, roda de novo.

    uv run python conhecimento/atualizar.py              # reescreve os .md que mudaram
    uv run python conhecimento/atualizar.py --conferir   # só confere; sai com 1 se algum ficou velho

N8N_API_URL e N8N_API_KEY: do ambiente ou do .env da raiz do Dash (o mesmo dos outros scripts).
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

PASTA = Path(__file__).parent

# arquivo -> (workflow, como tirar o texto)
SUB = "sub"          # sub-workflow de conhecimento: a mensagem do "Basic LLM Chain"
PRINCIPAL = "principal"  # prompt da Secretaria no "Agente principal": só as seções de produto
FONTES = {
    "ambientes": ("BaV8KNysupDwjaWW", SUB),
    "catalogo": ("jXB8YZ1WJhMrXSbo", SUB),
    "empresa": ("Pa8VIezmBoHWGh6l", SUB),
    "objecoes": ("UFEYbYYHGW63olEO", SUB),
    "produto": ("X4m4xyhiekL36m8h", PRINCIPAL),
}
# seções do prompt principal que valem na voz: a 8 inteira menos a mídia do WhatsApp, e a limpeza
SECOES_PRODUTO = ("8", "9.3b")
SECOES_SO_WHATSAPP = ("8.6", "8.6b")


def credenciais() -> tuple[str, str]:
    url, chave = os.environ.get("N8N_API_URL"), os.environ.get("N8N_API_KEY")
    if url and chave:
        return url, chave
    comum = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], cwd=PASTA,
                           capture_output=True, text=True, check=True).stdout.strip()
    env = Path(comum).parent / ".env"
    valores = {}
    for linha in env.read_text(encoding="utf-8").splitlines():
        if m := re.match(r"^(N8N_API_URL|N8N_API_KEY)=(.*)$", linha.strip()):
            valores[m[1]] = m[2].strip().strip('"')
    return valores["N8N_API_URL"], valores["N8N_API_KEY"]


def workflow(ident: str) -> dict:
    url, chave = credenciais()
    req = urllib.request.Request(f"{url.rstrip('/')}/api/v1/workflows/{ident}", headers={"X-N8N-API-KEY": chave})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def no(wf: dict, nome: str) -> dict:
    return next(n for n in wf["nodes"] if n["name"] == nome)


def secoes(texto: str) -> list[tuple[str, str]]:
    """O prompt em (número da seção, texto da seção com o título), pelos títulos "# 8." e "## 8.6b"."""
    partes = re.split(r"(?m)^(?=#{1,2} \d)", texto)
    return [(re.match(r"#{1,2} ([\d.]+[a-z]?)", p)[1].rstrip("."), p) for p in partes if re.match(r"#{1,2} \d", p)]


def limpar(texto: str) -> str:
    texto = texto.removeprefix("=")  # o "=" do n8n que marca expressão
    texto = "\n".join(l for l in texto.splitlines() if "{{ $now }}" not in l)
    return texto.replace("Stella", "Amanda").strip() + "\n"


def extrair(wf: dict, como: str) -> str:
    if como == SUB:
        return limpar(no(wf, "Basic LLM Chain")["parameters"]["messages"]["messageValues"][0]["message"])
    prompt = no(wf, "Secretaria")["parameters"]["options"]["systemMessage"]
    escolhidas = [t for n, t in secoes(prompt)
                  if (n == "8" or n.startswith("8.") or n in SECOES_PRODUTO) and n not in SECOES_SO_WHATSAPP]
    # o "---" que separa a seção 8 da 9 no prompt fica sobrando no fim
    return limpar("\n\n".join(re.sub(r"\n-{3,}$", "", t.rstrip()) for t in escolhidas))


def cabecalho(wf: dict) -> str:
    return (f'<!-- Gerado por atualizar.py do n8n (workflow "{wf["name"]}", alterado lá em '
            f'{wf["updatedAt"][:10]}). Não editar aqui: mudar no n8n e rodar o script. -->\n\n')


def sem_cabecalho(texto: str) -> str:
    return "\n".join(l for l in texto.splitlines() if not l.startswith("<!--")).strip() + "\n"


def main() -> int:
    conferir = "--conferir" in sys.argv
    velhos = []
    for arquivo, (ident, como) in FONTES.items():
        wf = workflow(ident)
        novo = extrair(wf, como)
        destino = PASTA / f"{arquivo}.md"
        atual = destino.read_text(encoding="utf-8") if destino.exists() else ""
        if sem_cabecalho(atual) != novo:
            velhos.append(arquivo)
        if not conferir:  # reescreve todos: o cabeçalho leva a data da alteração no n8n
            destino.write_text(cabecalho(wf) + novo, encoding="utf-8")
    if not velhos:
        print("conhecimento igual ao do n8n")
        return 0
    print(("velho em relação ao n8n: " if conferir else "atualizado do n8n: ") + ", ".join(velhos))
    return 1 if conferir else 0


if __name__ == "__main__":
    sys.exit(main())
