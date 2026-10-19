"""Reação curta na hora em que o cliente termina de falar, antes de o modelo responder.

O DeepSeek leva ~1 s até a 1ª palavra (medido em 19/10); uma reação pronta ("Certo.") sai do cache
na hora e tapa esse buraco. A escolha é por regra sobre o texto final da transcrição, sem modelo:
na dúvida, nada. Pedido do Lucca em 19/10:

- dado (medida, nome, número, modelo, "sim" com dado)  -> "Certo." / "Anotado." / "Beleza."
- pediu preço ou orçamento                              -> "Deixa eu ver."
- problema (entrega, instalação, assistência, defeito)  -> "Entendi." / "Poxa, entendi."
- sim                                                   -> "Tá joia." / "Combinado."
- cumprimento, "não", pergunta aberta, fala curta ou ambígua -> nada

"Vou calcular aqui." ficou de fora do grupo do preço: quando falta dado o modelo pergunta a medida
em vez de calcular, e a calculadora já anuncia a conta sozinha (sem_silencio.FALA_CALCULAR).

Como o modelo não sabe da reação (mexer no contexto anularia a resposta que ele já começou a gerar
antes do turno fechar), sem_reacao tira a reação do começo da resposta dele: nunca "Certo. Certo, ...".
"""

from __future__ import annotations

import random
import re
import time
import unicodedata
from collections.abc import AsyncIterable, AsyncIterator

DADO = ["Certo.", "Anotado.", "Beleza."]
PRECO = ["Deixa eu ver.", "Deixa eu ver aqui."]
PROBLEMA = ["Entendi.", "Certo, entendi."]
PROBLEMA_RUIM = ["Poxa, entendi.", "Entendi."]
SIM = ["Tá joia.", "Combinado."]
GRUPOS = {"dado": DADO, "preco": PRECO, "problema": PROBLEMA, "problema_ruim": PROBLEMA_RUIM, "sim": SIM}
TODAS = [f for fs in GRUPOS.values() for f in fs]


def _norm(texto: str) -> str:
    t = unicodedata.normalize("NFD", texto.lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s?]", " ", t)).strip()


def _tem(t: str, padrao: str) -> bool:
    return re.search(padrao, t) is not None


CUMPRIMENTO = r"^(oi|ola|alo|opa|bom dia|boa tarde|boa noite|e ai|tudo bem)\b"
NEGATIVO = (r"\b(defeito|quebr\w*|estrag\w*|reclama\w*|atrasad\w*|atraso|atrasou|nao chegou|nao veio|"
            r"nao funciona\w*|nao fecha|nao abre|nao sobe|nao desce|caiu|soltou|solta|torto|torta)\b")
PROBLEMA_RE = r"\b(entrega\w*|instalaram|instalacao marcada|assistencia|conserto|consertar|garantia|meu pedido|comprei|problema)\b"
PRECO_RE = r"\b(preco|orcamento|valor|quanto (fica|custa|sai|e|seria|ficaria|da))\b"
SIM_SO = {"sim", "isso", "isso mesmo", "pode", "pode ser", "exato", "exatamente", "claro", "certo", "certinho",
          "e isso", "sim sim", "isso ai", "positivo", "ok", "beleza", "ta", "ta bom", "ta certo", "uhum", "aham",
          "pode mandar", "pode sim", "quero", "quero sim", "sim pode", "sim pode mandar"}
NUMEROS = (r"\b(\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|"
           r"catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|"
           r"setenta|oitenta|noventa|cem|meio|meia)\b")
MEDIDA = r"\b(metros?|centimetros?|cm|largura|altura|por)\b"
PRODUTO = (r"\b(rolo|romana|double|vertical|horizontal|blackout|black out|tela solar|decorativ\w*|vao|"
           r"da persiana|da janela|cortina|wave|pregas|trilho|varao|motorizad\w*|bando)\b")
NOME = r"\b(meu nome|me chamo|nome e)\b"
NOME_LIGA = {"da", "de", "do", "das", "dos", "e"}
SAUDACOES = {"Oi", "Olá", "Alô", "Bom", "Boa", "Opa", "Tudo"}


def _parece_nome(texto: str) -> bool:
    """"Carlos Henrique da Silva.": 2 a 6 palavras, todas com maiúscula (menos da/de/dos)."""
    palavras = re.findall(r"[\wÀ-ÿ]+", texto)
    if not 2 <= len(palavras) <= 6 or palavras[0] in SAUDACOES:
        return False
    return all(p[0].isupper() or p.lower() in NOME_LIGA for p in palavras) and sum(p[0].isupper() for p in palavras) >= 2


def grupo(texto: str) -> str | None:
    """O grupo da reação para a fala final do cliente, ou None (na dúvida, nada)."""
    t = _norm(texto)
    if not t:
        return None
    if _tem(t, CUMPRIMENTO):
        return None
    if _tem(t, NEGATIVO):
        return "problema_ruim"
    if _tem(t, PROBLEMA_RE):
        return "problema"
    if _tem(t, PRECO_RE):
        return "preco"
    if t in SIM_SO:
        return "sim"
    numeros = len(re.findall(NUMEROS, t))
    if (numeros >= 2 and _tem(t, MEDIDA)) or len(re.findall(r"\d", t)) >= 8 or numeros >= 7:
        return "dado"  # medida ou telefone, mesmo com o "?" que a transcrição às vezes põe
    if "?" in t:  # pergunta aberta: espera o modelo
        return None
    if _tem(t, r"\b(nesse numero|esse numero|mesmo numero|deste numero|desse numero)\b"):
        return "dado"  # "sim" com dado: pode ser no número que ligou
    if _tem(t, NOME) or _parece_nome(texto):
        return "dado"
    if _tem(t, PRODUTO) and len(t.split()) <= 8:
        return "dado"  # "É de rolo, blackout.", "A medida é do vão."
    if len(t.split()) <= 6 and (_tem(t, r"^(sim|pode|isso|quero|claro)") or t.endswith(" sim")):
        return "sim"  # "Pode mandar no WhatsApp sim."
    return None


class Reacoes:
    """Escolhe a frase do grupo sem repetir a anterior nem a que o modelo usou por último."""

    def __init__(self, sorteio: random.Random | None = None) -> None:
        self._sorteio = sorteio or random.Random()
        self.ultima: str | None = None
        self.grupo: str | None = None
        self.quando = 0.0

    def escolher(self, texto: str, fala_anterior: str = "") -> str | None:
        g = grupo(texto)
        self.grupo, self.quando = g, time.time()
        if g is None:
            return None
        anterior = _norm(fala_anterior)
        opcoes = [f for f in GRUPOS[g] if f != self.ultima and not anterior.startswith(_norm(f))]
        frase = self._sorteio.choice(opcoes or [f for f in GRUPOS[g] if f != self.ultima] or GRUPOS[g])
        self.ultima = frase
        return frase

    def pediu_preco_agora(self, janela: float = 15.0) -> bool:
        """A reação do turno foi "Deixa eu ver.": a calculadora não anuncia a conta de novo."""
        return self.grupo == "preco" and time.time() - self.quando < janela


# reação que o modelo costuma pôr no começo; sai quando a reação rápida já falou
_INICIO = re.compile(
    r"^\s*(?:(?:certo|beleza|anotad[oa]|entendi|entendido|poxa|ta joia|ta certo|ta bom|ta|combinado|deixa eu ver(?: aqui)?|"
    r"perfeito|otimo|ok|okay|ah,? legal|legal|claro|show|joia|hum|ah|uhum|tranquilo|maravilha)"
    r"\s*[.,!]+\s*)+", re.IGNORECASE)


def _sem_acento(texto: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn")


def tirar_reacao(texto: str) -> str:
    """"Certo, rolô blackout." -> "Rolô blackout.". Compara sem acento ("Tá joia" = "ta joia")."""
    texto = unicodedata.normalize("NFC", texto)
    m = _INICIO.match(_sem_acento(texto))
    if not m:
        return texto
    resto = texto[m.end():]  # sem acento tem o mesmo tamanho (NFD só tira as marcas de texto já composto)
    return resto[:1].upper() + resto[1:] if resto else ""


def _texto(c) -> str:
    if isinstance(c, str):
        return c
    d = getattr(c, "delta", None)
    return (d.content or "") if d is not None else ""


def _com_texto(c, novo: str):
    if isinstance(c, str):
        return novo
    c.delta.content = novo
    return c


FIM_DO_INICIO = re.compile(r"[.!?,]\s|\w{3,}\s+\w+\s+\w+")  # passou da reação: já dá para decidir


async def sem_reacao(chunks: AsyncIterable) -> AsyncIterator:
    """Segura só o começo da resposta até dar para ver se ela começa com reação e tira a reação."""
    segurados: list = []
    texto = ""
    soltou = False
    async for c in chunks:
        if soltou:
            yield c
            continue
        t = _texto(c)
        if not t and not segurados:
            yield c  # chamada de ferramenta, fim, etc.: nada a tirar
            continue
        segurados.append(c)
        texto += t
        if FIM_DO_INICIO.search(_sem_acento(texto)) and not _INICIO.fullmatch(_sem_acento(texto) + " "):
            soltou = True
            yield from_segurados(segurados, texto)
            for s in segurados[1:]:
                if not _texto(s):
                    yield s
    if not soltou and segurados:
        yield from_segurados(segurados, texto)


def from_segurados(segurados: list, texto: str):
    """Um pedaço só com o texto já sem a reação, no formato do primeiro."""
    return _com_texto(segurados[0], tirar_reacao(texto))
