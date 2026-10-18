"""Ligação simulada: perguntas gravadas no lugar do microfone, e a linha do tempo do que a Amanda
fala e quando. Prova que ela não fica muda (sem_silencio.py) sem precisar de alguém no fone.

    PYTHONPATH=. uv run --group local python local/simular_ligacao.py <wav> [<wav> ...]
Cada wav é uma fala de quem liga; entre elas, ESPERA s de silêncio. Precisa do servidor de
orçamento e do local/servidor_voz.py no ar. O fim de fala aqui é só pelo VAD (o detector de turno
precisa do job do LiveKit), então na ligação real o turno fecha um pouco diferente.
"""

from __future__ import annotations

import asyncio
import sys
import time

import numpy as np
import soundfile as sf
from livekit import rtc
from livekit.agents.voice import io

from equipe import AmandaEquipe, criar_sessao
from sem_silencio import FALA_CALCULAR, FALA_CALCULAR_CURTA, FALA_ERRO, FALA_ESPERA, FALA_REPETIR, FALAS, Vigia

ESPERA = 14.0
T0 = time.perf_counter()


def agora() -> str:
    return f"{time.perf_counter() - T0:6.2f}s"


class Microfone(io.AudioInput):
    """Toca os wavs em tempo real, em quadros de 10 ms, com silêncio entre eles."""

    def __init__(self, wavs: list[str]) -> None:
        super().__init__(label="microfone-simulado")
        self._quadros = self._gerar(wavs)

    async def _gerar(self, wavs: list[str]):
        def silencio(seg: float):
            return np.zeros(int(16000 * seg), np.int16)

        for i, w in enumerate(wavs):
            a, sr = sf.read(w, dtype="float32", always_2d=True)
            a = a.mean(1)
            if sr != 16000:
                a = np.interp(np.linspace(0, len(a) - 1, int(len(a) * 16000 / sr)), np.arange(len(a)), a)
            fala = (a * 32767).astype(np.int16)
            trilha = np.concatenate([silencio(1.0 if i == 0 else ESPERA), fala])
            print(f"{agora()}  [quem liga começa a falar em +{1.0 if i == 0 else ESPERA:.0f}s: {w.split('/')[-1]}]")
            inicio = time.perf_counter()
            for n in range(0, len(trilha), 160):
                bloco = trilha[n:n + 160]
                if len(bloco) < 160:
                    bloco = np.pad(bloco, (0, 160 - len(bloco)))
                yield rtc.AudioFrame(bloco.tobytes(), 16000, 1, 160)
                alvo = inicio + (n + 160) / 16000
                await asyncio.sleep(max(0.0, alvo - time.perf_counter()))
            print(f"{agora()}  quem liga terminou de falar")
        for _ in range(int(ESPERA * 100)):
            yield rtc.AudioFrame(np.zeros(160, np.int16).tobytes(), 16000, 1, 160)
            await asyncio.sleep(0.01)

    async def __anext__(self) -> rtc.AudioFrame:
        return await self._quadros.__anext__()


class Fone(io.AudioOutput):
    """Finge tocar o áudio em tempo real e anota quando cada fala começa."""

    def __init__(self) -> None:
        super().__init__(label="fone-simulado", capabilities=io.AudioOutputCapabilities(pause=False))
        self._dur = 0.0
        self._inicio: float | None = None
        self._tarefa: asyncio.Task | None = None

    async def capture_frame(self, frame: rtc.AudioFrame) -> None:
        if self._inicio is None:
            self._inicio = time.perf_counter()
            self._dur = 0.0
            self.on_playback_started(created_at=time.time())
            print(f"{agora()}  >> Amanda começa a falar")
        await super().capture_frame(frame)
        self._dur += frame.duration

    def flush(self) -> None:
        super().flush()
        if self._inicio is None:
            return
        inicio, dur = self._inicio, self._dur
        self._inicio = None

        async def terminar() -> None:
            await asyncio.sleep(max(0.0, inicio + dur - time.perf_counter()))
            self.on_playback_finished(playback_position=dur, interrupted=False)

        self._tarefa = asyncio.create_task(terminar())

    def clear_buffer(self) -> None:
        if self._inicio is not None:
            dur = time.perf_counter() - self._inicio
            self._inicio = None
            self.on_playback_finished(playback_position=dur, interrupted=True)


async def main(wavs: list[str]) -> None:
    session = criar_sessao(turno="vad")
    session.input.audio = Microfone(wavs)
    session.output.audio = Fone()
    session.on("conversation_item_added",
               lambda ev: hasattr(ev.item, "role") and print(f"{agora()}  [{ev.item.role}] {ev.item.text_content}"))
    session.on("user_input_transcribed",
               lambda ev: ev.is_final and print(f"{agora()}  (ouviu) {ev.transcript!r}"))
    await FALAS.preparar(session.tts, [FALA_CALCULAR, FALA_CALCULAR_CURTA, FALA_ESPERA, FALA_REPETIR, FALA_ERRO])
    _say = session.say

    def say(texto, **kw):
        print(f"{agora()}  (fala fixa) {texto}")
        return _say(texto, **kw)

    session.say = say  # só para a linha do tempo mostrar as falas fixas
    await session.start(AmandaEquipe())
    Vigia(session)
    await asyncio.sleep(1.0 + sum(sf.info(w).duration for w in wavs) + ESPERA * len(wavs) + 12)
    await session.aclose()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:]))
