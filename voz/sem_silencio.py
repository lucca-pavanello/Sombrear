"""A Amanda nunca some: no telefone, silêncio derruba a ligação.

Teste do Lucca em 17/10/2026, dois sumiços: (1) um "pode" curto voltou vazio da transcrição e ela
ficou esperando 1 minuto; (2) o Muse estourou o tempo duas vezes e ela ficou muda ~50 s. E o
orçamento levava ~13 s sem som entre "vou calcular" e o valor.

- falas prontas: o áudio das frases fixas sai do cache, sem esperar a voz gerar;
- com_espera: se o modelo não começou a responder em ESPERA s, ela diz "só um segundinho"; se o
  modelo falhar de vez, pede para repetir em vez de ficar muda;
- Vigia: ouviu voz e a transcrição veio vazia, ela pede para repetir.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterable, AsyncIterator

from livekit import rtc
from livekit.agents import AgentSession, APIError, FlushSentinel, tts

log = logging.getLogger("sem-silencio")

FALA_CALCULAR = "Só um instante, vou calcular."
FALA_CALCULAR_CURTA = "Vou calcular."  # logo depois do "só um segundinho", sem repetir a espera
FALA_ESPERA = "Só um segundinho."
FALA_REPETIR = "Desculpa, não peguei. Pode repetir?"
FALA_ERRO = "Desculpa, falhou aqui do meu lado. Pode repetir, por favor?"

ESPERA = 3.0  # s sem a primeira palavra do modelo até ela dizer "só um segundinho"
ESPERA_DEPOIS_DA_CONTA = 5.0  # na volta da calculadora o aviso já está tocando
FALA_MINIMA = 0.35  # s de voz para contar como fala (tosse e barulho curto não contam)
AGUARDA_TEXTO = 1.0  # s depois de parar de falar esperando a transcrição chegar...
AGUARDA_POR_SEGUNDO = 0.3  # ...mais isto por segundo de fala (frase de 9 s levou 2,1 s para transcrever)
_ultima_espera = 0.0  # quando o "só um segundinho" saiu pela última vez


def fala_calcular() -> str:
    return FALA_CALCULAR_CURTA if time.time() - _ultima_espera < 6 else FALA_CALCULAR


class FalasProntas:
    """Áudio das frases fixas gerado uma vez por sessão."""

    def __init__(self) -> None:
        self._audio: dict[str, list[rtc.AudioFrame]] = {}

    async def preparar(self, voz: tts.TTS, textos: list[str]) -> None:
        for texto in textos:
            try:
                self._audio[texto] = [ev.frame async for ev in voz.synthesize(texto)]
            except Exception:  # sem cache a frase sai pela voz normal, só mais devagar
                pass

    def dizer(self, session: AgentSession, texto: str) -> None:
        quadros = self._audio.get(texto)
        if not quadros:
            session.say(texto, add_to_chat_ctx=False)
            return

        async def tocar() -> AsyncIterator[rtc.AudioFrame]:
            for q in quadros:
                yield q

        session.say(texto, audio=tocar(), add_to_chat_ctx=False)


FALAS = FalasProntas()


async def com_espera(chunks: AsyncIterable, espera: float = ESPERA) -> AsyncIterator:
    it = chunks.__aiter__()
    primeiro: asyncio.Future = asyncio.ensure_future(it.__anext__())
    try:
        feito, _ = await asyncio.wait({primeiro}, timeout=espera)
        if not feito:
            global _ultima_espera
            _ultima_espera = time.time()
            yield FALA_ESPERA + " "
            yield FlushSentinel()
        try:
            chunk = await primeiro
        except StopAsyncIteration:
            return
        yield chunk
        async for chunk in it:
            yield chunk
    except APIError as e:
        log.warning("modelo falhou de vez, pedindo para repetir: %r", e)
        yield FALA_ERRO
    finally:
        if not primeiro.done():
            primeiro.cancel()


ANUNCIO_MAX = 80  # caracteres de texto segurados antes de soltar a resposta


def _texto(c) -> str:
    if isinstance(c, str):
        return c
    d = getattr(c, "delta", None)
    return (d.content or "") if d is not None else ""


def _chama_ferramenta(c) -> bool:
    d = getattr(c, "delta", None)
    return bool(d is not None and d.tool_calls)


async def sem_anuncio(chunks: AsyncIterable, limite: int = ANUNCIO_MAX) -> AsyncIterator:
    """Descarta o "vou calcular..." que o modelo fala antes de chamar a calculadora: a ferramenta
    já toca FALA_CALCULAR na hora, e o anúncio do modelo atrasava tudo (simulação de 17/10: 10 s
    até o primeiro som). Segura só o começo da resposta (até `limite` caracteres); resposta
    normal passa disso e segue em tempo real."""
    segurados: list = []
    tamanho = 0
    soltou = False
    async for c in chunks:
        if soltou:
            yield c
            continue
        if _chama_ferramenta(c):
            for s in segurados:
                if not _texto(s):
                    yield s
            if getattr(c.delta, "content", None):
                c.delta.content = None
            soltou = True
            yield c
            continue
        segurados.append(c)
        tamanho += len(_texto(c))
        if tamanho >= limite:
            for s in segurados:
                yield s
            soltou = True
    if not soltou:
        for s in segurados:
            yield s


class Vigia:
    """Ouviu voz e não chegou texto: pede para repetir em vez de ficar esperando."""

    def __init__(self, session: AgentSession) -> None:
        self._s = session
        self._inicio = 0.0
        self._ultimo_texto = 0.0
        self._tarefa: asyncio.Task | None = None
        session.on("user_state_changed", self._usuario)
        session.on("user_input_transcribed", self._texto)

    def _texto(self, ev) -> None:
        if ev.is_final and ev.transcript.strip():
            self._ultimo_texto = time.time()

    def _usuario(self, ev) -> None:
        if ev.new_state == "speaking":
            self._inicio = time.time()
            if self._tarefa and not self._tarefa.done():
                self._tarefa.cancel()
        elif ev.old_state == "speaking" and (duracao := time.time() - self._inicio) >= FALA_MINIMA:
            self._tarefa = asyncio.create_task(self._conferir(self._inicio, duracao))

    async def _conferir(self, inicio: float, duracao: float) -> None:
        await asyncio.sleep(AGUARDA_TEXTO + AGUARDA_POR_SEGUNDO * duracao)
        if (self._ultimo_texto < inicio and self._s.user_state != "speaking"
                and self._s.agent_state == "listening"):
            FALAS.dizer(self._s, FALA_REPETIR)
