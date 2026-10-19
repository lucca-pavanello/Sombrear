"""Quanto a Amanda demora para começar a responder, etapa por etapa (fase 2 do PLANO.md).

Para cada pergunta gravada (.wav): ouvir (Parakeet) -> pensar (Muse, com as ferramentas de verdade;
conta cada ida ao modelo) -> falar a primeira frase (Kokoro, voz J). Não inclui a espera de fim de
fala do VAD/detector de turno (~0,5 s, configurável) nem o tempo de rede da ligação.

    PYTHONPATH=. uv run --group local python local/medir_latencia.py <pasta-com-wavs>
Precisa do servidor de orçamento e do local/servidor_voz.py no ar.
"""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

import aiohttp
from livekit.agents import AgentSession
from livekit.agents.metrics import LLMMetrics

from equipe import URL_VOZ, AmandaEquipe
from frases import trechos
from modelo import criar_llm


async def ouvir(s: aiohttp.ClientSession, wav: Path) -> tuple[str, float]:
    form = aiohttp.FormData()
    form.add_field("file", wav.read_bytes(), filename=wav.name, content_type="audio/wav")
    form.add_field("model", "parakeet")
    t = time.perf_counter()
    async with s.post(URL_VOZ + "/audio/transcriptions", data=form) as r:
        texto = (await r.json())["text"]
    return texto, time.perf_counter() - t


async def falar(s: aiohttp.ClientSession, frase: str) -> float:
    t = time.perf_counter()
    async with s.post(URL_VOZ + "/audio/speech", json={"input": frase, "voice": "amanda"}) as r:
        await r.read()
    return time.perf_counter() - t


async def pensar(texto: str) -> tuple[str, list[float], float]:
    llm = criar_llm()
    session = AgentSession(llm=llm)
    ttfts: list[float] = []
    session.on("metrics_collected", lambda ev: isinstance(ev.metrics, LLMMetrics) and ttfts.append(ev.metrics.ttft))
    async with llm, session:
        await session.start(AmandaEquipe())
        t = time.perf_counter()
        result = await session.run(user_input=texto)
        total = time.perf_counter() - t
    resposta = " ".join(e.item.text_content for e in result.events if e.type == "message" and e.item.role == "assistant")
    return resposta, ttfts, total


def primeira_frase(texto: str) -> str:
    """O primeiro trecho que vai para a voz, do mesmo jeito que a sessão corta (frases.py)."""
    t = trechos(texto.strip())
    return t[0][0] if t else ""


async def main(pasta: str) -> None:
    async with aiohttp.ClientSession() as s:
        await falar(s, "Oi.")  # aquece
        for wav in sorted(Path(pasta).glob("*.wav")):
            texto, t_ouvir = await ouvir(s, wav)
            resposta, ttfts, t_pensar = await pensar(texto)
            frase = primeira_frase(resposta)
            t_falar = await falar(s, frase)
            # até a primeira frase: as idas ao modelo antes da última contam inteiras (ferramenta no meio);
            # a última conta até o primeiro token, mais o resto da primeira frase (aproximado pelo total)
            print(f"\n{wav.name}\n  ouviu ({t_ouvir:.2f}s): {texto}\n  idas ao modelo: {len(ttfts)}, "
                  f"primeiro token de cada: {', '.join(f'{x:.2f}s' for x in ttfts)}; pensou tudo em {t_pensar:.2f}s"
                  f"\n  1ª frase ({t_falar:.2f}s para falar): {frase}"
                  f"\n  até começar a falar (ouvir + pensar + 1ª frase): {t_ouvir + t_pensar + t_falar:.2f}s")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
