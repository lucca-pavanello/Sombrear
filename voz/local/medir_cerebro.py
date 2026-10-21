"""Compara os provedores do cérebro da voz com o prompt e as ferramentas reais da Amanda cliente.

Para cada provedor (nomes de modelo.OUTROS), manda as mesmas falas de cliente e mede o tempo até a
1ª palavra (ou até a ferramenta começar), quantos tokens do prompt vieram do cache e se veio
raciocínio (com raciocínio a 1ª palavra atrasa e o custo sobe). Se vier, tenta os outros jeitos de
desligar e diz qual funcionou, para pôr em modelo.OUTROS.

    PYTHONPATH=. uv run python local/medir_cerebro.py [deepseek-baseten deepseek ...] [--rodadas 3]
Sem nomes, mede todo DeepSeek cuja chave está no ~/.secrets/sombrear-voz.env.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import statistics
import time
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from livekit.agents import llm
from openai import AsyncOpenAI

from agenda import FUSO
from equipe import AmandaCliente, abertura, instrucoes_cliente
from modelo import OUTROS

load_dotenv(Path.home() / ".secrets" / "sombrear-voz.env")

TARDE = datetime(2026, 10, 20, 15, 0, tzinfo=FUSO)
# falas de cliente das conversas reais, curtas como chegam do telefone
FALAS = [
    "Oi, queria saber o preço de uma persiana.",
    "É pro quarto, e entra muito sol de manhã.",
    "A janela tem um metro e vinte de largura por um e quarenta de altura, medida do vão.",
    "Vocês instalam em Mirassol?",
]
# jeitos de desligar o raciocínio que os provedores aceitam, na ordem de tentativa
DESLIGAR = [
    {"thinking": {"type": "disabled"}},
    {"chat_template_kwargs": {"thinking": False}},
    {"reasoning_effort": "none"},
]


async def turno(cli: AsyncOpenAI, modelo: str, msgs: list[dict], ferramentas: list[dict],
                extra: dict) -> dict:
    t0 = time.perf_counter()
    primeiro = None
    raciocinio = 0
    texto = ""
    uso = None
    stream = await cli.chat.completions.create(model=modelo, messages=msgs, tools=ferramentas, stream=True,
                                               stream_options={"include_usage": True}, extra_body=extra)
    async for c in stream:
        if c.usage:
            uso = c.usage
        if not c.choices:
            continue
        d = c.choices[0].delta
        r = getattr(d, "reasoning_content", None) or getattr(d, "reasoning", None)
        if r:
            raciocinio += len(r)
        if (d.content or d.tool_calls) and primeiro is None:
            primeiro = time.perf_counter() - t0
        texto += d.content or ""
    cache = getattr(getattr(uso, "prompt_tokens_details", None), "cached_tokens", None) if uso else None
    return {"primeiro": primeiro, "raciocinio": raciocinio, "texto": texto.strip(),
            "prompt": getattr(uso, "prompt_tokens", None), "cache": cache}


async def medir(nome: str, rodadas: int, ferramentas: list[dict]) -> None:
    modelo, (url, chave), raciocinio = OUTROS[nome]
    if not os.environ.get(chave):
        print(f"{nome}: sem {chave} no ~/.secrets/sombrear-voz.env, pulei")
        return
    cli = AsyncOpenAI(base_url=url, api_key=os.environ[chave], timeout=30)
    try:  # confere o nome do modelo no catálogo do provedor
        ids = [m.id async for m in cli.models.list()]
        achados = [i for i in ids if "v4.1-flash" in i.lower()]
        if modelo not in ids and achados:
            print(f"{nome}: o catálogo chama o modelo de {achados}; usando {achados[0]}")
            modelo = achados[0]
    except Exception as e:  # noqa: BLE001 (nem todo provedor lista)
        print(f"{nome}: sem catálogo ({type(e).__name__})")

    jeitos = [raciocinio] if isinstance(raciocinio, dict) else [{"reasoning_effort": raciocinio}]
    jeitos += [j for j in DESLIGAR if j not in jeitos]
    for extra in jeitos:
        tempos, cache, pensou, erro = [], [], 0, None
        for _ in range(rodadas):
            msgs = [{"role": "system", "content": instrucoes_cliente(TARDE, linha_conhecida=True)},
                    {"role": "assistant", "content": abertura(TARDE)}]
            for fala in FALAS:
                msgs.append({"role": "user", "content": fala})
                try:
                    r = await turno(cli, modelo, msgs, ferramentas, extra)
                except Exception as e:  # noqa: BLE001
                    erro = f"{type(e).__name__}: {str(e)[:160]}"
                    break
                if r["primeiro"] is not None:
                    tempos.append(r["primeiro"])
                if r["prompt"] and r["cache"] is not None:
                    cache.append(f"{r['cache']}/{r['prompt']}")
                pensou += r["raciocinio"]
                msgs.append({"role": "assistant", "content": r["texto"] or "Certo."})
            if erro:
                break
        if erro:
            print(f"{nome} {extra}: erro {erro}")
            continue
        q = sorted(tempos)
        print(f"{nome} {extra}: 1ª palavra mediana {statistics.median(q):.2f} s, "
              f"melhor {q[0]:.2f}, pior {q[-1]:.2f} ({len(q)} turnos); "
              f"raciocínio {pensou} caracteres; cache {cache[-1] if cache else 'não informado'}")
        if pensou == 0:
            break  # esse jeito desliga o raciocínio: não precisa tentar os outros


async def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("nomes", nargs="*")
    p.add_argument("--rodadas", type=int, default=3)
    a = p.parse_args()
    nomes = a.nomes or [n for n, (_, (_, chave), _) in OUTROS.items()
                        if n.startswith("deepseek") and os.environ.get(chave)]
    ferramentas = llm.ToolContext(AmandaCliente(TARDE).tools).parse_function_tools("openai")
    for nome in nomes:
        await medir(nome, a.rodadas, ferramentas)


if __name__ == "__main__":
    asyncio.run(main())
