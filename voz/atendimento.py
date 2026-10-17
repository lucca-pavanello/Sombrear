"""Voz da Sombrear: atende a ligação e marca a visita técnica na agenda do Dash.

Rodar (bancada, sem número):
    uv run atendimento.py console --text     # conversa digitada no terminal
    uv run atendimento.py console            # com microfone e caixa de som (precisa de STT e TTS)

O modelo entende a conversa; o código cuida do estado. A visita só é gravada depois que o
cliente ouviu o resumo e concordou numa fala posterior (preparar_visita → confirmar_visita).
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import date, datetime

from dotenv import load_dotenv
from livekit import agents
from livekit.agents import (
    Agent, AgentServer, AgentSession, ChatContext, RunContext, ToolError, function_tool,
)

from agenda import FUSO, Agenda, AgendaPostgres, HorarioOcupado
from modelo import criar_llm

load_dotenv(".env.local")
log = logging.getLogger("sombrear-voz")

DIAS_SEMANA = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]


@dataclass
class VisitaPendente:
    inicio: datetime
    cliente_nome: str
    telefone: str
    endereco: str
    observacao: str
    revisada_apos: int  # quantas falas do cliente existiam quando o resumo foi feito


@dataclass
class Estado:
    agenda: Agenda
    falas_cliente: int = 0
    pendente: VisitaPendente | None = None
    marcadas: list[str] = field(default_factory=list)
    ligacao_ref: str | None = None


def contar_falas(session: AgentSession[Estado]) -> None:
    """Liga o contador de falas do cliente. Chamar antes de session.start."""

    @session.on("conversation_item_added")
    def _(ev) -> None:
        if getattr(ev.item, "role", None) == "user":
            session.userdata.falas_cliente += 1


def falar_data(d: datetime) -> str:
    return f"{DIAS_SEMANA[d.weekday()]} {d.day:02d}/{d.month:02d} às {d:%H:%M}"


def instrucoes(agora: datetime) -> str:
    return f"""Você é a Amanda, da Sombrear Decor, loja de cortinas e persianas sob medida em
São José do Rio Preto, desde 1982. Está atendendo uma ligação telefônica.

Seu objetivo: marcar a visita técnica, em que a equipe vai até a casa do cliente com o
mostruário e tira as medidas.

Agora é {DIAS_SEMANA[agora.weekday()]}, {agora:%d/%m/%Y %H:%M} (horário de Rio Preto).

Como falar:
- Frases curtas, uma pergunta por vez, tom simpático de loja de bairro. Nada de lista, emoji
  ou símbolo: tudo vira voz.
- Datas por extenso do jeito falado ("terça, dia 21, às dez").
- Aceite o que o cliente já disse junto e pergunte só o que falta.

Para marcar:
1. Pergunte qual dia e período prefere e consulte com ver_horarios. Ofereça no máximo
   três opções.
2. Junte nome, telefone com DDD e endereço da visita (rua, número e bairro).
3. Chame preparar_visita e leia o resumo para o cliente conferir.
4. Só chame confirmar_visita depois que o cliente concordar com o resumo. Se ele corrigir
   algo, chame preparar_visita de novo.
5. Depois de confirmada, diga que a equipe vai entrar em contato e se despeça.

Limites:
- Não fale preço, prazo de entrega, medida nem desconto: diga que a equipe passa isso na
  visita.
- Se uma ferramenta falhar, diga que vai pedir para a equipe retornar e anote o pedido; nunca
  diga que marcou sem confirmar_visita ter dado certo.
- Se pedirem para falar com alguém da loja, diga o telefone (17) 3304-1354 e o horário:
  segunda a sexta das 9h às 17h e sábado das 9h às 13h.
"""


class Amanda(Agent):
    def __init__(self, agora: datetime | None = None, chat_ctx: ChatContext | None = None) -> None:
        super().__init__(instructions=instrucoes(agora or datetime.now(FUSO)), chat_ctx=chat_ctx)

    @function_tool()
    async def ver_horarios(self, context: RunContext[Estado], dia_inicial: str, dia_final: str) -> str:
        """Consulta os horários livres para visita técnica entre duas datas (AAAA-MM-DD,
        inclusive). Use quando o cliente disser o dia ou o período que prefere."""
        try:
            de, ate = date.fromisoformat(dia_inicial), date.fromisoformat(dia_final)
        except ValueError:
            raise ToolError("Datas no formato AAAA-MM-DD.")
        if ate < de or (ate - de).days > 14:
            raise ToolError("Período inválido: no máximo 14 dias, dia_final depois de dia_inicial.")
        livres = await context.userdata.agenda.horarios_livres(de, ate)
        if not livres:
            return json.dumps({"livres": [], "obs": "nenhum horário nesse período"})
        return json.dumps({"livres": [h.isoformat() for h in livres[:12]],
                           "total": len(livres)}, ensure_ascii=False)

    @function_tool()
    async def preparar_visita(self, context: RunContext[Estado], inicio: str, cliente_nome: str,
                              telefone: str, endereco: str, observacao: str = "") -> str:
        """Monta o resumo da visita para o cliente conferir, sem gravar ainda.
        inicio: um dos horários de ver_horarios (ISO com fuso). telefone com DDD."""
        try:
            quando = datetime.fromisoformat(inicio)
        except ValueError:
            raise ToolError("inicio precisa ser um dos horários devolvidos por ver_horarios.")
        if quando.tzinfo is None:
            quando = quando.replace(tzinfo=FUSO)
        digitos = "".join(c for c in telefone if c.isdigit())
        if len(digitos) < 10:
            raise ToolError("Telefone incompleto: peça com DDD.")
        if not cliente_nome.strip() or not endereco.strip():
            raise ToolError("Faltam nome ou endereço.")
        livres = await context.userdata.agenda.horarios_livres(quando.date(), quando.date())
        if quando not in livres:
            raise ToolError("Esse horário não está livre. Consulte ver_horarios de novo.")
        e = context.userdata
        e.pendente = VisitaPendente(quando, cliente_nome.strip(), digitos, endereco.strip(),
                                    observacao.strip(), revisada_apos=e.falas_cliente)
        return json.dumps({"resumo": {"quando": falar_data(quando.astimezone(FUSO)),
                                      "nome": e.pendente.cliente_nome, "telefone": digitos,
                                      "endereco": e.pendente.endereco},
                           "proximo": "leia o resumo e espere o cliente concordar"},
                          ensure_ascii=False)

    @function_tool()
    async def confirmar_visita(self, context: RunContext[Estado]) -> str:
        """Grava a visita do último resumo. Só depois que o cliente concordou com ele."""
        e = context.userdata
        p = e.pendente
        if p is None:
            raise ToolError("Não há resumo. Chame preparar_visita antes.")
        if e.falas_cliente <= p.revisada_apos:
            raise ToolError("O cliente ainda não respondeu ao resumo. Leia e espere a resposta.")
        try:
            v = await e.agenda.marcar(p.inicio, p.cliente_nome, p.telefone, p.endereco,
                                      p.observacao or None, e.ligacao_ref)
        except HorarioOcupado:
            e.pendente = None
            raise ToolError("Alguém acabou de pegar esse horário. Ofereça outro com ver_horarios.")
        e.pendente = None
        e.marcadas.append(v.id)
        log.info("visita marcada %s %s", v.id, v.inicio.isoformat())
        return json.dumps({"marcada": True, "quando": falar_data(v.inicio)}, ensure_ascii=False)


def novo_estado(agenda: Agenda | None = None) -> Estado:
    return Estado(agenda=agenda or AgendaPostgres())


server = AgentServer()


@server.rtc_session(agent_name="sombrear-voz")
async def atender(ctx: agents.JobContext) -> None:
    session: AgentSession[Estado] = AgentSession(
        userdata=novo_estado(),
        llm=criar_llm(),
        # STT, TTS e detecção de turno entram na etapa de voz (ver README)
    )
    session.userdata.ligacao_ref = ctx.room.name
    contar_falas(session)
    await session.start(room=ctx.room, agent=Amanda())
    await session.generate_reply(
        instructions="Atenda: 'Sombrear Decor, Amanda falando, bom dia/boa tarde', conforme a hora.")


if __name__ == "__main__":
    agents.cli.run_app(server)
