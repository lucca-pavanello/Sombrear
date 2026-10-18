"""Corta a fala da Amanda em trechos curtos para a voz começar logo.

O Kokoro na CPU leva tempo proporcional ao tamanho do trecho (17/10/2026, Ryzen 5 1600: "Certo."
0,6 s; frase de 95 caracteres 3,6 s). O LiveKit manda a fala para a voz frase a frase; aqui a
frase também quebra em vírgula, ponto e vírgula e dois-pontos, e trecho curto demais junta com o
seguinte para não picotar a entonação. Trecho longo sem pontuação (a frase do preço do teste de
17/10 levou 6,5 s para virar voz) corta antes de "e", "ou", "que", "com", "em" ou, sem isso, no
último espaço antes de MAXIMO.
"""

from __future__ import annotations

import re

from livekit.agents import tokenize
from livekit.agents.tokenize import token_stream

_CORTE = re.compile(r"(?<=[.!?,;:])\s+")
_EMENDA = re.compile(r"\s(?=(?:e|ou|que|com|em|no|na|pra|para)\s)")
MAXIMO = 60


def _quebrar(pedaco: str, ini: int) -> list[tuple[str, int, int]]:
    """Quebra um trecho maior que MAXIMO em partes de até MAXIMO, preferindo antes de conjunção."""
    saida = []
    while len(pedaco) > MAXIMO:
        cortes = [m.start() for m in _EMENDA.finditer(pedaco, 20, MAXIMO)]
        c = cortes[-1] if cortes else pedaco.rfind(" ", 20, MAXIMO)
        if c <= 0:
            break
        saida.append((pedaco[:c], ini, ini + c))
        resto = pedaco[c:]
        ini += c + (len(resto) - len(resto.lstrip()))
        pedaco = resto.lstrip()
    saida.append((pedaco, ini, ini + len(pedaco)))
    return saida


def trechos(texto: str, minimo: int = 12) -> list[tuple[str, int, int]]:
    saida: list[tuple[str, int, int]] = []
    pedaco_ini = 0
    for m in _CORTE.finditer(texto):
        if m.start() - pedaco_ini >= minimo:
            saida += _quebrar(texto[pedaco_ini:m.start()], pedaco_ini)
            pedaco_ini = m.end()
    if texto[pedaco_ini:].strip():
        saida += _quebrar(texto[pedaco_ini:].rstrip(), pedaco_ini)
    return saida


class TrechosCurtos(tokenize.SentenceTokenizer):
    def __init__(self, minimo: int = 12) -> None:
        self._minimo = minimo

    def tokenize(self, text: str, *, language: str | None = None) -> list[str]:
        return [t[0] for t in trechos(text, self._minimo)]

    def stream(self, *, language: str | None = None) -> tokenize.SentenceStream:
        return token_stream.BufferedSentenceStream(
            tokenizer=lambda texto: trechos(texto, self._minimo), min_token_len=self._minimo, min_ctx_len=8)
