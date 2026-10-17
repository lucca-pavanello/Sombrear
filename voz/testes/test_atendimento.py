"""Conversas em texto com o modelo de verdade e uma agenda em memória.

A regra da agenda (corrida, janela, capacidade) é testada no SQL
(src/lib/__tests__/agendaVisitas.sql.test.ts). Aqui o que se prova é a conversa: consulta
antes de oferecer, resumo antes de gravar, não grava sem o cliente concordar, não inventa
quando a agenda cai. Gasta poucos centavos de Muse por rodada.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

import pytest
from livekit.agents import AgentSession

from agenda import FUSO, HorarioOcupado, Visita
from atendimento import Amanda, contar_falas, novo_estado
from juiz import julgar
from modelo import criar_llm


class AgendaFalsa:
    """Dias úteis das 9h às 16h, uma visita por horário."""

    def __init__(self, cair: bool = False) -> None:
        self.visitas: list[Visita] = []
        self.consultas: list[tuple[date, date]] = []
        self.cair = cair

    async def horarios_livres(self, de: date, ate: date) -> list[datetime]:
        if self.cair:
            raise RuntimeError("banco fora do ar")
        self.consultas.append((de, ate))
        ocupados = {v.inicio for v in self.visitas}
        out, d = [], de
        while d <= ate:
            if d.weekday() < 5 and d > date.today():
                for h in range(9, 17):
                    t = datetime.combine(d, time(h), FUSO)
                    if t not in ocupados:
                        out.append(t)
            d += timedelta(days=1)
        return out

    async def marcar(self, inicio, cliente_nome, telefone, endereco, observacao, ligacao_ref):
        if inicio in {v.inicio for v in self.visitas}:
            raise HorarioOcupado
        v = Visita(f"v{len(self.visitas) + 1}", inicio, cliente_nome, telefone, endereco)
        self.visitas.append(v)
        return v


def proxima_terca() -> date:
    d = date.today() + timedelta(days=2)
    while d.weekday() != 1:
        d += timedelta(days=1)
    return d


async def _sessao(agenda: AgendaFalsa):
    llm = criar_llm()
    session = AgentSession(llm=llm, userdata=novo_estado(agenda))
    contar_falas(session)
    await session.start(Amanda())
    return llm, session


@pytest.mark.asyncio
async def test_consulta_a_agenda_antes_de_oferecer_horario() -> None:
    agenda = AgendaFalsa()
    llm, session = await _sessao(agenda)
    async with llm, session:
        result = await session.run(user_input="Oi, queria marcar uma visita pra medir as janelas, "
                                              "pode ser na terça que vem de manhã?")
        assert result.expect.next_event(type="function_call").event().item.name == "ver_horarios"
        assert agenda.consultas, "ofereceu horário sem consultar a agenda"
        await julgar(result, "Oferece um ou mais horários de manhã na terça.")


@pytest.mark.asyncio
async def test_caminho_completo_marca_so_depois_do_cliente_concordar() -> None:
    agenda = AgendaFalsa()
    llm, session = await _sessao(agenda)
    terca = proxima_terca()
    async with llm, session:
        await session.run(user_input=f"Quero marcar visita técnica dia {terca:%d/%m} às 10 da manhã.")
        await session.run(user_input="Meu nome é Carla Mendes, telefone 17 99123-4567, "
                                     "rua das Acácias 120, bairro Redentora.")
        assert agenda.visitas == [], "gravou antes de ler o resumo e ouvir o cliente"
        await session.run(user_input="Isso mesmo, pode marcar.")
        assert len(agenda.visitas) == 1
        v = agenda.visitas[0]
        assert v.inicio == datetime.combine(terca, time(10), FUSO)
        assert v.telefone == "17991234567"
        assert "Acácias" in (v.endereco or "")


@pytest.mark.asyncio
async def test_pedido_completo_numa_fala_so_nao_grava_sem_resumo() -> None:
    agenda = AgendaFalsa()
    llm, session = await _sessao(agenda)
    terca = proxima_terca()
    async with llm, session:
        result = await session.run(
            user_input=f"Marca pra mim dia {terca:%d/%m} às 14h, Rafael Souza, 17 98888-1111, "
                       "avenida Bady Bassitt 3000, Centro. Pode confirmar direto.")
        assert agenda.visitas == [], "confirmou sem o cliente ouvir o resumo"
        await julgar(result, "Lê os dados da visita (dia, hora, nome, endereço) e pede para o "
                             "cliente confirmar.")


@pytest.mark.asyncio
async def test_agenda_fora_do_ar_nao_inventa_horario() -> None:
    agenda = AgendaFalsa(cair=True)
    llm, session = await _sessao(agenda)
    async with llm, session:
        result = await session.run(user_input="Tem horário pra visita na quinta à tarde?")
        await julgar(result, "Não oferece nenhum horário com hora marcada (como 14h ou 15h30); "
                             "repetir o dia ou período que o cliente pediu não conta. Diz que "
                             "não conseguiu consultar agora ou que vai pedir para a equipe retornar.")
        assert agenda.visitas == []


@pytest.mark.asyncio
async def test_nao_passa_preco() -> None:
    agenda = AgendaFalsa()
    llm, session = await _sessao(agenda)
    async with llm, session:
        result = await session.run(user_input="Quanto custa uma persiana rolô pra uma janela de dois metros?")
        await julgar(result, "Não diz nenhum valor em reais; explica que a equipe passa o preço "
                             "na visita técnica e oferece marcar a visita.")
