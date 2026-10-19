"""Ligação simulada de cliente com o tempo de cada turno, etapa por etapa, e o detector de fim de
fala de verdade (rodando aqui mesmo, sem o job do LiveKit).

    PYTHONPATH=. uv run --group local python local/medir_turnos.py <wav> [<wav> ...]
Cada wav é uma fala de quem liga. Escolhas pelas mesmas variáveis da ligação: VOZ, VOZ_ID, OUVIDO,
FIM_MIN, FIM_MAX, LLM (equipe.py, modelo.py). TURNO=vad tira o detector. Precisa do servidor de
orçamento (e do local/servidor_voz.py com OUVIDO=local ou VOZ=kokoro).

Por turno: parou_fala = a fala de quem liga acabou de verdade (fim do wav); fim_turno = da parada
até a sessão decidir que o turno acabou (VAD + transcrição + detector + espera mínima); texto =
quanto a transcrição chegou depois do fim da fala (pelo VAD); llm = 1º token do modelo; voz = 1º
áudio da voz; total = da parada até o 1º áudio sair (o que quem liga sente).
"""

from __future__ import annotations

import asyncio
import os
import statistics
import sys
import time
from datetime import datetime

import soundfile as sf
from livekit.agents import ChatContext
from livekit.agents.utils import http_context
from livekit.agents.metrics import EOUMetrics, LLMMetrics, TTSMetrics
from livekit.plugins.turn_detector.base import EOUModelBase
from livekit.plugins.turn_detector.multilingual import MultilingualModel, _EUORunnerMultilingual

import simular_ligacao as sim
from agenda import FUSO
from equipe import AmandaCliente, abertura, criar_sessao
from sem_silencio import FALA_CALCULAR, FALA_CALCULAR_CURTA, FALA_ERRO, FALA_ESPERA, FALA_REPETIR, FALAS, Vigia

sim.ESPERA = float(os.environ.get("ESPERA", "12"))


class _NaMesmaHora:
    """O detector de turno sem o job: a mesma inferência, chamada aqui."""

    def __init__(self) -> None:
        self._runner = _EUORunnerMultilingual()
        self._runner.initialize()

    async def do_inference(self, method: str, data: bytes) -> bytes | None:
        return await asyncio.to_thread(self._runner.run, data)


class DetectorLocal(MultilingualModel):
    def __init__(self) -> None:
        EOUModelBase.__init__(self, model_type="multilingual", inference_executor=_NaMesmaHora(), load_languages=True)


class Turnos:
    def __init__(self) -> None:
        self.linhas: list[dict] = []
        self.parou: float | None = None
        self.atual: dict | None = None

    def fala_acabou(self) -> None:
        self.parou = time.perf_counter()
        self.atual = {"parou": self.parou}
        self.linhas.append(self.atual)

    def metrica(self, m) -> None:
        t = self.atual
        if t is None:
            return
        if isinstance(m, EOUMetrics) and "fim_turno" not in t:
            t["fim_turno"] = time.perf_counter() - t["parou"]
            t["texto"] = m.transcription_delay
        elif isinstance(m, LLMMetrics) and "llm" not in t:
            t["llm"] = m.ttft
        elif isinstance(m, TTSMetrics) and "voz" not in t and m.ttfb > 0:
            t["voz"] = m.ttfb

    def audio_saiu(self) -> None:
        if self.atual is not None and "total" not in self.atual:
            self.atual["total"] = time.perf_counter() - self.atual["parou"]


async def main(wavs: list[str]) -> None:
    turnos = Turnos()
    detector = "vad" if os.environ.get("TURNO") == "vad" else DetectorLocal()
    session = criar_sessao(turno=detector)
    session.input.audio = sim.Microfone(wavs)
    fone = sim.Fone()
    _cap = fone.capture_frame

    async def capture(frame):
        if fone._inicio is None:
            turnos.audio_saiu()
        await _cap(frame)

    fone.capture_frame = capture
    session.output.audio = fone
    def marcar(*a, **kw):  # o microfone simulado avisa no print quando cada fala acaba
        if a and "quem liga terminou de falar" in str(a[0]):
            turnos.fala_acabou()
        print(*a, **kw)

    sim.print = marcar
    session.on("metrics_collected", lambda ev: turnos.metrica(ev.metrics))
    session.on("conversation_item_added",
               lambda ev: hasattr(ev.item, "role") and print(f"{sim.agora()}  [{ev.item.role}] {ev.item.text_content}"))
    await FALAS.preparar(session.tts, [FALA_CALCULAR, FALA_CALCULAR_CURTA, FALA_ESPERA, FALA_REPETIR, FALA_ERRO])
    agora = datetime.now(FUSO)
    ctx = ChatContext()
    ctx.add_message(role="assistant", content=abertura(agora))  # como se ela já tivesse atendido
    await session.start(AmandaCliente(agora, chat_ctx=ctx))
    Vigia(session)
    await asyncio.sleep(1.0 + sum(sf.info(w).duration for w in wavs) + sim.ESPERA * len(wavs) + 12)
    await session.aclose()

    cfg = {k: os.environ.get(k, "") for k in ("OUVIDO", "VOZ", "FIM_MIN", "FIM_MAX", "LLM", "TURNO")}
    print("\nconfig:", " ".join(f"{k}={v}" for k, v in cfg.items() if v))
    cols = ["fim_turno", "texto", "llm", "voz", "total"]
    print("turno  " + "  ".join(f"{c:>9}" for c in cols))
    for i, t in enumerate(turnos.linhas, 1):
        print(f"{i:5d}  " + "  ".join(f"{t[c]:9.2f}" if c in t else f"{'-':>9}" for c in cols))
    med = {c: statistics.median([t[c] for t in turnos.linhas if c in t]) for c in cols
           if any(c in t for t in turnos.linhas)}
    print("mediana " + "  ".join(f"{c}={v:.2f}" for c, v in med.items()))
    tot = [t["total"] for t in turnos.linhas if "total" in t]
    if tot:
        print(f"turnos com total < 2 s: {sum(x < 2 for x in tot)}/{len(tot)}")


async def _rodar(wavs: list[str]) -> None:
    async with http_context.open():  # fora do job as vozes da nuvem precisam da sessão http aberta aqui
        await main(wavs)


if __name__ == "__main__":
    asyncio.run(_rodar(sys.argv[1:]))
