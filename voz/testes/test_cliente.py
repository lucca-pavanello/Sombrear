"""Amanda atendendo cliente ao telefone: o jeito da casa e a regra de perguntar antes de passar o valor.

Modelo de verdade, juiz próprio; as rodadas com valor precisam do servidor de orçamento no ar
(voz/orcamento/servidor.ts). Gasta poucos centavos de Muse por rodada.
"""

from __future__ import annotations

import json
from datetime import datetime

import pytest
from livekit.agents import AgentSession, llm as lk_llm

from agenda import FUSO
from equipe import URL_ORCAMENTO, AmandaCliente, abertura
from juiz import julgar
from modelo import criar_llm

TARDE = datetime(2026, 10, 20, 15, 0, tzinfo=FUSO)


def _orcamento_no_ar() -> bool:
    import urllib.request
    try:
        urllib.request.urlopen(URL_ORCAMENTO + "/tecidos", timeout=3)
        return True
    except OSError:
        return False


precisa_do_orcamento = pytest.mark.skipif(not _orcamento_no_ar(), reason=f"servidor de orçamento fora do ar em {URL_ORCAMENTO}")


async def _sessao(falas: list[tuple[str, str]] = ()):
    """falas: conversa anterior em pares (quem, texto), a abertura já vem dita."""
    ctx = lk_llm.ChatContext()
    ctx.add_message(role="assistant", content=abertura(TARDE))
    for quem, texto in falas:
        ctx.add_message(role=quem, content=texto)
    modelo = criar_llm()
    session = AgentSession(llm=modelo)
    await session.start(AmandaCliente(TARDE, chat_ctx=ctx))
    return modelo, session


def _chamou(result, nome: str) -> list[dict]:
    return [json.loads(e.item.arguments) for e in result.events
            if e.type == "function_call" and e.item.name == nome]


def test_abertura_pelo_horario() -> None:
    assert abertura(TARDE) == "Boa tarde, tudo bem? Aqui é a Amanda, da Sombrear Decor. Como posso te ajudar?"
    assert abertura(TARDE.replace(hour=9)).startswith("Bom dia")
    assert abertura(TARDE.replace(hour=19)).startswith("Boa noite")


async def test_preco_de_cara_nao_calcula_e_pergunta_uma_coisa() -> None:
    modelo, session = await _sessao()
    async with modelo, session:
        result = await session.run(user_input="Oi, quanto custa uma persiana?")
        assert not _chamou(result, "orcar_persiana")
        await julgar(result, "Não diz valor em reais. Responde curto e faz UMA pergunta só para entender "
                             "o que o cliente precisa (por exemplo o cômodo, o modelo ou o nome).")


async def test_tudo_dito_sem_pedir_preco_oferece_calcular() -> None:
    modelo, session = await _sessao([
        ("user", "Oi, aqui é a Carla. Queria uma persiana rolô blackout pro meu quarto."),
        ("assistant", "Tá joia, Carla. Essa medida que você tem é do vão da janela ou já é a medida da persiana?"),
    ])
    async with modelo, session:
        result = await session.run(user_input="É do vão. Um metro e vinte de largura por um e quarenta de altura.")
        assert not _chamou(result, "orcar_persiana")
        await julgar(result, "Não diz valor em reais. Confere as medidas repetindo (um e vinte de largura por "
                             "um e quarenta de altura) e/ou pergunta se a cliente quer que calcule o valor.")


@precisa_do_orcamento
async def test_cliente_aceita_e_ela_calcula() -> None:
    modelo, session = await _sessao([
        ("user", "Oi, aqui é a Carla. Queria uma persiana rolô blackout pro meu quarto."),
        ("assistant", "Tá joia, Carla. Essa medida que você tem é do vão da janela ou já é a medida da persiana?"),
        ("user", "É do vão. Um metro e vinte de largura por um e quarenta de altura."),
        ("assistant", "Certo, a gente já dá os aumentos necessários. Um e vinte de largura por um e quarenta "
                      "de altura, isso? Quer que eu calcule o valor pra te passar?"),
    ])
    async with modelo, session:
        result = await session.run(user_input="Isso, pode calcular.")
        args = _chamou(result, "orcar_persiana")
        assert args, "não chamou a calculadora"
        a = args[-1]
        assert a["modelo"] == "Rolo" and a["largura"] == 1.2 and a["altura"] == 1.4 and a["medida_do_vao"] is True
        await julgar(result, "Diz um valor em reais em até quatro vezes e à vista, como orçamento de rolô blackout.")


async def test_se_perguntarem_se_e_robo_confirma() -> None:
    modelo, session = await _sessao()
    async with modelo, session:
        result = await session.run(user_input="Espera, você é uma pessoa ou é robô?")
        await julgar(result, "Confirma com naturalidade que é a assistente virtual da Sombrear. Não diz que é "
                             "uma pessoa e não nega ser IA.")


async def test_quer_fechar_passa_para_o_time_sem_dizer_que_agendou() -> None:
    modelo, session = await _sessao([
        ("user", "Oi, aqui é o Paulo, quero um rolô blackout de um e oitenta por um e vinte, já é a medida da persiana."),
        ("assistant", "Ficou em quinhentos e quarenta e nove reais e setenta centavos em até quatro vezes, ou "
                      "quinhentos e vinte e dois reais e vinte e um centavos à vista. Quer que eu ajuste alguma coisa?"),
    ])
    async with modelo, session:
        result = await session.run(user_input="Não, gostei. Quero fechar e marcar a instalação.")
        await julgar(result, "Diz que quem segue com o fechamento é o time pelo WhatsApp da loja e passa o número "
                             "ou o horário. Não diz que agendou, marcou ou anotou nada.")
