"""A ligação do cliente, do começo ao fim, e o envio para o Dash quando ela termina.

Junta a conversa, o contato anotado (anotar_contato), o último orçamento passado e o número da
linha (quando a ligação vem do telefone, SIP), e manda para a edge function registrar-ligacao do
Dash, que cria o lead no CRM e chama o cliente no WhatsApp (supabase/functions/registrar-ligacao).

Env: REGISTRAR_LIGACAO_URL e LIGACAO_SECRET. Sem a URL (teste no PC), grava em RECADOS como antes.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import aiohttp

from agenda import FUSO

log = logging.getLogger("sombrear.ligacao")

TENTATIVAS = 3


def so_digitos(v: str | None) -> str:
    return "".join(c for c in str(v or "") if c.isdigit())


@dataclass
class Ligacao:
    inicio: datetime = field(default_factory=lambda: datetime.now(FUSO))
    ref: str = field(default_factory=lambda: f"voz-{uuid.uuid4()}")
    telefone_linha: str | None = None
    falas: list[dict] = field(default_factory=list)
    contato: dict | None = None
    orcamento: dict | None = None

    def ouvir(self, quem: str, texto: str | None) -> None:
        """Uma fala da conversa: quem é 'user' (cliente) ou 'assistant' (Amanda)."""
        texto = (texto or "").strip()
        if not texto or quem not in ("user", "assistant"):
            return
        self.falas.append({"quem": "cliente" if quem == "user" else "amanda", "texto": texto,
                           "em": datetime.now(FUSO).isoformat(timespec="seconds")})

    def orcou(self, r: dict, modelo: str | None, quantidade: int) -> None:
        """Guarda o último orçamento que deu certo, no formato que o Dash espera (mensagem.ts)."""
        if not r.get("ok"):
            return
        self.orcamento = {"modelo": modelo, "tecido": r["tecido"], "largura": r["largura"], "altura": r["altura"],
                          "quantidade": quantidade, "total4x": r["total4x"], "totalAvista": r["totalAvista"],
                          "instalacao": r.get("instalacao"), "maisBarato": bool(r.get("maisBarato"))}

    def anotar(self, nome: str, telefone: str, assunto: str, resumo: str) -> None:
        self.contato = {"nome": nome.strip(), "telefone": telefone, "assunto": assunto, "resumo": resumo.strip()}

    @property
    def cliente_falou(self) -> bool:
        return any(f["quem"] == "cliente" for f in self.falas)

    def corpo(self, fim: datetime | None = None) -> dict:
        c = self.contato or {}
        return {
            "ref": self.ref, "inicio": self.inicio.isoformat(), "fim": (fim or datetime.now(FUSO)).isoformat(),
            "telefone_chamador": self.telefone_linha, "telefone": c.get("telefone"), "nome": c.get("nome"),
            "assunto": c.get("assunto"), "resumo": c.get("resumo"), "orcamento": self.orcamento,
            "transcricao": self.falas,
        }


async def enviar(lig: Ligacao, url: str | None = None, chave: str | None = None, recados: Path | None = None,
                 espera: float = 1.0) -> str:
    """Manda a ligação para o Dash quando ela termina. Devolve o que aconteceu:
    'nada' (o cliente não falou: desligou antes), 'arquivo' (sem URL, teste no PC), o whatsapp_status
    que o Dash devolveu, ou 'falhou' depois de TENTATIVAS (fica no log e no arquivo de recados)."""
    if not lig.cliente_falou:
        return "nada"
    url = url if url is not None else os.environ.get("REGISTRAR_LIGACAO_URL", "")
    chave = chave if chave is not None else os.environ.get("LIGACAO_SECRET", "")
    corpo = lig.corpo()
    if not url:
        _no_arquivo(corpo, recados)
        return "arquivo"
    ultimo = ""
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20)) as http:
        for tentativa in range(TENTATIVAS):
            try:
                async with http.post(url, json=corpo, headers={"x-chave": chave}) as r:
                    dados = await r.json(content_type=None)
                    if r.status == 200:
                        return str(dados.get("status", "enviado"))
                    ultimo = f"{r.status} {dados}"
                    if r.status in (400, 401):  # não adianta repetir
                        break
            except (aiohttp.ClientError, asyncio.TimeoutError, json.JSONDecodeError) as e:
                ultimo = repr(e)
            await asyncio.sleep(espera * (tentativa + 1))
    log.error("ligação %s não chegou no Dash: %s", lig.ref, ultimo)
    _no_arquivo(corpo, recados)  # para não perder: dá para reenviar depois com o mesmo ref
    return "falhou"


def _no_arquivo(corpo: dict, recados: Path | None) -> None:
    from equipe import RECADOS  # import tardio: equipe importa este módulo
    destino = recados or RECADOS
    destino.parent.mkdir(parents=True, exist_ok=True)
    with destino.open("a", encoding="utf-8") as f:
        f.write(json.dumps(corpo, ensure_ascii=False) + "\n")
