"""Lista vozes femininas em português das vozes pagas, para escolher o VOZ_ID do teste às cegas.

    VOZ=elevenlabs uv run --group local python local/listar_vozes.py   # precisa de ELEVEN_API_KEY
    VOZ=cartesia   uv run --group local python local/listar_vozes.py   # precisa de CARTESIA_API_KEY
"""

from __future__ import annotations

import json
import os
import urllib.request


def pegar(url: str, cabecalhos: dict) -> dict | list:
    with urllib.request.urlopen(urllib.request.Request(url, headers=cabecalhos), timeout=20) as r:
        return json.loads(r.read())


if os.environ.get("VOZ") == "cartesia":
    vozes = pegar("https://api.cartesia.ai/voices?language=pt&gender=feminine&limit=50",
                  {"X-API-Key": os.environ["CARTESIA_API_KEY"], "Cartesia-Version": "2025-04-16"})
    for v in vozes.get("data", vozes) if isinstance(vozes, dict) else vozes:
        print(v["id"], "|", v.get("name"), "|", (v.get("description") or "")[:80])
else:
    vozes = pegar("https://api.elevenlabs.io/v1/shared-voices?language=pt&gender=female&page_size=30",
                  {"xi-api-key": os.environ["ELEVEN_API_KEY"]})
    for v in vozes.get("voices", []):
        print(v["voice_id"], "|", v.get("name"), "|", v.get("accent"), "|", (v.get("description") or "")[:70])
