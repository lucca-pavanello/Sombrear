"""A agenda de visitas vista pela voz: as duas funções da migration 0031.

A regra (janela, deslocamento, capacidade, bloqueio, corrida de duas ligações) mora no banco.
Aqui só chama. `DATABASE_URL` aponta pro Postgres local da bancada ou, no ar, pro Supabase
com a senha do banco (fica em ~/.secrets, nunca no repo).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date, datetime
from typing import Protocol
from zoneinfo import ZoneInfo

import psycopg

FUSO = ZoneInfo("America/Sao_Paulo")


class HorarioOcupado(Exception):
    """O horário não está mais livre (outra ligação marcou, ou nunca esteve)."""


@dataclass(frozen=True)
class Visita:
    id: str
    inicio: datetime
    cliente_nome: str
    telefone: str
    endereco: str | None


class Agenda(Protocol):
    async def horarios_livres(self, de: date, ate: date) -> list[datetime]: ...
    async def marcar(self, inicio: datetime, cliente_nome: str, telefone: str,
                     endereco: str | None, observacao: str | None,
                     ligacao_ref: str | None) -> Visita: ...


class AgendaPostgres:
    def __init__(self, dsn: str | None = None) -> None:
        self.dsn = dsn or os.environ["DATABASE_URL"]

    async def horarios_livres(self, de: date, ate: date) -> list[datetime]:
        async with await psycopg.AsyncConnection.connect(self.dsn) as con:
            cur = await con.execute("select h from public.horarios_livres(%s, %s) h", (de, ate))
            return [r[0].astimezone(FUSO) for r in await cur.fetchall()]

    async def marcar(self, inicio: datetime, cliente_nome: str, telefone: str,
                     endereco: str | None, observacao: str | None,
                     ligacao_ref: str | None) -> Visita:
        async with await psycopg.AsyncConnection.connect(self.dsn) as con:
            try:
                cur = await con.execute(
                    """select id, inicio, cliente_nome, telefone, endereco
                         from public.marcar_visita(%s, %s, %s, %s, %s, 'voz', %s)""",
                    (inicio, cliente_nome, telefone, endereco, observacao, ligacao_ref))
                r = await cur.fetchone()
            except psycopg.errors.RaiseException as e:
                if "horario_ocupado" in str(e):
                    raise HorarioOcupado from e
                raise
            return Visita(str(r[0]), r[1].astimezone(FUSO), r[2], r[3], r[4])
