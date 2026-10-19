"""Juiz próprio: o .judge() do LiveKit usa tool_choice nomeado, que o Muse recusa."""

import json
import os

from openai import AsyncOpenAI

from modelo import MODELO_LLM, URL_MUSE


async def julgar(result, intencao: str) -> None:
    """Juiz próprio: o .judge() do LiveKit usa tool_choice nomeado, que o Muse recusa.
    Julga tudo o que a Amanda falou no turno contra a intenção."""
    falas = [e.item.text_content for e in result.events
             if e.type == "message" and e.item.role == "assistant"]
    assert falas, "a Amanda não falou nada no turno"
    texto = "\n".join(f or "" for f in falas)
    cli = AsyncOpenAI(base_url=URL_MUSE, api_key=os.environ["META_API_KEY"])
    r = await cli.chat.completions.create(
        model=MODELO_LLM, reasoning_effort="minimal",
        messages=[{"role": "user", "content":
                   "Você avalia a fala de uma atendente de loja ao telefone.\n"
                   f"Fala:\n{texto}\n\nIntenção esperada: {intencao}\n\n"
                   'Responda só JSON: {"atende": true ou false, "porque": "uma frase"}'}])
    bruto = r.choices[0].message.content or ""
    veredito = json.loads(bruto[bruto.find("{"):bruto.rfind("}") + 1])
    assert veredito["atende"], f"{veredito['porque']}\nFala: {texto}"
