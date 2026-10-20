"""O que a Amanda de voz manda ao Dash quando a ligação termina (ligacao.py), contra um servidor
de mentira na própria máquina: nada aqui toca o Supabase nem o WhatsApp. Não gasta modelo."""

from __future__ import annotations

import json
from datetime import datetime

from aiohttp import web

from agenda import FUSO
from ligacao import Ligacao, enviar

INICIO = datetime(2026, 10, 20, 15, 0, tzinfo=FUSO)
CONTA = {"ok": True, "tecido": "BK Branco", "largura": 2.0, "altura": 2.0, "total4x": 931.0,
         "totalAvista": 884.45, "instalacao": 85.0, "maisBarato": True, "observacoes": []}


async def _servidor(respostas: list[tuple[int, dict]]):
    """Sobe um registrar-ligacao falso; devolve (url, pedidos recebidos, como parar)."""
    pedidos: list[dict] = []

    async def receber(req: web.Request) -> web.Response:
        pedidos.append({"chave": req.headers.get("x-chave"), "corpo": await req.json()})
        status, corpo = respostas[min(len(pedidos), len(respostas)) - 1]
        return web.json_response(corpo, status=status)

    app = web.Application()
    app.router.add_post("/", receber)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    porta = site._server.sockets[0].getsockname()[1]
    return f"http://127.0.0.1:{porta}/", pedidos, runner.cleanup


def _ligacao() -> Ligacao:
    lig = Ligacao(inicio=INICIO, telefone_linha="+5517998765432")
    lig.ouvir("assistant", "Boa tarde, Amanda da Sombrear Decor aqui. Como posso te ajudar?")
    lig.ouvir("user", "Quanto fica uma rolô de dois por dois?")
    lig.orcou(CONTA, "Rolo", 1)
    lig.anotar(" Juliana Prado ", "17998765432", "orcamento", " Rolô blackout 2 x 2. ", [" sala ", ""])
    return lig


def test_junta_a_conversa_o_contato_e_o_orcamento() -> None:
    lig = _ligacao()
    lig.ouvir("user", "   ")  # silêncio e ruído não entram
    lig.ouvir("system", "x")
    c = lig.corpo()
    assert c["ref"].startswith("voz-") and c["inicio"].startswith("2026-10-20T15:00")
    assert [f["quem"] for f in c["transcricao"]] == ["amanda", "cliente"]
    assert c["nome"] == "Juliana Prado" and c["telefone"] == "17998765432" and c["resumo"] == "Rolô blackout 2 x 2." and c["ambientes"] == ["sala"]
    assert c["telefone_chamador"] == "+5517998765432"
    assert c["orcamento"] == {"modelo": "Rolo", "tecido": "BK Branco", "largura": 2.0, "altura": 2.0, "quantidade": 1,
                              "total4x": 931.0, "totalAvista": 884.45, "instalacao": 85.0, "maisBarato": True}


def test_conta_que_falhou_nao_apaga_a_ultima_que_deu_certo() -> None:
    lig = _ligacao()
    lig.orcou({"ok": False, "erro": "tecido não existe"}, "Rolo", 1)
    assert lig.orcamento["tecido"] == "BK Branco"


async def test_manda_ao_dash_com_a_chave() -> None:
    url, pedidos, parar = await _servidor([(200, {"status": "enviado", "lead_id": "x"})])
    try:
        assert await enviar(_ligacao(), url=url, chave="segredo-de-teste") == "enviado"
    finally:
        await parar()
    assert len(pedidos) == 1
    assert pedidos[0]["chave"] == "segredo-de-teste"
    assert pedidos[0]["corpo"]["nome"] == "Juliana Prado"


async def test_dash_fora_do_ar_tenta_de_novo_com_o_mesmo_ref(tmp_path) -> None:
    url, pedidos, parar = await _servidor([(500, {"erro": "x"}), (200, {"status": "enviado"})])
    try:
        assert await enviar(_ligacao(), url=url, chave="k", recados=tmp_path / "r.jsonl", espera=0) == "enviado"
    finally:
        await parar()
    assert len(pedidos) == 2 and pedidos[0]["corpo"]["ref"] == pedidos[1]["corpo"]["ref"]
    assert not (tmp_path / "r.jsonl").exists()


async def test_falhou_de_vez_guarda_no_arquivo_para_reenviar(tmp_path) -> None:
    url, pedidos, parar = await _servidor([(500, {"erro": "x"})])
    try:
        assert await enviar(_ligacao(), url=url, chave="k", recados=tmp_path / "r.jsonl", espera=0) == "falhou"
    finally:
        await parar()
    assert len(pedidos) == 3
    salvo = json.loads((tmp_path / "r.jsonl").read_text(encoding="utf-8"))
    assert salvo["nome"] == "Juliana Prado"


async def test_chave_errada_nao_fica_repetindo(tmp_path) -> None:
    url, pedidos, parar = await _servidor([(401, {"erro": "não autorizado"})])
    try:
        assert await enviar(_ligacao(), url=url, chave="errada", recados=tmp_path / "r.jsonl", espera=0) == "falhou"
    finally:
        await parar()
    assert len(pedidos) == 1


async def test_dash_inalcancavel_nao_quebra(tmp_path) -> None:
    r = await enviar(_ligacao(), url="http://127.0.0.1:1/", chave="k", recados=tmp_path / "r.jsonl", espera=0)
    assert r == "falhou" and (tmp_path / "r.jsonl").exists()


async def test_sem_url_grava_no_arquivo(tmp_path) -> None:
    assert await enviar(_ligacao(), url="", recados=tmp_path / "r.jsonl") == "arquivo"
    assert json.loads((tmp_path / "r.jsonl").read_text(encoding="utf-8"))["telefone"] == "17998765432"


async def test_cliente_desligou_sem_falar_nao_manda_nada(tmp_path) -> None:
    lig = Ligacao(inicio=INICIO, telefone_linha="+5517998765432")
    lig.ouvir("assistant", "Boa tarde, Amanda da Sombrear Decor aqui.")
    assert await enviar(lig, url="http://127.0.0.1:1/", recados=tmp_path / "r.jsonl") == "nada"
    assert not (tmp_path / "r.jsonl").exists()


async def test_numero_de_mentira_do_console_nao_vira_telefone() -> None:
    """No console a sala é falsa e o atributo da linha vem como MagicMock: não pode virar o
    telefone da ligação (20/10: quebrava o anotar_contato e o envio ao Dash)."""
    from unittest.mock import MagicMock
    from equipe import AmandaCliente
    agente = AmandaCliente(INICIO)
    await agente.conhecer_linha(MagicMock())
    await agente.conhecer_linha("123")
    assert agente.ligacao.telefone_linha is None
    json.dumps(agente.ligacao.corpo())  # o corpo continua serializável


def test_salva_a_conversa_de_teste(tmp_path, monkeypatch) -> None:
    import equipe
    monkeypatch.setattr(equipe, "CONVERSAS", tmp_path)
    arq = equipe.salvar_conversa(_ligacao())
    texto = arq.read_text(encoding="utf-8")
    assert "Amanda: Boa tarde, Amanda da Sombrear Decor aqui." in texto
    assert "Cliente: Quanto fica uma rolô de dois por dois?" in texto
    assert "Juliana Prado" in texto


async def test_desligar_acontece_uma_vez_so() -> None:
    from equipe import AmandaCliente
    agente = AmandaCliente(INICIO)
    chamadas = []

    async def ao_desligar() -> None:
        chamadas.append(1)

    agente._ao_desligar = ao_desligar
    await agente.desligar("cliente_despediu")
    await agente.desligar("silencio")
    assert chamadas == [1]
    assert agente.ligacao.encerramento == "cliente_despediu"


def test_nao_encerra_com_pergunta_do_cliente_no_ar() -> None:
    from livekit.agents import llm as lk_llm
    from equipe import AmandaCliente
    ctx = lk_llm.ChatContext()
    ctx.add_message(role="user", content="Vocês instalam em Mirassol também?")
    assert AmandaCliente(INICIO, chat_ctx=ctx)._cliente_perguntou()
    ctx2 = lk_llm.ChatContext()
    ctx2.add_message(role="user", content="Tá bom, obrigado. Tchau!")
    assert not AmandaCliente(INICIO, chat_ctx=ctx2)._cliente_perguntou()


def test_reconhece_so_despedida() -> None:
    from equipe import e_despedida
    for t in ["Obrigado, tchau!", "Tá bom, obrigada.", "Valeu, até mais", "Beleza, combinado.", "Tchau tchau"]:
        assert e_despedida(t), t
    for t in ["Ah, espera, e a instalação?", "Obrigado, mas quanto fica?", "Não, peraí", "Esqueci de falar uma coisa",
              "", "Quero também pro quarto"]:
        assert not e_despedida(t), t


class _Msg:
    def __init__(self, texto: str) -> None:
        self.text_content = texto


async def test_depois_da_despedida_espera_o_tchau_e_desliga(monkeypatch) -> None:
    import asyncio

    import equipe
    from livekit.agents import StopResponse
    monkeypatch.setattr(equipe, "ESPERA_TCHAU", 0.05)
    agente = equipe.AmandaCliente(INICIO)
    agente._despedir("atendimento_concluido", 10)  # despediu; sem resposta, cairia em 10 s
    assert agente.ligacao.encerramento is None
    try:
        await agente.on_user_turn_completed(None, _Msg("Obrigado, tchau!"))
        raise AssertionError("respondeu ao tchau")
    except StopResponse:
        pass
    assert agente.ligacao.encerramento is None  # ainda não: dá uns segundos
    await asyncio.sleep(0.2)
    assert agente.ligacao.encerramento == "atendimento_concluido"
    assert agente.ligacao.falas[-1] == {"quem": "cliente", "texto": "Obrigado, tchau!"} or \
        agente.ligacao.falas[-1]["texto"] == "Obrigado, tchau!"


async def test_assunto_novo_depois_da_despedida_continua_a_ligacao(monkeypatch) -> None:
    import asyncio

    import equipe
    monkeypatch.setattr(equipe, "REACAO", False)
    agente = equipe.AmandaCliente(INICIO)
    agente._despedir("atendimento_concluido", 0.05)
    await agente.on_user_turn_completed(None, _Msg("Ah, espera, vocês instalam em Mirassol?"))
    await asyncio.sleep(0.2)
    assert agente.ligacao.encerramento is None and agente.motivo_saida is None
