"""Ouvir e falar na própria máquina, no formato da API da OpenAI (o caminho que a documentação do
LiveKit indica para o Kokoro). Fase 2 do PLANO.md.

    POST /v1/audio/speech          {"input": "...", "voice": "amanda"}  -> wav (Kokoro, voz J)
    POST /v1/audio/transcriptions  multipart "file" (wav)               -> {"text": "..."} (Parakeet/Canary)

    uv run --group local python local/servidor_voz.py
Variáveis: KOKORO_DIR (pasta com kokoro-v1.0.onnx e voices-v1.0.bin), PORTA_VOZ (padrão 8792).

Ouvir é o Parakeet TDT 0.6b v3 (NVIDIA, aberto, tem português), int8 na CPU: medido em 17/10/2026 no
Ryzen 5 1600, 0,3 a 0,85 s por pergunta e acertou "1,80 por 1,20"; o Whisper small levou 5,5 a 7 s
(sempre codifica 30 s de áudio) e o base errou as medidas.

Fala curta (menos de CURTA s) vai para o Canary 1b v2 com português fixo: o Parakeet adivinha o
idioma e, em palavra solta, escorrega para o inglês ("Não" virou "NOT"); o Canary leva ~0,4 s em
fala curta, mas 2,5 s em frase longa, por isso só nela. As duas ganham MARGEM s de silêncio nas
pontas: sem isso um "pode" curto chegou a voltar vazio no teste de 17/10.
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
import re
import time

import numpy as np
import onnx_asr
import soundfile as sf
from aiohttp import web
from kokoro_onnx import Kokoro

log = logging.getLogger("voz-local")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

# Voz "J" escolhida às cegas pelo Lucca em 17/10/2026
MISTURA_J = {"pf_dora": 0.5, "if_sara": 0.25, "pm_alex": 0.25}
# Como a loja fala; o Kokoro lia "Decor" com o "o" fechado
PRONUNCIA = {r"\bDecor\b": "Decór"}

kokoro = Kokoro(os.path.join(os.environ["KOKORO_DIR"], "kokoro-v1.0.onnx"),
                os.path.join(os.environ["KOKORO_DIR"], "voices-v1.0.bin"))
VOZES = {"amanda": sum(p * kokoro.get_voice_style(v) for v, p in MISTURA_J.items()).astype(np.float32)}
parakeet = onnx_asr.load_model("nemo-parakeet-tdt-0.6b-v3", quantization="int8")
canary = onnx_asr.load_model("nemo-canary-1b-v2", quantization="int8")
CURTA = 1.5
MARGEM = np.zeros(int(0.3 * 16000), np.float32)


def ajustar_pronuncia(texto: str) -> str:
    for padrao, troca in PRONUNCIA.items():
        texto = re.sub(padrao, troca, texto, flags=re.IGNORECASE)
    return texto


def falar(texto: str, voz: str) -> bytes:
    t = time.perf_counter()
    estilo = VOZES.get(voz, VOZES["amanda"])
    audio, sr = kokoro.create(ajustar_pronuncia(texto), voice=estilo, lang="pt-br")
    buf = io.BytesIO()
    sf.write(buf, audio, sr, format="WAV", subtype="PCM_16")
    log.info("falar %.2fs para %.2fs de áudio: %s", time.perf_counter() - t, len(audio) / sr, texto[:60])
    return buf.getvalue()


def para_16k(wav: bytes) -> np.ndarray:
    """WAV de qualquer taxa (telefone vem em 8 kHz) para mono 16 kHz."""
    audio, sr = sf.read(io.BytesIO(wav), dtype="float32", always_2d=True)
    audio = audio.mean(axis=1)
    if sr != 16000:
        n = int(len(audio) * 16000 / sr)
        audio = np.interp(np.linspace(0, len(audio) - 1, n), np.arange(len(audio)), audio).astype(np.float32)
    return audio


def ouvir(wav: bytes) -> str:
    t = time.perf_counter()
    audio = para_16k(wav)
    curta = len(audio) < CURTA * 16000
    audio = np.concatenate([MARGEM, audio, MARGEM])
    if curta:
        texto = canary.recognize(audio, sample_rate=16000, language="pt").strip()
    else:
        texto = parakeet.recognize(audio, sample_rate=16000).strip()
    log.info("ouvir %.2fs (%s): %s", time.perf_counter() - t, "canary" if curta else "parakeet", texto[:80])
    return texto


async def speech(req: web.Request) -> web.Response:
    corpo = await req.json()
    wav = await asyncio.to_thread(falar, corpo.get("input", ""), corpo.get("voice", "amanda"))
    return web.Response(body=wav, content_type="audio/wav")


async def transcriptions(req: web.Request) -> web.Response:
    form = await req.post()
    arquivo = form.get("file")
    if arquivo is None:
        return web.json_response({"error": "falta o arquivo"}, status=400)
    texto = await asyncio.to_thread(ouvir, arquivo.file.read())
    return web.json_response({"text": texto})


app = web.Application(client_max_size=20 * 1024 * 1024)
app.add_routes([web.post("/v1/audio/speech", speech), web.post("/v1/audio/transcriptions", transcriptions)])

if __name__ == "__main__":
    web.run_app(app, host="127.0.0.1", port=int(os.environ.get("PORTA_VOZ", "8792")))
