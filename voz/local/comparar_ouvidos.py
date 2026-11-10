"""Compara os ouvidos (STT) do LiveKit Inference com o áudio de verdade de uma ligação.

Toca o canal do cliente da gravação (o audio.ogg do LiveKit tem o cliente num canal e a Amanda no
outro) em tempo real para todos os ouvidos ao mesmo tempo, como numa ligação, e imprime o que cada um
entendeu, frase por frase, e quanto demorou do fim da fala até o texto final.

    PYTHONPATH=. uv run python local/comparar_ouvidos.py <canal-do-cliente.wav> [nomes...]
O wav: ffmpeg -i ligacao.ogg -af "pan=mono|c0=c0" -ar 16000 cliente.wav (c0 = cliente).
"""

from __future__ import annotations

import asyncio
import sys
import time
import wave

from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import inference, stt, utils

from ouvido import PALAVRAS_DA_LOJA

load_dotenv(__import__("pathlib").Path.home() / ".secrets" / "sombrear-voz.env")

OUVIDOS = {
    "nova-3": ("deepgram/nova-3", {}),
    "nova-3+palavras": ("deepgram/nova-3", {"keyterm": PALAVRAS_DA_LOJA}),
    "flux-multi+palavras": ("deepgram/flux-general-multi", {"keyterm": PALAVRAS_DA_LOJA, "language_hint": "pt"}),
    "assembly-multi": ("assemblyai/universal-streaming-multilingual", {}),
    "assembly-u3-pro": ("assemblyai/u3-rt-pro", {}),
    "speechmatics": ("speechmatics/enhanced", {}),
    "xai": ("xai/stt-1", {}),
    "cartesia": ("cartesia/ink-whisper", {}),
}
QUADRO = 0.02  # 20 ms por quadro, como no telefone


async def ouvir(nome: str, modelo: str, extra: dict, quadros: list[rtc.AudioFrame], ini: list[float]) -> list[str]:
    kw = {"extra_kwargs": extra} if extra else {}
    try:
        ouvido = inference.STT(model=modelo, language="pt", **kw)
        stream = ouvido.stream()
    except Exception as e:  # noqa: BLE001
        return [f"ERRO ao abrir: {type(e).__name__} {str(e)[:120]}"]
    frases: list[str] = []

    async def receber() -> None:
        try:
            async for ev in stream:
                if ev.type == stt.SpeechEventType.FINAL_TRANSCRIPT and ev.alternatives and ev.alternatives[0].text.strip():
                    frases.append(f"[{time.perf_counter() - ini[0]:5.1f}s] {ev.alternatives[0].text.strip()}")
        except Exception as e:  # noqa: BLE001
            frases.append(f"ERRO: {type(e).__name__} {str(e)[:160]}")

    tarefa = asyncio.create_task(receber())
    for q in quadros:
        stream.push_frame(q)
        await asyncio.sleep(QUADRO)
    stream.flush()
    stream.end_input()
    try:
        await asyncio.wait_for(tarefa, 15)
    except TimeoutError:
        tarefa.cancel()
    await stream.aclose()
    return frases


async def main() -> None:
    arq, *nomes = sys.argv[1:]
    with wave.open(arq) as w:
        taxa, dados = w.getframerate(), w.readframes(w.getnframes())
    passo = int(taxa * QUADRO) * 2
    quadros = [rtc.AudioFrame(dados[i:i + passo], taxa, 1, len(dados[i:i + passo]) // 2)
               for i in range(0, len(dados) - passo + 1, passo)]
    utils.http_context._new_session_ctx()
    escolhidos = {n: OUVIDOS[n] for n in (nomes or OUVIDOS)}
    ini = [time.perf_counter()]
    resultados = await asyncio.gather(*(ouvir(n, m, e, quadros, ini) for n, (m, e) in escolhidos.items()))
    for nome, frases in zip(escolhidos, resultados):
        print(f"\n### {nome}")
        print("\n".join(frases) or "(nada)")


if __name__ == "__main__":
    asyncio.run(main())
