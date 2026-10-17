"""O modelo que entende a conversa: Muse (Meta), o mesmo do resto do Dash
(supabase/functions/_shared/muse.ts). Chave do sistema, não a do n8n: META_API_KEY_DASH em
~/.secrets/sombrear-meta.env, passada como META_API_KEY."""

import os

from livekit.plugins import openai

MODELO_LLM = "muse-spark-1.3-contributor"
URL_MUSE = "https://api.meta.ai/v1"


def criar_llm() -> openai.LLM:
    return openai.LLM(model=MODELO_LLM, base_url=URL_MUSE, api_key=os.environ["META_API_KEY"],
                      reasoning_effort="minimal")
