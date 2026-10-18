"""Amanda da equipe: perguntas que a loja faria, com o modelo de verdade e o motor do Dash.

Precisa do servidor de orçamento no ar (voz/orcamento/servidor.ts) com a foto dos preços; o
valor esperado é o que a Amanda do WhatsApp cotou de verdade (orcamentos_sombrear_ia de 15/10:
Rolô blackout 1,80 × 1,20, a partir de R$ 549,70).
"""

from __future__ import annotations

import json

import aiohttp
import pytest
from livekit.agents import AgentSession, mock_tools

from equipe import URL_ORCAMENTO, AmandaEquipe
from juiz import julgar
from modelo import criar_llm


@pytest.fixture(autouse=True, scope="module")
def servidor_no_ar():
    import urllib.request
    try:
        urllib.request.urlopen(URL_ORCAMENTO + "/tecidos", timeout=3)
    except OSError:
        pytest.skip(f"servidor de orçamento fora do ar em {URL_ORCAMENTO}")


async def _sessao():
    llm = criar_llm()
    session = AgentSession(llm=llm)
    await session.start(AmandaEquipe())
    return llm, session


def _chamadas(result, nome: str) -> list[dict]:
    return [json.loads(e.item.arguments) for e in result.events
            if e.type == "function_call" and e.item.name == nome]


def _saidas(result) -> list[str]:
    return [e.item.output for e in result.events if e.type == "function_call_output"]


async def test_orcamento_bate_com_o_da_amanda_do_whatsapp() -> None:
    llm, session = await _sessao()
    async with llm, session:
        result = await session.run(user_input="Quanto fica um rolô blackout, um e oitenta de largura por "
                                              "um e vinte de altura, já é a medida da persiana, uma peça?")
        args = _chamadas(result, "orcar_persiana")
        assert args, "não chamou a calculadora"
        a = args[-1]
        assert a["modelo"] == "Rolo" and a["largura"] == 1.8 and a["altura"] == 1.2
        assert a["medida_do_vao"] is False
        assert any('"total4x_sem_instalacao": 549.7' in s for s in _saidas(result))
        await julgar(result, "Diz o valor de quinhentos e quarenta e nove reais e setenta centavos em "
                             "até 4x (pode dizer também o à vista) e deixa claro que é o tecido mais em conta ou um valor a partir de.")


async def test_medida_do_vao_vai_para_a_calculadora() -> None:
    llm, session = await _sessao()
    async with llm, session:
        result = await session.run(user_input="Rolô blackout pro quarto, a medida do vão é um e sessenta por "
                                              "um e quarenta, uma peça. Quanto dá?")
        args = _chamadas(result, "orcar_persiana")
        assert args and args[-1]["medida_do_vao"] is True
        assert args[-1]["largura"] == 1.6 and args[-1]["altura"] == 1.4


async def test_tela_solar_sem_porcentagem_pergunta_antes() -> None:
    llm, session = await _sessao()
    async with llm, session:
        result = await session.run(user_input="Faz um rolô tela solar de dois por um e meio, medida final, uma peça.")
        assert not _chamadas(result, "orcar_persiana"), "calculou tela solar sem saber se é 1% ou 3%"
        await julgar(result, "Pergunta se é 1% ou 3% (pode ser só \"um ou três por cento?\", sem repetir "
                             "\"tela solar\") e não dá valor.")


async def test_largura_maior_que_o_rolo_propoe_dividir() -> None:
    llm, session = await _sessao()
    async with llm, session:
        result = await session.run(user_input="Rolô tela solar 1%, quatro e noventa de largura por três e vinte "
                                              "de altura, medida final, uma peça.")
        await julgar(result, "Explica que nessa largura não sai numa peça só e propõe dividir em duas ou "
                             "mais peças, ou já mostra o valor dividido em peças. Não inventa valor de uma peça só.")


async def test_indicacao_para_quarto() -> None:
    llm, session = await _sessao()
    async with llm, session:
        result = await session.run(user_input="O que a gente indica pra quarto?")
        await julgar(result, "Indica Rolô Blackout ou Romana Blackout (pode citar as duas).")


async def test_calculadora_fora_do_ar_nao_inventa_valor() -> None:
    llm, session = await _sessao()
    async with llm, session:
        with mock_tools(AmandaEquipe, {"orcar_persiana": lambda: RuntimeError("calculadora fora do ar")}):
            result = await session.run(user_input="Quanto fica um rolô blackout de um e oitenta de largura por "
                                                  "um e vinte de altura, medida final, uma peça?")
        await julgar(result, "Não diz nenhum valor em reais; diz que não conseguiu calcular agora.")
