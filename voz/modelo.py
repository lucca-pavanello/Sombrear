"""O modelo que entende a conversa.

O Muse (Meta) é o mesmo do resto do Dash (supabase/functions/_shared/muse.ts). Chave do sistema, não a
do n8n: META_API_KEY_DASH em ~/.secrets/sombrear-meta.env, passada como META_API_KEY. O juiz dos
testes continua nele.

Na voz o padrão é o DeepSeek V4.1 Flash, sem raciocínio (escolha do Lucca em 19/10): com o prompt da
Amanda cliente o Muse levou ~2,1 s até a 1ª palavra e o DeepSeek ~1,1 s; nos 39 testes de acerto, o
DeepSeek errou 3, o GPT-5 mini 5 e os outros rápidos 9 a 14. LLM=muse volta ao Muse; LLM=<nome> de
OUTROS testa os outros. Chave em ~/.secrets/sombrear-voz.env (DEEPSEEK_API_KEY)."""

import os

from livekit.plugins import openai

MODELO_LLM = "muse-spark-1.3-contributor"
URL_MUSE = "https://api.meta.ai/v1"

GOOGLE = ("https://generativelanguage.googleapis.com/v1beta/openai/", "GEMINI_API_KEY")
OPENAI = ("https://api.openai.com/v1", "OPENAI_API_KEY")
DEEPSEEK = ("https://api.deepseek.com", "DEEPSEEK_API_KEY")
# LLM=<nome>: (modelo, (url, variável da chave), nível de raciocínio)
OUTROS = {
    "gemini": ("gemini-3.5-flash-lite", GOOGLE, "minimal"),
    "gemini-3.1-lite": ("gemini-3.1-flash-lite", GOOGLE, "minimal"),
    "gemini-3.8": ("gemini-3.8-flash", GOOGLE, "low"),
    "gpt": ("gpt-5-mini", OPENAI, "minimal"),
    "gpt-5.4-mini": ("gpt-5.4-mini", OPENAI, "none"),
    "gpt-5.4-nano": ("gpt-5.4-nano", OPENAI, "none"),
    "deepseek": ("deepseek-flash", DEEPSEEK, None),  # raciocínio desligado pelo extra_body
}


def criar_llm() -> openai.LLM:
    qual = os.environ.get("LLM", "deepseek")
    if qual in OUTROS:
        modelo, (url, chave), raciocinio = OUTROS[qual]
        if chave == "DEEPSEEK_API_KEY":
            return openai.LLM(model=modelo, base_url=url, api_key=os.environ[chave],
                              extra_body={"thinking": {"type": "disabled"}})
        return openai.LLM(model=modelo, base_url=url, api_key=os.environ[chave], reasoning_effort=raciocinio)
    return openai.LLM(model=MODELO_LLM, base_url=URL_MUSE, api_key=os.environ["META_API_KEY"],
                      reasoning_effort="minimal")
