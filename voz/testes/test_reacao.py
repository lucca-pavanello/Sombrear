"""Reação curta na hora em que o cliente termina (reacao.py).

A regra e o corte rodam sem modelo; as conversas usam o modelo de verdade e o juiz (alguns
centavos), e as com valor precisam do servidor de orçamento no ar.
"""

from __future__ import annotations

import random
from datetime import datetime

import pytest
from livekit.agents import AgentSession, llm as lk_llm

from agenda import FUSO
from equipe import AmandaCliente, abertura
from juiz import julgar
from modelo import criar_llm
from reacao import DADO, GRUPOS, PRECO, Reacoes, _INICIO, _sem_acento, grupo, sem_reacao, tirar_reacao

TARDE = datetime(2026, 10, 20, 15, 0, tzinfo=FUSO)

TABELA = [
    # dado: medida, nome, número, modelo, "sim" com dado
    ("Um metro e vinte de largura por um e quarenta de altura.", "dado"),
    ("1,20 de largura por 1,40 m de altura.", "dado"),
    ("Carlos Henrique da Silva.", "dado"),
    ("Meu nome é Carlos.", "dado"),
    ("Dezessete, nove nove um dois três, quatro cinco seis sete.", "dado"),
    ("17 99123-4567", "dado"),
    ("Pode ser nesse número mesmo? Dezessete nove nove um dois três quatro cinco seis sete.", "dado"),
    ("Pode ser nesse número mesmo.", "dado"),
    ("É de rolo, blackout.", "dado"),
    ("A medida é da janela, do vão.", "dado"),
    # preço
    ("Quanto fica uma persiana pro meu quarto?", "preco"),
    ("Queria um orçamento de cortina.", "preco"),
    ("Qual o valor da romana?", "preco"),
    # problema
    ("Meu pedido ainda não chegou.", "problema_ruim"),
    ("A persiana que vocês instalaram quebrou.", "problema_ruim"),
    ("Queria falar sobre a entrega do meu pedido.", "problema"),
    ("Preciso de assistência na persiana.", "problema"),
    # sim
    ("Sim.", "sim"),
    ("Isso,", "sim"),
    ("Pode ser.", "sim"),
    ("Pode mandar no WhatsApp sim.", "sim"),
    # nada: cumprimento, não, pergunta aberta, curta ou ambígua
    ("Oi, boa tarde.", None),
    ("Oi, boa tarde. Quanto fica uma persiana?", None),
    ("Alô?", None),
    ("Não.", None),
    ("Vocês fazem cortina de linho?", None),
    ("Como funciona a instalação?", None),
    ("Hum", None),
    ("Então, é que eu tava pensando aqui", None),
    ("Deixa eu ver com a minha esposa.", None),
    ("", None),
]


@pytest.mark.parametrize("fala,esperado", TABELA)
def test_regra_do_grupo(fala: str, esperado: str | None) -> None:
    assert grupo(fala) == esperado


def test_na_duvida_silencio_e_o_maior_grupo() -> None:
    assert sum(g is None for _, g in TABELA) >= max(sum(g == x for _, g in TABELA) for x in GRUPOS)


def test_nunca_a_mesma_reacao_duas_vezes_seguidas() -> None:
    r = Reacoes(random.Random(7))
    frases = [r.escolher("Um metro e vinte por um e quarenta.") for _ in range(30)]
    assert all(a != b for a, b in zip(frases, frases[1:]))
    assert set(frases) <= set(DADO)


def test_evita_a_reacao_que_o_modelo_acabou_de_usar() -> None:
    for semente in range(20):
        r = Reacoes(random.Random(semente))
        assert r.escolher("Carlos Henrique da Silva.", "Certo. Qual o telefone?") != "Certo."


def test_sem_reacao_nao_escolhe_nada() -> None:
    r = Reacoes()
    assert r.escolher("Oi, boa tarde.") is None and not r.pediu_preco_agora()


def test_preco_cala_o_vou_calcular_so_no_turno_do_preco() -> None:
    r = Reacoes()
    assert r.escolher("Quanto fica uma persiana?") in PRECO and r.pediu_preco_agora()
    r.escolher("Isso.")
    assert not r.pediu_preco_agora()


@pytest.mark.parametrize("modelo,fica", [
    ("Certo. Qual a largura da janela?", "Qual a largura da janela?"),
    ("Certo, rolô blackout. Qual a medida?", "Rolô blackout. Qual a medida?"),
    ("Tá joia. Me passa seu nome completo?", "Me passa seu nome completo?"),
    ("Entendi, então vou passar pro time.", "Então vou passar pro time."),
    ("Perfeito! Certo. E o telefone?", "E o telefone?"),
    ("Pra quarto a gente indica a rolô blackout.", "Pra quarto a gente indica a rolô blackout."),
    ("Certamente a gente faz.", "Certamente a gente faz."),
    ("Tápete não vende.", "Tápete não vende."),
])
def test_tira_a_reacao_do_comeco(modelo: str, fica: str) -> None:
    assert tirar_reacao(modelo) == fica


async def _pedacos(partes):
    for p in partes:
        yield p


async def test_corte_em_streaming_segura_so_o_comeco() -> None:
    saida = [c async for c in sem_reacao(_pedacos(["Cer", "to. ", "Qual a ", "largura", " da janela?"]))]
    assert "".join(saida) == "Qual a largura da janela?"
    saida = [c async for c in sem_reacao(_pedacos(["Certo."]))]
    assert "".join(saida) == ""


# conversas com o modelo de verdade: a reação que sai na hora + a resposta dele, juntas
async def _turno(fala: str, antes: list[tuple[str, str]]) -> tuple[str | None, str]:
    ctx = lk_llm.ChatContext()
    ctx.add_message(role="assistant", content=abertura(TARDE))
    for quem, texto in antes:
        ctx.add_message(role=quem, content=texto)
    modelo = criar_llm()
    session = AgentSession(llm=modelo)
    agente = AmandaCliente(TARDE, chat_ctx=ctx)
    async with modelo, session:
        await session.start(agente)
        anterior = next((t for q, t in reversed(antes) if q == "assistant"), abertura(TARDE))
        reacao = agente.reacoes.escolher(fala, anterior)
        result = await session.run(user_input=fala)
    falas = [e.item.text_content for e in result.events if e.type == "message" and e.item.role == "assistant"]
    return reacao, " ".join(f for f in falas if f)


CONVERSAS = [
    ("Um e vinte de largura por um e quarenta de altura.",
     [("user", "Quero uma rolô blackout pro quarto, medida do vão."), ("assistant", "Qual a largura e a altura?")]),
    ("Carlos Henrique da Silva.",
     [("user", "Pode mandar no WhatsApp."), ("assistant", "Me passa seu nome completo?")]),
    ("Meu pedido ainda não chegou, era pra ontem.", []),
    ("Pode mandar no WhatsApp sim.",
     [("user", "Quanto fica?"), ("assistant", "Consegue me mandar uma foto da janela pelo WhatsApp?")]),
]


@pytest.mark.parametrize("fala,antes", CONVERSAS)
async def test_reacao_combina_e_nao_duplica(fala: str, antes: list[tuple[str, str]]) -> None:
    reacao, resposta = await _turno(fala, antes)
    assert reacao, f"sem reação para {fala!r}"
    assert not _INICIO.match(_sem_acento(resposta)), f"a resposta começa com outra reação: {resposta!r}"

    class _Junto:  # o juiz lê o que o cliente ouviu: reação + resposta
        events = [type("E", (), {"type": "message", "item": type("I", (), {"role": "assistant",
                  "text_content": f"{reacao} {resposta}"})()})()]

    await julgar(_Junto, f'O cliente disse "{fala}". A fala começa com a reação rápida "{reacao}", que precisa '
                         "combinar com o que ele disse. Depois dela o atendimento continua com lógica, sem "
                         'repetir a reação nem emendar outra reação logo em seguida ("Certo. Certo." ou '
                         '"Entendi. Tá joia." reprovam).')


async def test_sem_reacao_o_modelo_fala_do_jeito_dele() -> None:
    reacao, resposta = await _turno("Oi, boa tarde. Vocês fazem cortina?", [])
    assert reacao is None and resposta
