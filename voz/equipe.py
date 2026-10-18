"""Amanda da equipe: a mesma Amanda do WhatsApp, respondendo a equipe da loja pela voz.

Fase 1 do PLANO.md. Tira dúvida de produto, indica modelo por ambiente e monta orçamento. O número
sai sempre do motor do Dash (voz/orcamento/servidor.ts → src/lib/voz/orcar.ts), nunca do modelo.

Rodar (bancada):
    npx tsx voz/orcamento/servidor.ts <pasta-da-foto-de-precos>   # em outro terminal
    uv run --group local python local/servidor_voz.py             # ouvir e falar (fase 2), outro terminal
    uv run equipe.py console --text                                # conversar digitando
    uv run equipe.py console                                       # conversar pelo microfone
"""

from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Literal

import aiohttp
from dotenv import load_dotenv
from num2words import num2words
from livekit import agents
from livekit.agents import (Agent, AgentServer, AgentSession, APIConnectOptions, ChatContext, ModelSettings,
                            RunContext, ToolError, function_tool, llm, tts)
from livekit.agents.utils import is_given
from livekit.agents.voice.agent_session import SessionConnectOptions
from livekit.plugins import openai, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from agenda import FUSO
from frases import TrechosCurtos
from sem_silencio import (FALA_CALCULAR, FALA_CALCULAR_CURTA, FALA_ERRO, FALA_ESPERA, FALA_REPETIR, FALAS, Vigia,
                          ESPERA, ESPERA_DEPOIS_DA_CONTA, com_espera, fala_calcular, sem_anuncio)
from modelo import criar_llm

load_dotenv(".env.local")

URL_ORCAMENTO = os.environ.get("URL_ORCAMENTO", "http://127.0.0.1:8791")
URL_VOZ = os.environ.get("URL_VOZ", "http://127.0.0.1:8792/v1")  # local/servidor_voz.py
CONHECIMENTO = Path(__file__).parent / "conhecimento"
DIAS = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]

Modelo = Literal["Rolo", "Rolo Motorizado", "Double", "Romana", "PV", "PH_Aluminio", "PH_50"]


def conhecimento() -> str:
    partes = []
    for nome, titulo in [("produto", "PRODUTO"), ("ambientes", "AMBIENTES"), ("catalogo", "CATÁLOGO"),
                         ("empresa", "A EMPRESA"), ("objecoes", "PREÇO E OBJEÇÕES")]:
        texto = (CONHECIMENTO / f"{nome}.md").read_text(encoding="utf-8")
        texto = "\n".join(l for l in texto.splitlines() if not l.startswith("<!--"))
        partes.append(f"## {titulo}\n{texto.strip()}")
    return "\n\n".join(partes)


def instrucoes(agora: datetime) -> str:
    return f"""Você é a Amanda, da Sombrear Decor (cortinas e persianas sob medida em São José do Rio
Preto, desde 1982). Agora você está conversando POR VOZ com alguém da EQUIPE da loja, não com
cliente. Ajude com dúvida de produto, indicação por ambiente e orçamento.

Agora é {DIAS[agora.weekday()]}, {agora:%d/%m/%Y %H:%M}.

# Como falar (é voz)
- Você só conversa: não desliga a ligação, não registra venda, não recebe pagamento e não manda
  nada para ninguém. Se pedirem, diga que isso é com a equipe; nunca diga que fez.
- Frases curtas, direto ao ponto, tom de colega de trabalho. Nada de lista, emoji, asterisco ou
  símbolo: tudo vira fala.
- Valores do jeito falado: "quinhentos e quarenta e nove reais e setenta centavos".
- Medidas do jeito falado: "um metro e oitenta por um e vinte".

# Orçamento
- NUNCA faça conta de cabeça nem invente valor: use orcar_persiana ou orcar_cortina e fale o que
  a ferramenta devolver.
- Quando for calcular, chame a calculadora SEM falar nada antes, nem "um instante" nem "vou
  calcular": o sistema já avisa a pessoa sozinho. Depois fale direto o resultado, começando pelo valor.
- Se a calculadora der erro ou estiver fora do ar, diga com todas as letras "não consegui calcular
  agora" e ofereça tentar de novo; não fale valor nem frase que pareça um orçamento.
- Para orçar precisa de: modelo, largura e altura (qual é qual), se a medida é do VÃO ou já da
  persiana, quantidade e o tecido ou o tipo de tecido. Pergunte só o que faltar, uma coisa por vez.
  Se a pessoa já disse tudo, calcule na hora.
- Medida do vão: mande medida_do_vao verdadeiro e a medida como foi dita; a ferramenta soma os
  aumentos da loja.
- Tipo sem nome de tecido (blackout, decorativo): mande tipo_tecido e diga "a partir de". Tela
  solar sem porcentagem: pergunte se é 1% ou 3% antes de calcular.
- Persiana vertical (PV): calcule pelo mais barato e avise que tem outras linhas.
- Se der erro de largura maior que o rolo, proponha dividir em peças (quantidade N, largura
  dividida por N) e calcule assim se a pessoa concordar.
- O valor você fala lendo "fale_assim" do resultado, como está, sem mudar número nem a parte da
  instalação. Depois, se ajudar, diga qual tecido foi considerado.
- Bandô é opcional: só inclua se pedirem.
- Cortina: a precificação ainda está sendo ajustada pela loja; quando calcular, diga que é uma
  prévia para conferir.

# O que você sabe
{conhecimento()}
"""


async def _chamar(caminho: str, corpo: dict | None = None) -> dict:
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as s:
            if corpo is None:
                async with s.get(URL_ORCAMENTO + caminho) as r:
                    return await r.json()
            async with s.post(URL_ORCAMENTO + caminho, json=corpo) as r:
                return await r.json()
    except (aiohttp.ClientError, TimeoutError) as e:
        raise ToolError(f"Calculadora fora do ar ({type(e).__name__}). Não dê valor.") from e


def _opcional(valor: str | None, validos: set[str], padrao: str | None) -> str | None:
    """O Muse às vezes manda a palavra "null" no lugar de deixar vazio: o código absorve isso."""
    v = (valor or "").strip()
    if v.lower() in ("", "null", "none"):
        return padrao
    return v if v in validos else padrao


TIPOS = {"blackout", "decorativo", "tela_solar_1", "tela_solar_3"}
ACABAMENTOS = {"nenhum", "bando_branco", "bando_preto", "barra", "kit_box"}


def reais(valor: float) -> str:
    """722.4 -> "setecentos e vinte e dois reais e quarenta centavos" (sem a vírgula de "mil, ...")."""
    return num2words(round(valor, 2), lang="pt_BR", to="currency").replace(", ", " ")


def para_falar(r: dict) -> str:
    """A frase do valor pronta, feita pelo código: o modelo errava a instalação (dizia "já com a
    instalação" ou "a loja confirma" quando ela vinha à parte, simulação de 17/10)."""
    frase = f"{reais(r['total4x'])} em até quatro vezes, ou {reais(r['totalAvista'])} à vista"
    inst = r.get("instalacao")
    if isinstance(inst, (int, float)):
        frase += f", mais {reais(inst)} de instalação"
    elif inst == "sob_consulta":
        frase += ", e a instalação a loja confirma"
    return frase + "."


def _resultado(r: dict) -> str:
    if not r.get("ok"):
        raise ToolError(json.dumps({"erro": r.get("erro"), "sugestoes": r.get("sugestoes")}, ensure_ascii=False))
    # nomes que não deixam dúvida: o total NÃO inclui a instalação (na simulação de 17/10 o modelo
    # disse "já com a instalação" lendo "instalacao" ao lado do total)
    return json.dumps({"tecido": r["tecido"], "maisBarato": r["maisBarato"], "largura": r["largura"],
                       "altura": r["altura"], "total4x_sem_instalacao": r["total4x"],
                       "totalAvista_sem_instalacao": r["totalAvista"], "instalacao_a_parte": r["instalacao"],
                       "observacoes": r["observacoes"], "fale_assim": para_falar(r)}, ensure_ascii=False)


class AmandaEquipe(Agent):
    def __init__(self, agora: datetime | None = None, chat_ctx: ChatContext | None = None) -> None:
        super().__init__(instructions=instrucoes(agora or datetime.now(FUSO)), chat_ctx=chat_ctx)

    async def llm_node(self, chat_ctx: ChatContext, tools: list[llm.Tool], model_settings: ModelSettings):
        """O modelo de sempre, mas sem silêncio: "só um segundinho" se demorar, pedido para repetir
        se falhar de vez e sem o anúncio antes da calculadora (sem_silencio.py)."""
        # logo depois da calculadora o "vou calcular" já ocupa ~2 s de fala: espera mais antes do "segundinho"
        depois_da_conta = bool(chat_ctx.items) and chat_ctx.items[-1].type == "function_call_output"
        # o Muse só aceita tool_choice "auto"; quando o LiveKit pede "none" (ferramenta falhou várias
        # vezes seguidas) o pedido voltava 400 e ela ficava muda: sem ferramentas dá no mesmo
        if model_settings.tool_choice == "none":
            tools, model_settings = [], ModelSettings()
        elif model_settings.tool_choice not in (None, "auto") and is_given(model_settings.tool_choice):
            model_settings = ModelSettings()
        resposta = sem_anuncio(Agent.default.llm_node(self, chat_ctx, tools, model_settings))
        async for chunk in com_espera(resposta, espera=ESPERA_DEPOIS_DA_CONTA if depois_da_conta else ESPERA):
            yield chunk

    @function_tool()
    async def orcar_persiana(self, context: RunContext, modelo: Modelo, largura: float, altura: float,
                             medida_do_vao: bool, quantidade: int = 1, tecido: str = "",
                             tipo_tecido: str = "", acabamento: str = "nenhum",
                             cor_ferragem: str = "BRANCA", incluir_instalacao: bool = True) -> str:
        """Calcula o orçamento de persiana pelo motor do Dash. largura e altura em metros (1.8).
        tecido: nome exato (de listar_tecidos) ou vazio para o mais barato do tipo_tecido.
        tipo_tecido: blackout, decorativo, tela_solar_1 ou tela_solar_3 (vazio = qualquer).
        acabamento: nenhum, bando_branco, bando_preto, barra ou kit_box. cor_ferragem: BRANCA ou PRETA."""
        FALAS.dizer(context.session, fala_calcular())
        r = await _chamar("/persiana", {
            "modelo": modelo, "largura": largura, "altura": altura, "medidaDoVao": medida_do_vao,
            "quantidade": quantidade, "tecido": _opcional(tecido, {tecido.strip()}, None),
            "tipoTecido": _opcional(tipo_tecido, TIPOS, None),
            "acabamento": _opcional(acabamento, ACABAMENTOS, "nenhum"),
            "corFerragem": _opcional((cor_ferragem or "").upper(), {"BRANCA", "PRETA"}, "BRANCA"),
            "incluirInstalacao": incluir_instalacao})
        return _resultado(r)

    @function_tool()
    async def orcar_cortina(self, context: RunContext, largura: float, altura: float, medida_do_vao: bool,
                            tecido: str, suporte: Literal["trilho_simples", "trilho_duplo", "varao_simples", "varao_duplo"],
                            modelo: Literal["wave", "pregas", "franzida"] = "wave", forro: str = "",
                            quantidade: int = 1, porta: bool = False) -> str:
        """Calcula a prévia de cortina pelo motor do Dash. tecido e forro: nomes de listar_tecidos sem modelo."""
        FALAS.dizer(context.session, fala_calcular())
        r = await _chamar("/cortina", {
            "largura": largura, "altura": altura, "medidaDoVao": medida_do_vao, "tecido": tecido,
            "suporte": suporte, "modelo": modelo, "forro": _opcional(forro, {forro.strip()}, None),
            "quantidade": quantidade,
            "porta": porta})
        return _resultado(r)

    @function_tool()
    async def listar_tecidos(self, context: RunContext, modelo: Modelo | None = None,
                             tipo_tecido: str = "") -> str:
        """Lista os tecidos de um modelo de persiana (opcionalmente de um tipo). Sem modelo, lista os
        tecidos e forros de cortina. Use quando perguntarem que tecidos tem ou para achar o nome exato."""
        tipo = _opcional(tipo_tecido, TIPOS, None)
        q = "" if modelo is None else f"?modelo={modelo}" + (f"&tipo={tipo}" if tipo else "")
        return json.dumps(await _chamar("/tecidos" + q), ensure_ascii=False)


def criar_sessao(turno=None) -> AgentSession:
    """Ouvir (Parakeet/Canary) e falar (Kokoro, voz J) na própria máquina; o turno é do VAD + detector.
    turno: outro detector de fim de fala (a simulação usa "vad": o detector precisa do job)."""
    return AgentSession(
        stt=openai.STT(model="parakeet", language="pt", base_url=URL_VOZ, api_key="local", use_realtime=False),
        llm=criar_llm(),
        tts=tts.StreamAdapter(
            tts=openai.TTS(model="kokoro", voice="amanda", base_url=URL_VOZ, api_key="local", response_format="wav"),
            sentence_tokenizer=TrechosCurtos()),
        vad=silero.VAD.load(),
        turn_detection=turno or MultilingualModel(),
        # o padrão espera 10 s por tentativa (no teste foram ~50 s mudos); com 5 s e a fala de espera
        # aos 3 s, ela nunca fica calada
        conn_options=SessionConnectOptions(llm_conn_options=APIConnectOptions(max_retry=2, retry_interval=0.3,
                                                                              timeout=5.0)),
    )


server = AgentServer()


@server.rtc_session(agent_name="sombrear-equipe")
async def conversar(ctx: agents.JobContext) -> None:
    session = criar_sessao()
    await session.start(room=ctx.room, agent=AmandaEquipe())
    Vigia(session)
    asyncio.create_task(FALAS.preparar(session.tts, [FALA_CALCULAR, FALA_CALCULAR_CURTA, FALA_ESPERA, FALA_REPETIR, FALA_ERRO]))
    # fala fixa: o Muse recusa pedido sem mensagem de usuário, e assim a voz sai na hora
    await session.say("Oi, aqui é a Amanda. Em que posso ajudar?")


if __name__ == "__main__":
    agents.cli.run_app(server)
