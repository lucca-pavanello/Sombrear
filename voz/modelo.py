"""O modelo que entende a conversa.

O Muse (Meta) é o mesmo do resto do Dash (supabase/functions/_shared/muse.ts). Chave do sistema, não a
do n8n: META_API_KEY_DASH em ~/.secrets/sombrear-meta.env, passada como META_API_KEY. O juiz dos
testes continua nele.

Na voz o cérebro é o DeepSeek V4.1 Flash, sem raciocínio (escolha do Lucca em 19/10): com o prompt da
Amanda cliente o Muse levou ~2,1 s até a 1ª palavra e o DeepSeek ~1,1 s; nos 39 testes de acerto, o
DeepSeek errou 3, o GPT-5 mini 5 e os outros rápidos 9 a 14.

Sem passar pela China (Lucca, 21/10: nome e telefone do cliente não podem ir para servidor chinês):
o modelo é aberto, então o mesmo DeepSeek roda em provedor dos EUA (deepseek-baseten,
deepseek-together, deepseek-deepinfra). LLM=deepseek é a API oficial, na China, só para comparar.
local/medir_cerebro.py mede o tempo até a 1ª palavra de cada um com o prompt real e confere que não
veio raciocínio. Chaves em ~/.secrets/sombrear-voz.env."""

import os

from livekit.plugins import openai

MODELO_LLM = "muse-spark-1.3-contributor"
URL_MUSE = "https://api.meta.ai/v1"

GOOGLE = ("https://generativelanguage.googleapis.com/v1beta/openai/", "GEMINI_API_KEY")
OPENAI = ("https://api.openai.com/v1", "OPENAI_API_KEY")
DEEPSEEK = ("https://api.deepseek.com", "DEEPSEEK_API_KEY")
BASETEN = ("https://inference.baseten.co/v1", "BASETEN_API_KEY")
TOGETHER = ("https://api.together.xyz/v1", "TOGETHER_API_KEY")
DEEPINFRA = ("https://api.deepinfra.com/v1/openai", "DEEPINFRA_API_KEY")
DEEPSEEK_ABERTO = "deepseek-ai/DeepSeek-V4.1-Flash"
# cada provedor desliga o raciocínio de um jeito; o da API oficial é o "thinking" abaixo
SEM_RACIOCINIO = {"thinking": {"type": "disabled"}}

# LLM=<nome>: (modelo, (url, variável da chave), nível de raciocínio ou extra_body)
OUTROS = {
    "gemini": ("gemini-3.5-flash-lite", GOOGLE, "minimal"),
    "gemini-3.1-lite": ("gemini-3.1-flash-lite", GOOGLE, "minimal"),
    "gemini-3.8": ("gemini-3.8-flash", GOOGLE, "low"),
    "gpt": ("gpt-5-mini", OPENAI, "minimal"),
    "gpt-5.4-mini": ("gpt-5.4-mini", OPENAI, "none"),
    "gpt-5.4-nano": ("gpt-5.4-nano", OPENAI, "none"),
    "deepseek": ("deepseek-flash", DEEPSEEK, SEM_RACIOCINIO),
    "deepseek-baseten": (DEEPSEEK_ABERTO, BASETEN, SEM_RACIOCINIO),
    "deepseek-together": (DEEPSEEK_ABERTO, TOGETHER, SEM_RACIOCINIO),
    "deepseek-deepinfra": (DEEPSEEK_ABERTO, DEEPINFRA, SEM_RACIOCINIO),
}


def criar_llm() -> openai.LLM:
    qual = os.environ.get("LLM", "deepseek")
    if qual in OUTROS:
        modelo, (url, chave), raciocinio = OUTROS[qual]
        if isinstance(raciocinio, dict):
            return openai.LLM(model=modelo, base_url=url, api_key=os.environ[chave], extra_body=raciocinio)
        return openai.LLM(model=modelo, base_url=url, api_key=os.environ[chave], reasoning_effort=raciocinio)
    return openai.LLM(model=MODELO_LLM, base_url=URL_MUSE, api_key=os.environ["META_API_KEY"],
                      reasoning_effort="minimal")
