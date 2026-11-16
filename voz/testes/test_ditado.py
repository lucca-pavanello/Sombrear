"""Telefone ditado aos pedaços (ditado.py), com os pedaços que a simulação de 21/10 mandou."""

from __future__ import annotations

import pytest
from livekit.agents import StopResponse
from livekit.agents import llm as lk_llm

from ditado import Ditado, digitos_falados, pediu_telefone, so_numero
from test_cliente import _chamou, _sessao


def test_digitos_falados() -> None:
    assert digitos_falados("dezessete, nove nove seis um oito, cinco um sete sete") == "17996185177"
    assert digitos_falados("E o meu telefone é 17996185177.") == "17996185177"
    assert digitos_falados("Vinte e um, nove oito") == "2198"
    assert digitos_falados("Dezessete? Nove oito oito?") == "17988"
    assert digitos_falados("meia") == "6"


def test_so_numero() -> None:
    assert so_numero("nove, nove. Um dois três")
    assert so_numero("Não, espera. O final é,")
    assert not so_numero("Vocês instalam em Mirassol?")
    assert not so_numero("Quanto fica a persiana")


def test_pediu_telefone() -> None:
    assert pediu_telefone("E o telefone com DDD, Marcos?")
    assert pediu_telefone("Dezessete, nove nove um dois três, quatro cinco seis sete, isso?")
    assert not pediu_telefone("E é pra qual cômodo?")


def test_junta_os_pedacos_da_simulacao() -> None:
    d = Ditado()
    pedacos = ["dezessete", "nove, nove. Um dois três", "quatro", "cinco", "seis"]
    assert all(d.segurar(p, True) for p in pedacos)
    assert not d.segurar("sete.", True)  # 11 dígitos: agora ela responde
    assert digitos_falados(d.juntar()) == "17991234567"
    assert not d.pedacos


def test_recomeca_com_o_numero_inteiro() -> None:
    """Simulação de 22/10: "Dezessete" e logo "Dezessete. Nove nove sete. Zero zero. Um um dois dois"."""
    d = Ditado()
    assert d.segurar("Dezessete", True)
    assert not d.segurar("Dezessete. Nove nove sete. Zero zero. Um um dois dois", True)
    assert digitos_falados(d.juntar()) == "17997001122"


def test_nao_segura_fora_do_telefone_nem_pergunta() -> None:
    d = Ditado()
    assert not d.segurar("dezessete", False)
    assert not d.segurar("Isso.", True)
    d.segurar("dezessete nove", True)
    assert not d.segurar("Vocês instalam em Mirassol?", True) and not d.pedacos


async def test_ditado_aos_pedacos_ela_espera_e_confere_tudo() -> None:
    """session.run não passa por on_user_turn_completed: o gancho do ditado é chamado direto, como o
    LiveKit faz no fim de cada turno da ligação, e o número junto vai ao modelo depois."""
    modelo, session = await _sessao([
        ("user", "Pode me mandar o orçamento pelo WhatsApp?"),
        ("assistant", "Me diz seu nome, por favor."),
        ("user", "Marcos."),
        ("assistant", "E o telefone com DDD, Marcos?"),
    ])
    async with modelo, session:
        amanda = session.current_agent
        for pedaco in ["dezessete", "nove, nove. Um dois três", "quatro", "cinco", "seis"]:
            with pytest.raises(StopResponse):
                await amanda.on_user_turn_completed(amanda.chat_ctx.copy(),
                                                    lk_llm.ChatMessage(role="user", content=[pedaco]))
        ultimo = lk_llm.ChatMessage(role="user", content=["sete."])
        await amanda.on_user_turn_completed(amanda.chat_ctx.copy(), ultimo)
        assert digitos_falados(ultimo.text_content) == "17991234567"
        result = await session.run(user_input=ultimo.text_content)
        args = _chamou(result, "conferir_telefone")
        assert args, "não conferiu o número inteiro"
        assert "".join(c for c in args[-1]["telefone"] if c.isdigit()).removeprefix("55") == "17991234567"
