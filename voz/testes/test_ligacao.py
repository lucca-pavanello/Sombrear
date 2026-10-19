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
    lig.anotar(" Juliana Prado ", "17998765432", "orcamento", " Rolô blackout 2 x 2. ")
    return lig


def test_junta_a_conversa_o_contato_e_o_orcamento() -> None:
    lig = _ligacao()
    lig.ouvir("user", "   ")  # silêncio e ruído não entram
    lig.ouvir("system", "x")
    c = lig.corpo()
    assert c["ref"].startswith("voz-") and c["inicio"].startswith("2026-10-20T15:00")
    assert [f["quem"] for f in c["transcricao"]] == ["amanda", "cliente"]
    assert c["nome"] == "Juliana Prado" and c["telefone"] == "17998765432" and c["resumo"] == "Rolô blackout 2 x 2."
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
