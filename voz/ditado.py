"""Telefone ditado aos pedaços.

Cliente de verdade dita devagar: "dezessete... nove, nove... um dois três...". Cada pausa fecha um
turno, e ela respondia a cada pedaço ("Preciso do", "Fala o", "Pode falar de uma vez"): simulação de
21/10. Enquanto ela está esperando o telefone e o cliente só fala número, a Amanda fica quieta e junta
os pedaços até ter o número inteiro (10 ou 11 dígitos); se ele parar no meio, ela responde depois de
ESPERA_DITADO segundos com o que juntou.
"""

from __future__ import annotations

import re
import unicodedata

UNIDADES = {"zero": 0, "um": 1, "uma": 1, "dois": 2, "duas": 2, "tres": 3, "quatro": 4, "cinco": 5,
            "seis": 6, "meia": 6, "sete": 7, "oito": 8, "nove": 9}
DEZ_A_DEZENOVE = {"dez": 10, "onze": 11, "doze": 12, "treze": 13, "catorze": 14, "quatorze": 14,
                  "quinze": 15, "dezesseis": 16, "dezasseis": 16, "dezessete": 17, "dezassete": 17,
                  "dezoito": 18, "dezenove": 19, "dezanove": 19}
DEZENAS = {"vinte": 20, "trinta": 30, "quarenta": 40, "cinquenta": 50, "sessenta": 60, "setenta": 70,
           "oitenta": 80, "noventa": 90}
# o que pode vir no meio do ditado sem ser outro assunto
ENCHIMENTO = {"e", "o", "a", "meu", "minha", "telefone", "numero", "celular", "whatsapp", "ddd", "fica",
              "isso", "ta", "entao", "eh", "do", "de", "final", "comeco", "com", "ai",
              # correção no meio do ditado: "não, espera, o final é dois dois três quatro"
              "nao", "espera", "pera", "perai", "corrigindo"}


def _sem_acento(t: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", t.lower()) if unicodedata.category(c) != "Mn")


def digitos_falados(texto: str) -> str:
    """"dezessete, nove nove 1 2 3" -> "1799123". DDD por extenso ("dezessete", "vinte e um") vira dois
    dígitos; número escrito (o ouvido às vezes escreve "17996") entra como veio."""
    palavras = re.findall(r"\d+|[a-zç]+", _sem_acento(texto))
    saida: list[str] = []
    i = 0
    while i < len(palavras):
        p = palavras[i]
        if p.isdigit():
            saida.append(p)
        elif p in UNIDADES:
            saida.append(str(UNIDADES[p]))
        elif p in DEZ_A_DEZENOVE:
            saida.append(str(DEZ_A_DEZENOVE[p]))
        elif p in DEZENAS:
            n = DEZENAS[p]
            if i + 2 < len(palavras) and palavras[i + 1] == "e" and palavras[i + 2] in UNIDADES:
                n += UNIDADES[palavras[i + 2]]
                i += 2
            saida.append(str(n))
        i += 1
    return "".join(saida)


def so_numero(texto: str) -> bool:
    """A fala é só número (e enchimento como "meu telefone é", "o final é")? Pergunta não é."""
    if "?" in texto:
        return False
    sobra = [p for p in re.findall(r"[a-zç]+", _sem_acento(texto))
             if p not in UNIDADES and p not in DEZ_A_DEZENOVE and p not in DEZENAS and p not in ENCHIMENTO]
    return not sobra


_PEDE_TELEFONE = re.compile(r"telefone|numero|número|whats", re.IGNORECASE)


def pediu_telefone(fala_dela: str) -> bool:
    """A última fala dela pediu ou está conferindo o telefone?"""
    return bool(_PEDE_TELEFONE.search(fala_dela)) or bool(re.search(r"(?:nove|oito|sete)\s.*isso\?\s*$", fala_dela))


def completo(digitos: str) -> bool:
    """DDD + celular (9 e mais 8) são 11 dígitos; DDD + fixo, 10. Dez com 9 depois do DDD ainda falta um."""
    return len(digitos) >= 11 or (len(digitos) == 10 and digitos[2] != "9")


class Ditado:
    """Junta os pedaços do telefone enquanto o cliente dita."""

    def __init__(self) -> None:
        self.pedacos: list[str] = []

    @property
    def digitos(self) -> str:
        return "".join(digitos_falados(p) for p in self.pedacos)

    def segurar(self, texto: str, esperando_telefone: bool) -> bool:
        """Guarda o pedaço e diz se ela deve ficar quieta esperando o resto."""
        if not esperando_telefone or not so_numero(texto) or not (digitos_falados(texto) or self.pedacos):
            self.pedacos = []
            return False
        self.pedacos.append(texto.strip())
        return not completo(self.digitos)  # número inteiro: ela responde agora, com tudo junto

    def juntar(self) -> str:
        """O ditado inteiro numa fala só, para o modelo ler o número de uma vez; e zera."""
        junto = " ".join(self.pedacos)
        self.pedacos = []
        return junto
