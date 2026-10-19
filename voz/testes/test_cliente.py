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
    assert abertura(TARDE) == "Boa tarde, Amanda da Sombrear Decor aqui. Como posso te ajudar?"
    assert abertura(TARDE.replace(hour=9)).startswith("Bom dia")
    assert abertura(TARDE.replace(hour=19)).startswith("Boa noite")


async def test_preco_de_cara_nao_calcula_e_pergunta_uma_coisa() -> None:
    modelo, session = await _sessao()
    async with modelo, session:
        result = await session.run(user_input="Oi, quanto custa uma persiana?")
        assert not _chamou(result, "orcar_persiana")
        await julgar(result, "Não diz valor em reais. Responde curto e faz UMA pergunta para entender o caso "
                             "ou pedir um dado do orçamento (modelo, cômodo, medida).")


async def test_duvida_entende_o_caso_e_oferece_foto_no_whatsapp() -> None:
    modelo, session = await _sessao([
        ("user", "Oi, eu queria colocar persiana no meu quarto, mas não sei qual."),
        ("assistant", "Entendi. O que mais te incomoda aí, a claridade de manhã ou o calor?"),
    ])
    async with modelo, session:
        result = await session.run(user_input="A claridade, entra muita luz cedo e eu acordo.")
        assert not _chamou(result, "orcar_persiana")
        await julgar(result, "Indica um modelo ou tecido que bloqueia a luz (blackout) e/ou oferece seguir pelo "
                             "WhatsApp para o cliente mandar uma foto da janela. Não diz valor.")


@precisa_do_orcamento
async def test_quer_o_preco_antes_e_ela_calcula_na_ligacao() -> None:
    modelo, session = await _sessao([
        ("user", "Queria uma persiana rolô blackout pro quarto, mas quero saber o preço antes."),
        ("assistant", "Tá joia. Essa medida que você tem é do vão da janela ou já é a medida da persiana?"),
        ("user", "É do vão. Um metro e vinte de largura por um e quarenta de altura."),
        ("assistant", "Certo, a gente já dá os aumentos necessários. Um e vinte de largura por um e quarenta "
                      "de altura, isso?"),
    ])
    async with modelo, session:
        result = await session.run(user_input="Isso.")
        args = _chamou(result, "orcar_persiana")
        assert args, "não chamou a calculadora"
        a = args[-1]
        assert a["modelo"] == "Rolo" and a["largura"] == 1.2 and a["altura"] == 1.4 and a["medida_do_vao"] is True
        await julgar(result, "Diz um valor em reais em até quatro vezes e à vista.")


async def test_se_perguntarem_se_e_robo_confirma() -> None:
    modelo, session = await _sessao()
    async with modelo, session:
        result = await session.run(user_input="Espera, você é uma pessoa ou é robô?")
        await julgar(result, "Confirma com naturalidade que é a assistente virtual da Sombrear. Não diz que é "
                             "uma pessoa e não nega ser IA.")


async def test_outro_assunto_pede_nome_completo_e_nao_resolve() -> None:
    modelo, session = await _sessao()
    async with modelo, session:
        result = await session.run(user_input="Oi, eu comprei uma persiana semana passada e queria saber "
                                              "quando vão instalar.")
        assert not _chamou(result, "anotar_contato")
        await julgar(result, "Não promete data nem diz que vai verificar a agenda. Pede o nome completo ou o "
                             "telefone para passar pro time, uma coisa por vez.")


async def test_anota_o_contato_e_diz_que_o_time_chama() -> None:
    modelo, session = await _sessao([
        ("user", "Oi, eu comprei uma persiana semana passada e queria saber quando vão instalar."),
        ("assistant", "Entendi, vou passar pro time. Qual é o seu nome completo?"),
        ("user", "Marcos Antônio Ribeiro."),
        ("assistant", "E o seu telefone com DDD?"),
        ("user", "Dezessete, nove nove um dois três, quatro cinco seis sete."),
        ("assistant", "Dezessete, nove nove um dois três, quatro cinco seis sete, isso?"),
    ])
    async with modelo, session:
        result = await session.run(user_input="Isso mesmo.")
        args = _chamou(result, "anotar_contato")
        assert args, "não anotou o contato"
        assert "".join(c for c in args[-1]["telefone"] if c.isdigit()) == "17991234567"
        assert args[-1]["assunto"] == "outro"
        contato = session.current_agent.ligacao.contato
        assert contato["nome"].startswith("Marcos") and contato["telefone"] == "17991234567"
        await julgar(result, "Diz que o time vai mandar mensagem ou chamar no WhatsApp. Não promete data de instalação.")


async def test_ligou_de_um_numero_conhecido_oferece_chamar_nele() -> None:
    modelo, session = await _sessao([
        ("user", "Oi, eu comprei uma persiana semana passada e queria saber quando vão instalar."),
        ("assistant", "Entendi, vou passar pro time. Qual é o seu nome completo?"),
    ])
    async with modelo, session:
        await session.current_agent.conhecer_linha("+5517998765432")
        result = await session.run(user_input="Marcos Antônio Ribeiro.")
        assert not _chamou(result, "anotar_contato")
        await julgar(result, "Pergunta se pode chamar no WhatsApp no número de onde a pessoa ligou, sem pedir "
                             "que ela dite o número.")
        result = await session.run(user_input="Pode sim.")
        args = _chamou(result, "anotar_contato")
        assert args, "não anotou o contato"
        assert session.current_agent.ligacao.contato["telefone"] == "17998765432"
        assert args[-1]["assunto"] == "outro"
