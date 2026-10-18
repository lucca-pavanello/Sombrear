"""A Amanda nunca fica muda (sem_silencio.py) e corta a fala em trechos curtos (frases.py).

Sem modelo nem rede: o modelo é simulado por um gerador que demora ou falha.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from livekit.agents import APIConnectionError, FlushSentinel

import sem_silencio
from frases import MAXIMO, trechos
from livekit.agents.llm import ChatChunk, ChoiceDelta, FunctionToolCall

from sem_silencio import FALA_ERRO, FALA_ESPERA, FALA_REPETIR, Vigia, com_espera, sem_anuncio


async def _modelo(atraso: float, partes: list[str], erro: Exception | None = None):
    await asyncio.sleep(atraso)
    if erro:
        raise erro
    for p in partes:
        yield p


async def _juntar(gen) -> list:
    return [c async for c in gen]


async def test_resposta_rapida_passa_direto() -> None:
    assert await _juntar(com_espera(_modelo(0.01, ["Oi, ", "tudo bem?"]), espera=0.2)) == ["Oi, ", "tudo bem?"]


async def test_modelo_demorado_ganha_so_um_segundinho_antes() -> None:
    saida = await _juntar(com_espera(_modelo(0.3, ["Deu quinhentos reais."]), espera=0.1))
    assert saida[0] == FALA_ESPERA + " " and isinstance(saida[1], FlushSentinel)
    assert saida[2:] == ["Deu quinhentos reais."]


async def test_modelo_fora_do_ar_pede_para_repetir_em_vez_de_calar() -> None:
    saida = await _juntar(com_espera(_modelo(0.01, [], APIConnectionError("tempo esgotado")), espera=0.2))
    assert saida == [FALA_ERRO]


def _chunk(texto: str | None = None, ferramenta: bool = False) -> ChatChunk:
    chamadas = [FunctionToolCall(name="orcar_persiana", arguments="{}", call_id="1")] if ferramenta else []
    return ChatChunk(id="x", delta=ChoiceDelta(role="assistant", content=texto, tool_calls=chamadas))


async def _lista(itens):
    for i in itens:
        yield i


async def test_anuncio_antes_da_calculadora_e_descartado() -> None:
    saida = await _juntar(sem_anuncio(_lista([_chunk("Vou calcular sua "), _chunk("romana."), _chunk(ferramenta=True)])))
    assert len(saida) == 1 and saida[0].delta.tool_calls and not saida[0].delta.content


async def test_resposta_normal_sai_inteira() -> None:
    partes = ["Pra quarto a gente indica ", "o rolô blackout ou a romana blackout, ", "que escurecem bem o ambiente."]
    saida = await _juntar(sem_anuncio(_lista([_chunk(p) for p in partes])))
    assert [c.delta.content for c in saida] == partes


async def test_resposta_longa_nao_espera_o_fim() -> None:
    longa = "a" * 90

    async def modelo():
        yield _chunk(longa)
        await asyncio.sleep(5)  # o resto demoraria; o começo tem que sair antes
        yield _chunk("fim")

    gen = sem_anuncio(modelo())
    primeiro = await asyncio.wait_for(gen.__anext__(), timeout=0.5)
    assert primeiro.delta.content == longa
    await gen.aclose()


class _SessaoFalsa:
    def __init__(self) -> None:
        self.ouvintes: dict = {}
        self.falas: list[str] = []
        self.user_state = "listening"
        self.agent_state = "listening"

    def on(self, nome, fn) -> None:
        self.ouvintes[nome] = fn

    def say(self, texto, **_) -> None:
        self.falas.append(texto)


def _ev(**kw):
    return SimpleNamespace(**kw)


async def test_ouviu_voz_e_veio_vazio_pede_para_repetir(monkeypatch) -> None:
    monkeypatch.setattr(sem_silencio, "AGUARDA_TEXTO", 0.05)
    monkeypatch.setattr(sem_silencio, "AGUARDA_POR_SEGUNDO", 0.1)
    s = _SessaoFalsa()
    Vigia(s)
    s.ouvintes["user_state_changed"](_ev(old_state="listening", new_state="speaking"))
    await asyncio.sleep(0.4)
    s.ouvintes["user_state_changed"](_ev(old_state="speaking", new_state="listening"))
    await asyncio.sleep(0.2)
    assert s.falas == [FALA_REPETIR]


async def test_fala_longa_espera_mais_pela_transcricao(monkeypatch) -> None:
    monkeypatch.setattr(sem_silencio, "AGUARDA_TEXTO", 0.05)
    monkeypatch.setattr(sem_silencio, "AGUARDA_POR_SEGUNDO", 0.5)
    s = _SessaoFalsa()
    Vigia(s)
    s.ouvintes["user_state_changed"](_ev(old_state="listening", new_state="speaking"))
    await asyncio.sleep(1.0)
    s.ouvintes["user_state_changed"](_ev(old_state="speaking", new_state="listening"))
    await asyncio.sleep(0.3)  # 1 s de fala: espera 0,55 s; o texto chega aos 0,3
    s.ouvintes["user_input_transcribed"](_ev(is_final=True, transcript="Quanto fica uma romana?"))
    await asyncio.sleep(0.5)
    assert s.falas == []


async def test_ouviu_e_entendeu_nao_pede_para_repetir(monkeypatch) -> None:
    monkeypatch.setattr(sem_silencio, "AGUARDA_TEXTO", 0.05)
    monkeypatch.setattr(sem_silencio, "AGUARDA_POR_SEGUNDO", 0.1)
    s = _SessaoFalsa()
    Vigia(s)
    s.ouvintes["user_state_changed"](_ev(old_state="listening", new_state="speaking"))
    await asyncio.sleep(0.4)
    s.ouvintes["user_input_transcribed"](_ev(is_final=True, transcript="Pode."))
    s.ouvintes["user_state_changed"](_ev(old_state="speaking", new_state="listening"))
    await asyncio.sleep(0.1)
    assert s.falas == []


async def test_barulho_curto_nao_conta_como_fala(monkeypatch) -> None:
    monkeypatch.setattr(sem_silencio, "AGUARDA_TEXTO", 0.05)
    monkeypatch.setattr(sem_silencio, "AGUARDA_POR_SEGUNDO", 0.1)
    s = _SessaoFalsa()
    Vigia(s)
    s.ouvintes["user_state_changed"](_ev(old_state="listening", new_state="speaking"))
    s.ouvintes["user_state_changed"](_ev(old_state="speaking", new_state="listening"))
    await asyncio.sleep(0.1)
    assert s.falas == []


def test_frase_do_preco_sai_em_trechos_curtos() -> None:
    frase = ("Deu mil quinhentos e oitenta e nove reais em quatro vezes sem juros e mil quinhentos e nove "
             "reais e cinquenta e cinco centavos à vista com o double natural.")
    partes = trechos(frase)
    assert len(partes) > 1 and all(len(p[0]) <= MAXIMO for p in partes)
    assert " ".join(p[0] for p in partes) == frase
    assert all(frase[a:b] == t for t, a, b in partes)


def test_frase_do_valor_tem_a_instalacao_separada() -> None:
    from equipe import para_falar
    r = {"total4x": 722.4, "totalAvista": 686.28, "instalacao": 75}
    assert para_falar(r) == ("setecentos e vinte e dois reais e quarenta centavos em até quatro vezes, ou "
                             "seiscentos e oitenta e seis reais e vinte e oito centavos à vista, mais setenta e "
                             "cinco reais de instalação.")
    assert "instalação" not in para_falar({**r, "instalacao": None})
    assert para_falar({"total4x": 1589.0, "totalAvista": 1509.55, "instalacao": None}).startswith("mil quinhentos")
