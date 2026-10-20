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


async def test_outro_assunto_pede_o_nome_e_nao_resolve() -> None:
    modelo, session = await _sessao()
    async with modelo, session:
        result = await session.run(user_input="Oi, eu comprei uma persiana semana passada e queria saber "
                                              "quando vão instalar.")
        assert not _chamou(result, "anotar_contato")
        await julgar(result, "Não promete data nem diz que vai verificar a agenda. Pede o nome ou o "
                             "telefone para passar pro time, uma coisa por vez.")


async def test_anota_o_contato_e_diz_que_o_time_chama() -> None:
    modelo, session = await _sessao([
        ("user", "Oi, eu comprei uma persiana semana passada e queria saber quando vão instalar."),
        ("assistant", "Entendi, vou passar pro time. Qual é o seu nome?"),
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


async def test_numero_conhecido_avisa_que_chama_nele_e_pede_so_o_nome() -> None:
    modelo, session = await _sessao([
        ("user", "Bom dia, queria uma persiana pro meu quarto."),
        ("assistant", "Pra quarto a gente costuma indicar a Rolô Blackout. O que te incomoda mais, o sol ou a claridade?"),
        ("user", "O sol, quero deixar bem escuro."),
        ("assistant", "Então a Rolô Blackout resolve. Consegue me mandar uma foto da janela pelo WhatsApp?"),
    ])
    async with modelo, session:
        await session.current_agent.conhecer_linha("+5517998765432")
        result = await session.run(user_input="Consigo mandar, sim.")
        assert not _chamou(result, "anotar_contato")
        await julgar(result, "Diz que vai chamar ou mandar mensagem no WhatsApp no número de onde a pessoa ligou "
                             "(afirma, não pergunta se pode) e pede o nome. Não pede o nome completo nem que a "
                             "pessoa dite o número.")
        result = await session.run(user_input="Lucca.")
        args = _chamou(result, "anotar_contato")
        assert args, "não anotou o contato"
        assert session.current_agent.ligacao.contato["telefone"] == "17998765432"
        assert session.current_agent.ligacao.contato["nome"].startswith("Lucca")
        # a mensagem do WhatsApp pede a foto "da janela do quarto": o cômodo tem que vir anotado
        assert [a.lower() for a in session.current_agent.ligacao.contato["ambientes"]] == ["quarto"]


def _historico_com_contato_anotado():
    return [
        ("user", "Oi, eu comprei uma persiana semana passada e queria saber quando vão instalar."),
        ("assistant", "Entendi, vou passar pro time. Qual é o seu nome?"),
        ("user", "Marcos."),
        ("assistant", "E o seu telefone com DDD?"),
        ("user", "Dezessete, nove nove um dois três, quatro cinco seis sete."),
        ("assistant", "Pronto, Marcos, anotei. O time vai te mandar mensagem no WhatsApp nesse número, tá?"),
    ]


async def test_cliente_se_despede_ela_desliga() -> None:
    modelo, session = await _sessao(_historico_com_contato_anotado())
    async with modelo, session:
        result = await session.run(user_input="Tá bom, obrigado. Tchau!")
        assert _chamou(result, "encerrar_ligacao"), "não desligou depois da despedida"
        # a linha cai uns segundos depois (espera o "tchau" de volta); o motivo já fica marcado
        assert session.current_agent.motivo_saida in ("cliente_despediu", "atendimento_concluido")


async def test_despedidas_em_loop_ela_desliga() -> None:
    """Duas IAs se despedindo para sempre: ela tem que cortar."""
    historico = _historico_com_contato_anotado() + [
        ("user", "Obrigado!"), ("assistant", "Imagina, Marcos!"),
        ("user", "Obrigado, viu, tchau!"), ("assistant", "Por nada! Qualquer coisa, chama a gente."),
        ("user", "Obrigado mesmo, tchau tchau!"), ("assistant", "Que isso! Até mais!"),
    ]
    modelo, session = await _sessao(historico)
    async with modelo, session:
        result = await session.run(user_input="Muito obrigado, tchau, até mais!")
        assert _chamou(result, "encerrar_ligacao"), "ficou no loop de despedida"


async def test_nao_desliga_no_meio_de_uma_pergunta() -> None:
    modelo, session = await _sessao(_historico_com_contato_anotado())
    async with modelo, session:
        result = await session.run(user_input="Ah, e vocês instalam em Mirassol também?")
        # o que vale é a ligação não cair: se o modelo tentar, a trava do código (pergunta no ar) barra
        assert session.current_agent.ligacao.encerramento is None, "desligou com o cliente perguntando"
        assert session.current_agent.motivo_saida is None, "se despediu com o cliente perguntando"
        await julgar(result, "Responde se instala em Mirassol (sim, instalação em Rio Preto e Mirassol).")


async def test_cliente_chega_com_alo_ela_nao_devolve_o_cumprimento() -> None:
    modelo, session = await _sessao()
    async with modelo, session:
        result = await session.run(user_input="Alô? Oi? Boa tarde.")
        await julgar(result, "NÃO diz 'boa tarde' nem 'bom dia' de novo (ela já cumprimentou). Diz que está ali "
                             "e/ou pergunta como ajudar, por exemplo se é persiana ou cortina.")


async def test_com_o_comodo_pergunta_se_ja_tem_modelo_em_mente() -> None:
    modelo, session = await _sessao([
        ("user", "Queria um orçamento de persiana."),
        ("assistant", "Pra qual cômodo é?"),
    ])
    async with modelo, session:
        result = await session.run(user_input="Pra sala.")
        await julgar(result, "Pergunta se a pessoa já tem algum modelo em mente. Não pergunta ainda o que "
                             "incomoda (sol, claridade) e não indica modelo.")
        result = await session.run(user_input="Não, não sei qual.")
        await julgar(result, "Pergunta o que mais incomoda na sala (sol, claridade, privacidade) para achar o "
                             "modelo ideal. Uma pergunta só.")
